import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookActionInput } from '@/components/studio/booking/types';
import { availabilityAction, bookAction, cancelAction } from './public-actions';
import type { CreatePublicBookingResult } from './public-booking';

/**
 * The public booking actions log a failure as a fixed event code and answer
 * with a generic Dutch message, never with the caught error (CLAUDE.md §4,
 * "Logging"). What they call is replaced: `./content` and `./public-booking`
 * reject with an error in the shape Drizzle 0.45 throws for a failed query
 * (`Failed query: <sql>\nparams: <every bound value>`, with `query`, `params`
 * and `cause` enumerable) that carries a dummy value for everything a booking
 * binds; `next/headers` answers for a dummy client IP; the confirmation ref
 * can be made to fail to sign. `server-only` is stubbed in vitest.config.ts,
 * and the log helper itself is covered in `booking-log.test.ts`.
 */

const fake = vi.hoisted(() => ({
  clientIp: '203.0.113.77',
  getAvailability: vi.fn(),
  createPublicBooking: vi.fn(),
  cancelBookingByToken: vi.fn(),
  createConfirmationRef: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': fake.clientIp }),
}));
vi.mock('./content', () => ({ getAvailability: fake.getAvailability }));
vi.mock('./public-booking', () => ({
  createPublicBooking: fake.createPublicBooking,
  cancelBookingByToken: fake.cancelBookingByToken,
}));
vi.mock('@/components/studio/booking/confirmation-ref', () => ({
  createConfirmationRef: fake.createConfirmationRef,
  confirmationPath: (ref: string) => `/afspraak/bevestigd?ref=${encodeURIComponent(ref)}`,
}));

const CUSTOMER_NAME = 'Kanarie Klant-Vogelaar';
const CUSTOMER_EMAIL = 'kanarie.klant@lek-test.invalid';
const CUSTOMER_PHONE = '+32 470 11 22 33';
const GUARDIAN_NAME = 'Kanarie Voogd-Vogelaar';
const GUARDIAN_EMAIL = 'kanarie.voogd@lek-test.invalid';
const GUARDIAN_PHONE = '+32 499 98 76 54';
const ADDRESS = 'Kanariestraat 17, 9999 Vogeldorp';
const BIKE_DETAILS = 'Kanarie Racer, maat 58';
const NOTES = 'Kanarie-notitie: knie links';
const CANCEL_TOKEN = 'KanarieRawCancelToken_0123456789-abcdefghijk';
const BOOKING_ID = '0f6c2d4e-8a1b-4c3d-9e5f-a0b1c2d3e4f5';

/** None of these may appear in anything logged, as JSON or as Node prints it. */
const LEAKS = [
  CUSTOMER_NAME,
  CUSTOMER_EMAIL,
  CUSTOMER_PHONE,
  GUARDIAN_NAME,
  GUARDIAN_EMAIL,
  GUARDIAN_PHONE,
  ADDRESS,
  BIKE_DETAILS,
  NOTES,
  CANCEL_TOKEN,
  fake.clientIp,
  'kanarie',
  'Failed query',
  'params',
  'insert into',
  'Failing row',
  '@',
];

const BOOK_INPUT: BookActionInput = {
  serviceId: 'svc-bikefit',
  providerId: '',
  startsAt: '2026-10-20T08:00:00.000Z',
  name: CUSTOMER_NAME,
  email: CUSTOMER_EMAIL,
  phone: CUSTOMER_PHONE,
  age: null,
  guardianName: GUARDIAN_NAME,
  guardianEmail: GUARDIAN_EMAIL,
  guardianPhone: GUARDIAN_PHONE,
  address: ADDRESS,
  bikeDetails: BIKE_DETAILS,
  notes: NOTES,
  website: '',
};

/** The booking as the widget may show it (no contact data). */
const SUMMARY = {
  serviceName: 'Bikefit',
  providerName: 'Aanbieder',
  startsAt: '2026-10-20T08:00:00.000Z',
  endsAt: '2026-10-20T09:30:00.000Z',
  timezone: 'Europe/Brussels',
  locationLabel: 'De Bikefit Studio',
  status: 'confirmed' as const,
};

/** What `createPublicBooking()` resolves with once the booking is made. */
function booked(): CreatePublicBookingResult {
  return {
    ok: true,
    bookingId: BOOKING_ID,
    cancelToken: CANCEL_TOKEN,
    cancelUrl: `https://studio.invalid/afspraak/annuleren/${CANCEL_TOKEN}`,
    booking: { bookingId: BOOKING_ID, ...SUMMARY },
    googleSyncStatus: 'synced',
    emailSent: { customer: true, provider: true },
  };
}

/**
 * A failed booking insert as Drizzle 0.45 throws it: every bound value in the
 * message and in `params`, and behind it a Neon error with the failing row.
 */
