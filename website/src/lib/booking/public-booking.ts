import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getCmsDb, type CmsDatabase } from '@/db/cms';
import {
  cmsBookingRateLimit,
  cmsBookings,
  cmsLocations,
  cmsProviderServices,
  cmsProviders,
  cmsServices,
  DEFAULT_LOCALE,
  type CmsBooking,
  type CmsGoogleSyncStatus,
} from '@/db/cms-schema';
import { recordAudit } from '@/lib/cms/auth';
import { getSiteSettings } from '@/lib/cms/content';
import { clientIpFromHeaders } from '@/lib/request-ip';
import { getAvailability, resolveLocationId } from './content';
import { formatLocation } from './format';
import {
  cancelUrlFor,
  loadBookingContext,
  sendBookingCancelledEmails,
  sendBookingCreatedEmails,
} from './notifications';
import { cancelProviderEvent, createProviderEvent } from './provider-calendar';
import { getBookingRules } from './settings';
import { formatSlot, instantToLocal } from './time';

/**
 * Public (anonymous) booking: create from the `/afspraak` widget, look up and
 * cancel through the e-mailed link. Worker C wraps these in server actions
 * (`src/lib/booking/public-actions.ts`).
 *
 * `createPublicBooking()`:
 *   validate (zod, Dutch messages) → rate limit (5 per 15 min per IP or
 *   e-mail, `cms_booking_rate_limit`) → re-check the slot with a FRESH
 *   availability computation (live bookings + Google free/busy) → insert →
 *   Google event without attendees (`google_sync_status`) → e-mails (customer
 *   confirmation with .ics + cancel link, provider notification) → audit
 *   (`recordAudit(db, null, …)`).
 *
 * Cancel tokens: 32 random bytes, base64url. Only their SHA-256 is stored
 * (`cms_bookings.cancel_token_hash`); the raw token exists only in the mail.
 */

export const BOOKING_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const BOOKING_RATE_LIMIT_MAX = 5;

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export function generateCancelToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashCancelToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function looksLikeToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{40,64}$/.test(token);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const TYPE_ERROR = { error: 'Ongeldige invoer.' };
const text = () => z.string(TYPE_ERROR).trim().default('');

/** Structural schema (types, trimming, defaults). Rules live in {@link validateBookingFields}. */
export const publicBookingInputSchema = z.object({
  serviceId: text(),
  /** Empty / null = "Iedereen": the first free provider (admin order) is chosen. */
  providerId: z.string(TYPE_ERROR).trim().nullable().default(null),
  /** ISO instant of the chosen slot, exactly as returned by `getAvailability()`. */
  startsAt: text(),
  customerName: text(),
  customerEmail: text(),
  customerPhone: text(),
  customerAge: z.union([z.number(), z.string(), z.null()], TYPE_ERROR).default(null),
  guardianName: text(),
  guardianEmail: text(),
  guardianPhone: text(),
  /** Required when the resolved location is of kind `customer`. */
  customerAddress: text(),
  bikeDetails: text(),
  notes: text(),
  /** Honeypot: must stay empty. */
  website: text(),
  locale: z.string(TYPE_ERROR).trim().default(DEFAULT_LOCALE),
});

export type PublicBookingInput = z.input<typeof publicBookingInputSchema>;
type ParsedInput = z.output<typeof publicBookingInputSchema>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+0-9()./\s-]{6,25}$/;

const LIMITS: Record<string, number> = {
  customerName: 120,
  customerEmail: 200,
  customerPhone: 40,
  guardianName: 120,
  guardianEmail: 200,
  guardianPhone: 40,
  customerAddress: 300,
  bikeDetails: 500,
  notes: 2000,
};

