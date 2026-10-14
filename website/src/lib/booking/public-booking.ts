import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getCmsDb } from '@/db/cms';
import {
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
import { reserveRateLimit } from '@/lib/rate-limit';
import { clientIpFromHeaders } from '@/lib/request-ip';
import { isUniqueViolation, logBookingFailure } from './booking-log';
import { getAvailability, resolveLocationId } from './content';
import { formatLocation } from './format';
import {
  cancelUrlFor,
  loadBookingContext,
  sendBookingCancelledEmails,
  sendBookingCreatedEmails,
} from './notifications';
import { cancelProviderEvent, createProviderEvent } from './provider-calendar';
import { publicBookingInputSchema, validateBookingFields } from './public-booking-input';
import { bookingRateLimitScopes } from './rate-limit-policy';
import { getBookingRules } from './settings';
import { formatSlot, instantToLocal } from './time';

/**
 * Public (anonymous) booking: create from the `/afspraak` widget, look up and
 * cancel through the e-mailed link. Worker C wraps these in server actions
 * (`src/lib/booking/public-actions.ts`).
 *
 * `createPublicBooking()`:
 *   validate, without a query (`./public-booking-input.ts`: the schema caps
 *   every raw field, then the honeypot, then the field rules with Dutch
 *   messages, length before pattern) → rate limit: reserve one hit per key,
 *   5 per 15 min for the IP (when known) and for each e-mail address on its
 *   own, one race-free upsert per key on `cms_rate_limits`
 *   (`./rate-limit-policy.ts`, `@/lib/rate-limit`) → re-check the slot with
 *   a FRESH availability computation (live bookings + Google free/busy) →
 *   insert → Google event without attendees (`google_sync_status`) → e-mails
 *   (customer confirmation with .ics + cancel link, provider notification) →
 *   audit (`recordAudit(db, null, …)`).
 *
 * Cancel tokens: 32 random bytes, base64url. Only their SHA-256 is stored
 * (`cms_bookings.cancel_token_hash`); the raw token exists only in the mail.
 *
 * Failures are logged as a fixed event code (`logBookingFailure()`), never
 * with the caught error: a query error carries every bound value.
 */

export { BOOKING_RATE_LIMIT_MAX, BOOKING_RATE_LIMIT_WINDOW_MS } from './rate-limit-policy';
export {
  publicBookingInputSchema,
  validateBookingFields,
  type PublicBookingInput,
} from './public-booking-input';

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

    // Reserve before anything is looked at: one statement per key, so a
    // parallel burst cannot get past the limit. A full key gives back what was
    // taken; an attempt that got through keeps its hits, whatever comes next.
    const reserved = await reserveRateLimit(
      db,
      bookingRateLimitScopes({ email, guardianEmail: input.guardianEmail, ip }),
    );
    if (!reserved.ok) {
      return fail(
        'rate_limited',
        'Te veel boekingen op korte tijd. Probeer het over een kwartier opnieuw of bel ons.',
      );
    }

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
    } catch {
      logBookingFailure('google_event_failed', booking.id);
      googleSyncStatus = 'failed';
    }

    const emailSent = { customer: false, provider: false };
    try {
      const mails = await sendBookingCreatedEmails(booking.id, cancelToken);
      emailSent.customer = mails.customer?.sent === true;
      emailSent.provider = mails.provider?.sent === true;
    } catch {
      logBookingFailure('confirmation_mail_failed', booking.id);
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
  } catch {
    logBookingFailure('create_failed');
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
      } catch {
        logBookingFailure('google_delete_failed', cancelled.id);
      }
    }
    try {
      await sendBookingCancelledEmails(cancelled.id, 'customer');
    } catch {
      logBookingFailure('cancellation_mail_failed', cancelled.id);
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
  } catch {
    logBookingFailure('cancel_failed');
    return {
      ok: false,
      code: 'error',
      message: 'Er ging iets mis. Probeer het opnieuw of bel ons.',
      booking: null,
    };
  }
}