function queryFailure(): Error {
  const query =
    'insert into "cms_bookings" ("id", "service_id", "customer_name", "customer_email", "customer_phone", "guardian_name", "guardian_email", "guardian_phone", "bike_details", "notes", "customer_address") values (default, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *';
  const params = [
    'svc-bikefit',
    CUSTOMER_NAME,
    CUSTOMER_EMAIL,
    CUSTOMER_PHONE,
    GUARDIAN_NAME,
    GUARDIAN_EMAIL,
    GUARDIAN_PHONE,
    BIKE_DETAILS,
    NOTES,
    ADDRESS,
  ];
  const cause = Object.assign(new Error(`connection to ${fake.clientIp} failed`), {
    name: 'NeonDbError',
    code: '08006',
    detail: `Failing row contains (${params.join(', ')}).`,
  });
  return Object.assign(new Error(`Failed query: ${query}\nparams: ${params.join(',')}`), {
    query,
    params,
    cause,
  });
}

/** Every console call of a test, with its level. */
let logged: Array<{ level: string; args: unknown[] }> = [];

beforeEach(() => {
  logged = [];
  for (const level of ['debug', 'info', 'log', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push({ level, args });
    });
  }
  fake.getAvailability.mockReset();
  fake.createPublicBooking.mockReset();
  fake.cancelBookingByToken.mockReset();
  fake.createConfirmationRef.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Exactly one console call: `console.error` under `event`, with `bookingId` when given. */
function expectLoggedOnly(event: string, bookingId?: string) {
  expect(logged).toStrictEqual([
    { level: 'error', args: [`[booking] ${event}`, bookingId ? { event, bookingId } : { event }] },
  ]);
}

/** Nothing logged, as JSON or as Node prints it (deeper than `console` does), holds a dummy value. */
function expectNoLeak() {
  for (const { args } of logged) {
    let json: string;
    try {
      json = JSON.stringify(args);
    } catch {
      json = '';
    }
    for (const text of [json, inspect(args, { depth: 10 })]) {
      const lower = text.toLowerCase();
      for (const value of LEAKS) {
        expect(lower.includes(value.toLowerCase()), `${value} leaked: ${text}`).toBe(false);
      }
    }
  }
}

describe('public booking actions: a failure is one fixed line, nothing personal', () => {
  it('availabilityAction: a failed query, the generic message and one fixed line', async () => {
    fake.getAvailability.mockRejectedValue(queryFailure());

    const result = await availabilityAction({
      serviceId: 'svc-bikefit',
      providerId: null,
      fromYmd: '2026-10-20',
      toYmd: '2026-10-26',
    });

    expect(result).toStrictEqual({
      ok: false,
      message: 'De agenda kon niet geladen worden. Probeer het opnieuw.',
    });
    expect(fake.getAvailability).toHaveBeenCalledTimes(1);
    expectLoggedOnly('availability_action_failed');
    expectNoLeak();
  });

  it('bookAction: a failed booking, the generic message and one fixed line', async () => {
    fake.createPublicBooking.mockRejectedValue(queryFailure());

    const result = await bookAction(BOOK_INPUT);

    expect(result).toStrictEqual({
      ok: false,
      code: 'error',
      message: 'Er ging iets mis bij het boeken. Probeer het opnieuw of bel ons.',
      fieldErrors: {},
    });
    // The contact data and the client IP were in play, so they could have leaked.
    expect(fake.createPublicBooking).toHaveBeenCalledTimes(1);
    expect(fake.createPublicBooking).toHaveBeenCalledWith(
      expect.objectContaining({ customerEmail: CUSTOMER_EMAIL, notes: NOTES }),
      { ipAddress: fake.clientIp },
    );
    expectLoggedOnly('book_action_failed');
    expectNoLeak();
  });

  it('cancelAction: a failed cancellation, the generic message and one fixed line', async () => {
    fake.cancelBookingByToken.mockRejectedValue(queryFailure());

    const result = await cancelAction(CANCEL_TOKEN);

    expect(result).toStrictEqual({
      ok: false,
      message: 'Er ging iets mis. Probeer het opnieuw of bel ons.',
      booking: null,
    });
    expect(fake.cancelBookingByToken).toHaveBeenCalledWith(CANCEL_TOKEN);
    expectLoggedOnly('cancel_action_failed');
    expectNoLeak();
  });

  it('bookAction: an unsigned confirmation ref keeps the booking, one fixed line with its id', async () => {
    fake.createPublicBooking.mockResolvedValue(booked());
    fake.createConfirmationRef.mockImplementation(() => {
      throw new Error(`CMS_SESSION_SECRET missing; ref for ${CUSTOMER_NAME} <${CUSTOMER_EMAIL}>`);
    });

    const result = await bookAction(BOOK_INPUT);

    expect(result).toStrictEqual({
      ok: true,
      bookingId: BOOKING_ID,
      booking: SUMMARY,
      confirmationPath: '',
    });
    expect(fake.createConfirmationRef).toHaveBeenCalledTimes(1);
    expectLoggedOnly('confirmation_ref_unsigned', BOOKING_ID);
    expectNoLeak();
  });

  it('bookAction: a signed confirmation ref gives its path and logs nothing', async () => {
    fake.createPublicBooking.mockResolvedValue(booked());
    fake.createConfirmationRef.mockReturnValue('payload.signature');

    const result = await bookAction(BOOK_INPUT);

    expect(result).toStrictEqual({
      ok: true,
      bookingId: BOOKING_ID,
      booking: SUMMARY,
      confirmationPath: '/afspraak/bevestigd?ref=payload.signature',
    });
    expect(logged).toStrictEqual([]);
  });
});
