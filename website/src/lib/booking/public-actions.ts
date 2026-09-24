'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { DEFAULT_LOCALE } from '@/db/cms-schema';
import {
  confirmationPath,
  createConfirmationRef,
} from '@/components/studio/booking/confirmation-ref';
import type {
  AvailabilityActionInput,
  AvailabilityActionResult,
  BookActionInput,
  BookActionResult,
  BookingSummary,
  CancelActionResult,
} from '@/components/studio/booking/types';
import { clientIpFromHeaders } from '@/lib/request-ip';
import { getAvailability } from './content';
import {
  cancelBookingByToken,
  createPublicBooking,
  type PublicBookingSummary,
} from './public-booking';

/**
 * Server actions behind the public booking widget (`/afspraak`) and the
 * cancel page (`/afspraak/annuleren/[token]`).
 *
 * Thin wrappers: the rules (validation, rate limiting, the slot re-check,
 * Google, e-mail, audit) all live in `./content` and `./public-booking`. What
 * happens here is only the public-endpoint hygiene — every argument is treated
 * as untrusted, shapes are checked before anything else runs, the client IP is
 * read from the request headers, and results are reduced to plain serialisable
 * objects that never contain contact data or the raw cancel token.
 *
 * Next's server actions carry their own Origin/Host check, which is what keeps
 * these from being posted cross-site.
 */

const LOAD_ERROR = 'De agenda kon niet geladen worden. Probeer het opnieuw.';
const BOOK_ERROR = 'Er ging iets mis bij het boeken. Probeer het opnieuw of bel ons.';
const SLOT_TAKEN = 'Dit moment is net geboekt. Kies een ander moment.';
const CANCEL_ERROR = 'Er ging iets mis. Probeer het opnieuw of bel ons.';

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .default('');
const id = z.string().trim().max(64).default('');

const availabilityInputSchema = z.object({
  serviceId: id,
  providerId: z.string().trim().max(64).nullable().default(null),
  fromYmd: ymd,
  toYmd: ymd,
});

const text = (max: number) => z.string().trim().max(max).default('');

/** Shape check only; the field rules and Dutch messages live in `public-booking.ts`. */
const bookInputSchema = z.object({
  serviceId: id,
  providerId: z.string().trim().max(64).nullable().default(null),
  startsAt: text(40),
  name: text(200),
  email: text(254),
  phone: text(60),
  age: z.number().int().nullable().default(null),
  guardianName: text(200),
  guardianEmail: text(254),
  guardianPhone: text(60),
  address: text(400),
  bikeDetails: text(600),
  notes: text(2400),
  website: z.string().max(400).default(''),
});

/** `public-booking.ts` field names → the widget's `BookActionInput` names. */
const FIELD_NAMES: Record<string, keyof BookActionInput> = {
  serviceId: 'serviceId',
  providerId: 'providerId',
  startsAt: 'startsAt',
  customerName: 'name',
  customerEmail: 'email',
  customerPhone: 'phone',
  customerAge: 'age',
  guardianName: 'guardianName',
  guardianEmail: 'guardianEmail',
  guardianPhone: 'guardianPhone',
  customerAddress: 'address',
  bikeDetails: 'bikeDetails',
  notes: 'notes',
};

async function clientIp(): Promise<string | null> {
  return clientIpFromHeaders(await headers());
}

function toSummary(summary: PublicBookingSummary): BookingSummary {
  return {
    serviceName: summary.serviceName,
    providerName: summary.providerName,
    startsAt: summary.startsAt,
    endsAt: summary.endsAt,
    timezone: summary.timezone,
    locationLabel: summary.locationLabel,
    status: summary.status,
  };
}

/** Free slots for one service (and optionally one provider) between two local dates. */
export async function availabilityAction(
  input: AvailabilityActionInput,
): Promise<AvailabilityActionResult> {
  const parsed = availabilityInputSchema.safeParse(input ?? {});
  if (!parsed.success || !parsed.data.serviceId || !parsed.data.fromYmd || !parsed.data.toYmd) {
    return { ok: false, message: 'Ongeldige aanvraag.' };
  }

  try {
    const result = await getAvailability({
      serviceId: parsed.data.serviceId,
      providerId: parsed.data.providerId || null,
      fromYmd: parsed.data.fromYmd,
      toYmd: parsed.data.toYmd,
      locale: DEFAULT_LOCALE,
    });
    if (!result.ok) return { ok: false, message: result.message };
    return {
      ok: true,
      slots: result.slots.map((slot) => ({
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        providerId: slot.providerId,
      })),
    };
  } catch (error) {
    console.error('[booking] availabilityAction failed', error);
    return { ok: false, message: LOAD_ERROR };
  }
}

/** Books the chosen slot. The client IP comes from the request, never from the client. */
export async function bookAction(input: BookActionInput): Promise<BookActionResult> {
  const parsed = bookInputSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid',
      message: 'Controleer de gemarkeerde velden.',
      fieldErrors: {},
    };
  }
  const data = parsed.data;

  try {
    const result = await createPublicBooking(
      {
        serviceId: data.serviceId,
        providerId: data.providerId || null,
        startsAt: data.startsAt,
        customerName: data.name,
        customerEmail: data.email,
        customerPhone: data.phone,
        customerAge: data.age,
        guardianName: data.guardianName,
        guardianEmail: data.guardianEmail,
        guardianPhone: data.guardianPhone,
        customerAddress: data.address,
        bikeDetails: data.bikeDetails,
        notes: data.notes,
        website: data.website,
        locale: DEFAULT_LOCALE,
      },
      { ipAddress: await clientIp() },
    );

    if (!result.ok) {
      const fieldErrors: Record<string, string> = {};
      for (const [field, message] of Object.entries(result.fieldErrors)) {
        fieldErrors[FIELD_NAMES[field] ?? field] = message;
      }
      return {
        ok: false,
        code: result.code,
        message: result.code === 'slot_taken' ? SLOT_TAKEN : result.message,
        fieldErrors,
      };
    }

    const booking = toSummary(result.booking);
    let path = '';
    try {
      path = confirmationPath(
        createConfirmationRef({
          serviceName: booking.serviceName,
          providerName: booking.providerName,
          startsAt: booking.startsAt,
          endsAt: booking.endsAt,
          timezone: booking.timezone,
          where: booking.locationLabel,
        }),
      );
    } catch (error) {
      // No signing secret: the booking stands, only the refresh-safe URL is skipped.
      console.error('[booking] confirmation ref could not be signed', error);
    }

    return { ok: true, bookingId: result.bookingId, booking, confirmationPath: path };
  } catch (error) {
    console.error('[booking] bookAction failed', error);
    return { ok: false, code: 'error', message: BOOK_ERROR, fieldErrors: {} };
  }
}

/** Customer cancellation from the e-mailed link. */
export async function cancelAction(token: string): Promise<CancelActionResult> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 128) {
    return { ok: false, message: 'Deze annuleerlink is ongeldig of verlopen.', booking: null };
  }
  try {
    const result = await cancelBookingByToken(token);
    return {
      ok: result.ok,
      message: result.message,
      booking: result.booking ? toSummary(result.booking) : null,
    };
  } catch (error) {
    console.error('[booking] cancelAction failed', error);
    return { ok: false, message: CANCEL_ERROR, booking: null };
  }
}