/** Field rules with Dutch messages; returns `{ field: message }` (empty when valid). */
export function validateBookingFields(
  input: ParsedInput,
  requirements: { requiresGuardian?: boolean; requiresAddress?: boolean } = {},
): Record<string, string> {
  const errors: Record<string, string> = {};
  const set = (field: string, message: string) => {
    errors[field] ??= message;
  };

  if (!input.serviceId) set('serviceId', 'Kies een dienst.');
  if (!input.startsAt || Number.isNaN(Date.parse(input.startsAt)))
    set('startsAt', 'Kies een tijdstip.');
  if (input.customerName.length < 2) set('customerName', 'Vul je naam in.');
  if (!EMAIL_RE.test(input.customerEmail)) set('customerEmail', 'Vul een geldig e-mailadres in.');
  if (input.customerPhone && !PHONE_RE.test(input.customerPhone)) {
    set('customerPhone', 'Vul een geldig telefoonnummer in.');
  }
  if (input.guardianEmail && !EMAIL_RE.test(input.guardianEmail)) {
    set('guardianEmail', 'Vul een geldig e-mailadres in.');
  }
  if (input.guardianPhone && !PHONE_RE.test(input.guardianPhone)) {
    set('guardianPhone', 'Vul een geldig telefoonnummer in.');
  }

  const age = input.customerAge;
  if (age !== null && age !== '') {
    const n = Number(age);
    if (!Number.isInteger(n) || n < 1 || n > 120)
      set('customerAge', 'Vul een geldige leeftijd in.');
  }

  if (requirements.requiresGuardian && input.guardianName.length < 2) {
    set('guardianName', 'Vul de naam van een ouder of voogd in.');
  }
  if (requirements.requiresAddress && input.customerAddress.length < 5) {
    set('customerAddress', 'Vul het adres in waar we langskomen.');
  }

  for (const [field, max] of Object.entries(LIMITS)) {
    const value = input[field as keyof ParsedInput];
    if (typeof value === 'string' && value.length > max) set(field, `Maximaal ${max} tekens.`);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** What the confirmation / cancel pages may show. Contains no contact data. */
export type PublicBookingSummary = {
  bookingId: string;
  serviceName: string;
  providerName: string;
  /** ISO instants. */
  startsAt: string;
  endsAt: string;
  timezone: string;
  locationLabel: string;
  status: CmsBooking['status'];
};

export type PublicBookingErrorCode = 'invalid' | 'rate_limited' | 'slot_taken' | 'error';

export type CreatePublicBookingResult =
  | {
      ok: true;
      bookingId: string;
      /** Raw token — only for the confirmation step; never log or store it. */
      cancelToken: string;
      cancelUrl: string;
      booking: PublicBookingSummary;
      googleSyncStatus: CmsGoogleSyncStatus;
      emailSent: { customer: boolean; provider: boolean };
    }
  | {
      ok: false;
      code: PublicBookingErrorCode;
      message: string;
      fieldErrors: Record<string, string>;
    };

export type CancelByTokenErrorCode = 'not_found' | 'already_cancelled' | 'too_late' | 'error';

export type CancelBookingByTokenResult =
  | { ok: true; message: string; booking: PublicBookingSummary }
  | {
      ok: false;
      code: CancelByTokenErrorCode;
      message: string;
      booking: PublicBookingSummary | null;
    };

export type BookingByTokenResult =
  | {
      ok: true;
      booking: PublicBookingSummary;
      canCancel: boolean;
      /** Why not, in Dutch; null when `canCancel`. */
      reason: string | null;
      /** ISO; the link works until then. */
      cancelDeadline: string;
    }
  | { ok: false; message: string };

export type PublicBookingContext = {
  /** Client IP; read from `x-forwarded-for` / `x-real-ip` when omitted. */
  ipAddress?: string | null;
  /** For tests. */
  now?: Date;
};

function fail(
  code: PublicBookingErrorCode,
  message: string,
  fieldErrors: Record<string, string> = {},
): CreatePublicBookingResult {
  return { ok: false, code, message, fieldErrors };
}

async function requestIp(): Promise<string | null> {
  try {
    const { headers } = await import('next/headers');
    return clientIpFromHeaders(await headers());
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Rate limiting (mirrors cms_login_attempts)
// ---------------------------------------------------------------------------

async function recentAttempts(db: CmsDatabase, email: string, ip: string | null): Promise<number> {
  const since = new Date(Date.now() - BOOKING_RATE_LIMIT_WINDOW_MS);
  // An unknown IP is never used as a key — it would lump every visitor together.
  const who = ip
    ? sql`(${cmsBookingRateLimit.email} = ${email} OR ${cmsBookingRateLimit.ipAddress} = ${ip})`
    : sql`${cmsBookingRateLimit.email} = ${email}`;
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(cmsBookingRateLimit)
    .where(and(gte(cmsBookingRateLimit.attemptedAt, since), who));
  return Number(rows[0]?.count ?? 0);
}

async function recordBookingAttempt(
  db: CmsDatabase,
  email: string,
  ip: string | null,
): Promise<void> {
  await db.insert(cmsBookingRateLimit).values({ email, ipAddress: ip ?? 'unknown' });
  // Opportunistic pruning keeps the table from growing without a cron job.
  await db
    .delete(cmsBookingRateLimit)
    .where(sql`${cmsBookingRateLimit.attemptedAt} < now() - interval '1 day'`);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export async function summarizeBooking(bookingId: string): Promise<PublicBookingSummary | null> {
  const ctx = await loadBookingContext(bookingId);
  if (!ctx) return null;
  const location =
    ctx.location?.kind === 'customer'
      ? ctx.location.name || 'Bij jou thuis'
      : formatLocation(ctx.location).label;
  return {
    bookingId: ctx.booking.id,
    serviceName: ctx.service.name,
    providerName: ctx.provider.displayName,
    startsAt: new Date(ctx.booking.startsAt).toISOString(),
    endsAt: new Date(ctx.booking.endsAt).toISOString(),
    timezone: ctx.booking.timezone,
    locationLabel: location,
    status: ctx.booking.status,
  };
}

function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (candidate.code === '23505') return true;
    if (
      typeof candidate.message === 'string' &&
      /duplicate key|unique constraint/i.test(candidate.message)
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createPublicBooking(
  rawInput: unknown,
  context: PublicBookingContext = {},
): Promise<CreatePublicBookingResult> {
  const parsed = publicBookingInputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? 'form');
      fieldErrors[field] ??= issue.message;
    }
    return fail('invalid', 'Controleer de gemarkeerde velden.', fieldErrors);
  }
  const input = parsed.data;

  if (input.website) {
    return fail('invalid', 'Je aanvraag kon niet verwerkt worden. Probeer het opnieuw of bel ons.');
  }

  const baseErrors = validateBookingFields(input);
  if (Object.keys(baseErrors).length > 0) {
    return fail('invalid', 'Controleer de gemarkeerde velden.', baseErrors);
  }

  const now = context.now ?? new Date();
  const email = input.customerEmail.toLowerCase();
  const ip = context.ipAddress === undefined ? await requestIp() : context.ipAddress || null;

  try {
    const db = await getCmsDb();

    if ((await recentAttempts(db, email, ip)) >= BOOKING_RATE_LIMIT_MAX) {
      return fail(
        'rate_limited',
        'Te veel boekingen op korte tijd. Probeer het over een kwartier opnieuw of bel ons.',
      );
    }
    await recordBookingAttempt(db, email, ip);

    const [service] = await db
      .select()
      .from(cmsServices)
      .where(and(eq(cmsServices.id, input.serviceId), eq(cmsServices.isActive, true)))
      .limit(1);
    if (!service) {
      return fail('invalid', 'Deze dienst bestaat niet (meer).', { serviceId: 'Kies een dienst.' });
    }
    if (service.requiresGuardian) {
      const guardianErrors = validateBookingFields(input, { requiresGuardian: true });
      if (Object.keys(guardianErrors).length > 0) {
        return fail('invalid', 'Controleer de gemarkeerde velden.', guardianErrors);
      }
    }

    // Re-check the slot against a FRESH computation (live bookings + Google).
    const startsAt = new Date(input.startsAt);
    const rules = await getBookingRules(input.locale || DEFAULT_LOCALE);
    const day = instantToLocal(startsAt, rules.timezone).dateYmd;
    const availability = await getAvailability({
      serviceId: service.id,
      providerId: input.providerId || null,
      fromYmd: day,
      toYmd: day,
      now,
      locale: input.locale || DEFAULT_LOCALE,
    });
    if (!availability.ok) return fail('invalid', availability.message);

    const wanted = startsAt.toISOString();
    const match = availability.slots.find((slot) => slot.startsAt === wanted);
    if (!match) {
      return fail(
        'slot_taken',
        'Dit tijdstip is net niet meer beschikbaar. Kies een ander moment.',
        { startsAt: 'Kies een ander tijdstip.' },
      );
    }

    const [provider] = await db
      .select()
      .from(cmsProviders)
      .where(eq(cmsProviders.id, match.providerId))
      .limit(1);
    if (!provider) return fail('slot_taken', 'Dit tijdstip is net niet meer beschikbaar.');

    // Location: provider override → service → provider default → global default.
    const [subscription] = await db
      .select({ locationId: cmsProviderServices.locationId })
      .from(cmsProviderServices)
      .where(
        and(
          eq(cmsProviderServices.providerId, provider.id),
          eq(cmsProviderServices.serviceId, service.id),
        ),
      )
      .limit(1);
    const [globalDefault] = await db
      .select({ id: cmsLocations.id })
      .from(cmsLocations)
      .where(and(eq(cmsLocations.isDefault, true), eq(cmsLocations.isActive, true)))
      .limit(1);
    const locationId = resolveLocationId({
      overrideId: subscription?.locationId,
      serviceLocationId: service.locationId,
      providerDefaultId: provider.defaultLocationId,
      globalDefaultId: globalDefault?.id,
    });
    const [location] = locationId
      ? await db.select().from(cmsLocations).where(eq(cmsLocations.id, locationId)).limit(1)
      : [];

    if (location?.kind === 'customer') {
      const addressErrors = validateBookingFields(input, {
        requiresGuardian: service.requiresGuardian,
        requiresAddress: true,
      });
      if (Object.keys(addressErrors).length > 0) {
        return fail('invalid', 'Controleer de gemarkeerde velden.', addressErrors);
      }
    }

    const cancelToken = generateCancelToken();
    let booking: CmsBooking;
    try {
      const age =
        input.customerAge === null || input.customerAge === '' ? null : Number(input.customerAge);
      [booking] = await db
        .insert(cmsBookings)
        .values({
          serviceId: service.id,
          providerId: provider.id,
          locationId: location?.id ?? null,
          startsAt: new Date(match.startsAt),
          endsAt: new Date(match.endsAt),
          timezone: rules.timezone,
          status: 'confirmed',
          customerName: input.customerName,
          customerEmail: email,
          customerPhone: input.customerPhone || null,
          customerAge: age,
          guardianName: input.guardianName || null,
          guardianEmail: input.guardianEmail.toLowerCase() || null,
          guardianPhone: input.guardianPhone || null,
          bikeDetails: input.bikeDetails || null,
          notes: input.notes || null,
          customerAddress: location?.kind === 'customer' ? input.customerAddress || null : null,
          cancelTokenHash: hashCancelToken(cancelToken),
          googleSyncStatus: 'pending',
          source: 'web',
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) {
        return fail(
          'slot_taken',
          'Dit tijdstip werd net door iemand anders geboekt. Kies een ander moment.',
          {
            startsAt: 'Kies een ander tijdstip.',
          },
        );
      }
      throw error;
    }

    // From here on the booking exists: side effects may fail, the booking stays.
    let googleSyncStatus: CmsGoogleSyncStatus = 'pending';
    try {
      googleSyncStatus = (await createProviderEvent(provider, booking)).status;
    } catch (error) {
      console.error('[booking] Google event failed', error);
      googleSyncStatus = 'failed';
    }

    const emailSent = { customer: false, provider: false };
    try {
      const mails = await sendBookingCreatedEmails(booking.id, cancelToken);
      emailSent.customer = mails.customer?.sent === true;
      emailSent.provider = mails.provider?.sent === true;
    } catch (error) {
      console.error('[booking] confirmation e-mails failed', error);
    }

    await recordAudit(db, null, {
      action: 'booking.create',
      entityType: 'cms_booking',
      entityId: booking.id,
      summary: `${service.name} · ${formatSlot(booking.startsAt, booking.timezone)} · ${provider.displayName}`,
      metadata: { source: 'web', google: googleSyncStatus, emailSent },
    });

    const summary = (await summarizeBooking(booking.id)) ?? {
      bookingId: booking.id,
      serviceName: service.name,
      providerName: provider.displayName,
      startsAt: match.startsAt,
      endsAt: match.endsAt,
      timezone: booking.timezone,
      locationLabel: location ? formatLocation(location).label : '',
      status: booking.status,
    };

    return {
      ok: true,
      bookingId: booking.id,
      cancelToken,
      cancelUrl: cancelUrlFor(cancelToken),
      booking: summary,
      googleSyncStatus,
      emailSent,
    };
  } catch (error) {
    console.error('[booking] createPublicBooking failed', error);
    return fail('error', 'Er ging iets mis bij het boeken. Probeer het opnieuw of bel ons.');
  }
}

// ---------------------------------------------------------------------------
// Look up + cancel by token
// ---------------------------------------------------------------------------

async function findByToken(token: string): Promise<CmsBooking | null> {
  if (!looksLikeToken(token)) return null;
  const db = await getCmsDb();
  const [booking] = await db
    .select()
    .from(cmsBookings)
    .where(eq(cmsBookings.cancelTokenHash, hashCancelToken(token)))
    .limit(1);
  return booking ?? null;
}

async function cancellability(
  booking: CmsBooking,
  now: Date,
): Promise<{
  canCancel: boolean;
  reason: string | null;
  deadline: Date;
  code: CancelByTokenErrorCode | null;
}> {
  const rules = await getBookingRules(DEFAULT_LOCALE);
  const deadline = new Date(
    new Date(booking.startsAt).getTime() - rules.cancelUntilHours * 60 * 60_000,
  );
  if (booking.status === 'cancelled') {
    return {
      canCancel: false,
      reason: 'Deze afspraak is al geannuleerd.',
      deadline,
      code: 'already_cancelled',
    };
  }
  if (booking.status !== 'confirmed' || now.getTime() > deadline.getTime()) {
    const settings = await getSiteSettings(DEFAULT_LOCALE);
    const phone = settings.contact.phoneLabel;
    const reason =
      booking.status !== 'confirmed'
        ? 'Deze afspraak kan niet meer geannuleerd worden.'
        : `Annuleren via de link kan tot ${rules.cancelUntilHours} uur voor je afspraak.${phone ? ` Bel ons op ${phone}.` : ' Neem contact met ons op.'}`;
    return { canCancel: false, reason, deadline, code: 'too_late' };
  }
  return { canCancel: true, reason: null, deadline, code: null };
}

/** For the `/afspraak/annuleren/[token]` page: what would be cancelled, and whether it still can be. */
export async function getBookingByCancelToken(
  token: string,
  context: { now?: Date } = {},
): Promise<BookingByTokenResult> {
  const booking = await findByToken(token);
  if (!booking) return { ok: false, message: 'Deze annuleerlink is ongeldig of verlopen.' };
  const summary = await summarizeBooking(booking.id);
  if (!summary) return { ok: false, message: 'Deze annuleerlink is ongeldig of verlopen.' };
  const state = await cancellability(booking, context.now ?? new Date());
  return {
    ok: true,
    booking: summary,
    canCancel: state.canCancel,
    reason: state.reason,
    cancelDeadline: state.deadline.toISOString(),
  };
}

/** Customer cancellation via the e-mailed link (until `cancelUntilHours` before the start). */
export async function cancelBookingByToken(
  token: string,
  context: { now?: Date } = {},
): Promise<CancelBookingByTokenResult> {
  try {
    const booking = await findByToken(token);
    if (!booking) {
      return {
        ok: false,
        code: 'not_found',
        message: 'Deze annuleerlink is ongeldig of verlopen.',
        booking: null,
      };
    }
    const now = context.now ?? new Date();
    const state = await cancellability(booking, now);
    if (!state.canCancel) {
      return {
        ok: false,
        code: state.code ?? 'error',
        message: state.reason ?? 'Deze afspraak kan niet geannuleerd worden.',
        booking: await summarizeBooking(booking.id),
      };
    }

    const db = await getCmsDb();
    const [cancelled] = await db
      .update(cmsBookings)
      .set({ status: 'cancelled', cancelledAt: now, cancelledBy: 'customer', updatedAt: now })
      .where(and(eq(cmsBookings.id, booking.id), eq(cmsBookings.status, 'confirmed')))
      .returning();
    if (!cancelled) {
      return {
        ok: false,
        code: 'already_cancelled',
        message: 'Deze afspraak is al geannuleerd.',
        booking: await summarizeBooking(booking.id),
      };
    }

    const [provider] = await db
      .select()
      .from(cmsProviders)
      .where(eq(cmsProviders.id, cancelled.providerId))
      .limit(1);
    if (provider) {
      try {
        await cancelProviderEvent(provider, cancelled);
      } catch (error) {
        console.error('[booking] Google delete failed', error);
      }
    }
    try {
      await sendBookingCancelledEmails(cancelled.id, 'customer');
    } catch (error) {
      console.error('[booking] cancellation e-mails failed', error);
    }

    await recordAudit(db, null, {
      action: 'booking.cancel',
      entityType: 'cms_booking',
      entityId: cancelled.id,
      summary: 'geannuleerd door de klant (link)',
      metadata: { by: 'customer' },
    });

    const summary = await summarizeBooking(cancelled.id);
    return {
      ok: true,
      message: 'Je afspraak is geannuleerd. Je krijgt een bevestiging per e-mail.',
      booking: summary!,
    };
  } catch (error) {
    console.error('[booking] cancelBookingByToken failed', error);
    return {
      ok: false,
      code: 'error',
      message: 'Er ging iets mis. Probeer het opnieuw of bel ons.',
      booking: null,
    };
  }
}
