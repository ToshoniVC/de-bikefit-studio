import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isUniqueViolation, logBookingFailure, type BookingLogEvent } from './booking-log';

/**
 * Booking failures reach the server log without personal data or secrets
 * (CLAUDE.md §4, "Logging"). Drizzle 0.45 throws every failed query as a
 * `DrizzleQueryError`: its message is `Failed query: <sql>\nparams: <every
 * bound value>`, and `query`, `params` and `cause` are enumerable. The driver
 * error behind it adds more: Neon's `NeonDbError` the failing row (`detail`),
 * a raw HTTP body or a `sourceError`; PGlite's `DatabaseError` the SQL and
 * params again. The errors below are built by hand in those shapes, with a
 * distinctive dummy value for everything the booking flow binds or handles.
 * `logBookingFailure()` takes no error: a line is the fixed event code and at
 * most a UUID, and none of the dummy values may reach what `console.error`
 * receives or prints, not even when a caller hands it an error anyway.
 */

const CUSTOMER_NAME = 'Kanarie Klant-Vogelaar';
const CUSTOMER_EMAIL = 'kanarie.klant@lek-test.invalid';
const CUSTOMER_PHONE = '+32 470 11 22 33';
const CUSTOMER_AGE = 113;
const GUARDIAN_NAME = 'Kanarie Voogd-Vogelaar';
const GUARDIAN_EMAIL = 'kanarie.voogd@lek-test.invalid';
const GUARDIAN_PHONE = '+32 499 98 76 54';
const BIKE_DETAILS = 'Kanarie Racer, maat 58';
const NOTES = 'Kanarie-notitie: duplicate key value violates unique constraint';
const ADDRESS = 'Kanariestraat 17, 9999 Vogeldorp';
const CANCEL_TOKEN = 'KanarieRawCancelToken_0123456789-abcdefghijk';
const CANCEL_TOKEN_HASH = `${'c0ffee'.repeat(10)}beef`;
const CLIENT_IP = '203.0.113.77';
const GOOGLE_TOKEN_ENC = 'v1.kanarieIv.kanarieTag.kanarieCiphertext';
const RESPONSE_BODY = `<html><body>502 Bad Gateway: notes=${NOTES}; link=/afspraak/annuleren/${CANCEL_TOKEN}</body></html>`;
const BOOKING_ID = '0f6c2d4e-8a1b-4c3d-9e5f-a0b1c2d3e4f5';

/** None of these may appear in a logged argument, as JSON or as Node prints it. */
const LEAKS: Array<[string, string]> = [
  ['customer name', CUSTOMER_NAME],
  ['customer e-mail', CUSTOMER_EMAIL],
  ['customer phone', CUSTOMER_PHONE],
  ['customer age', String(CUSTOMER_AGE)],
  ['guardian name', GUARDIAN_NAME],
  ['guardian e-mail', GUARDIAN_EMAIL],
  ['guardian phone', GUARDIAN_PHONE],
  ['bike details', BIKE_DETAILS],
  ['notes', NOTES],
  ['address', ADDRESS],
  ['raw cancel token', CANCEL_TOKEN],
  ['cancel token hash', CANCEL_TOKEN_HASH],
  ['client IP', CLIENT_IP],
  ['encrypted Google token', GOOGLE_TOKEN_ENC],
  ['response body', RESPONSE_BODY],
  ['any dummy value', 'kanarie'],
  ['the failed-query text', 'Failed query'],
  ['the params', 'params'],
  ['the SQL', 'insert into'],
  ['the failing row', 'Failing row'],
];

/** Everything the booking insert binds, in column order (`createPublicBooking()`). */
const INSERT_PARAMS: unknown[] = [
  'svc-bikefit-kanarie',
  'prv-kanarie',
  null,
  '2026-10-20T08:00:00.000Z',
  '2026-10-20T09:30:00.000Z',
  'Europe/Brussels',
  'confirmed',
  CUSTOMER_NAME,
  CUSTOMER_EMAIL,
  CUSTOMER_PHONE,
  CUSTOMER_AGE,
  GUARDIAN_NAME,
  GUARDIAN_EMAIL,
  GUARDIAN_PHONE,
  BIKE_DETAILS,
  NOTES,
  ADDRESS,
  CANCEL_TOKEN_HASH,
  'pending',
  'web',
];

const INSERT_SQL =
  'insert into "cms_bookings" ("id", "service_id", "provider_id", "location_id", "starts_at", "ends_at", "timezone", "status", "customer_name", "customer_email", "customer_phone", "customer_age", "guardian_name", "guardian_email", "guardian_phone", "bike_details", "notes", "customer_address", "cancel_token_hash", "google_sync_status", "source") values (default, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) returning *';
const CHECK_VIOLATION =
  'new row for relation "cms_bookings" violates check constraint "cms_bookings_status_check"';
const UNIQUE_MESSAGE =
  'duplicate key value violates unique constraint "cms_bookings_provider_start_confirmed_key"';

/** Drizzle's wrapper as 0.45 builds it: the params in the message and as a property. */
function failedQuery(query: string, params: unknown[], cause: unknown): Error {
  return Object.assign(new Error(`Failed query: ${query}\nparams: ${params.join(',')}`), {
    query,
    params,
    cause,
  });
}

/** PGlite's `DatabaseError`: the Postgres fields, with the SQL and params attached. */
function pgliteError(code: string, message: string, query: string, params: unknown[]): Error {
  return Object.assign(new Error(message), {
    name: 'DatabaseError',
    severity: 'ERROR',
    code,
    query,
    params,
  });
}

/**
 * A failed booking insert on Neon, with every place a value can hide: the
 * params (message and property), the failing row (`detail`), `hint`, the SQL
 * again (`where`), and a `sourceError` whose message and body echo an HTTP
 * response, caused by a socket error that names the client IP.
 */
function leakyInsertFailure(): Error {
  const socket = Object.assign(new Error(`read ECONNRESET from ${CLIENT_IP}`), {
    code: 'ECONNRESET',
  });
  const http = Object.assign(new Error(`HTTP 502: ${RESPONSE_BODY}`), {
    status: 502,
    body: RESPONSE_BODY,
    response: { status: 502, headers: { 'x-forwarded-for': CLIENT_IP }, body: RESPONSE_BODY },
    cause: socket,
  });
  const neon = Object.assign(new Error(CHECK_VIOLATION), {
    name: 'NeonDbError',
    severity: 'ERROR',
    code: '23514',
    detail: `Failing row contains (${INSERT_PARAMS.join(', ')}).`,
    hint: `Check ${CUSTOMER_EMAIL} (${CLIENT_IP}).`,
    where: INSERT_SQL,
    table: 'cms_bookings',
    constraint: 'cms_bookings_status_check',
    sourceError: http,
  });
  return failedQuery(INSERT_SQL, INSERT_PARAMS, neon);
}

/** A failed cancel-token lookup on PGlite: the hash in the params, the raw token in the message. */
function tokenLookupFailure(): Error {
  const sql = 'select * from "cms_bookings" where "cms_bookings"."cancel_token_hash" = $1 limit $2';
  const params = [CANCEL_TOKEN_HASH, 1];
  const cause = pgliteError(
    '53300',
    `too many connections for /afspraak/annuleren/${CANCEL_TOKEN}`,
    sql,
    params,
  );
  return failedQuery(sql, params, cause);
}

/**
 * A Google write that failed twice (`getProviderAccessToken()`): storing the
 * fresh token fails, then recording that error (its message holds the
 * encrypted token) fails as well.
 */
function googleWriteFailure(): Error {
  const tokenSql =
    'update "cms_providers" set "google_access_token" = $1, "google_access_expires_at" = $2 where "cms_providers"."id" = $3';
  const tokenParams = [GOOGLE_TOKEN_ENC, '2026-10-20T09:00:00.000Z', 'prv-kanarie'];
  const tokenWrite = failedQuery(
    tokenSql,
    tokenParams,
    pgliteError('57P01', 'terminating connection', tokenSql, tokenParams),
  );
  const errorSql =
    'update "cms_providers" set "google_sync_error" = $1 where "cms_providers"."id" = $2';
  const errorParams = [tokenWrite.message, 'prv-kanarie'];
  return failedQuery(
    errorSql,
    errorParams,
    pgliteError('57P01', 'terminating connection', errorSql, errorParams),
  );
}

/**
 * `error` behind a proxy that notes every operation on it. The handler is a
 * proxy as well, so each trap lookup (`get`, `has`, `ownKeys`, …) is recorded
 * and then falls through to the default behaviour.
 */
function watched(error: object): { error: object; touched: string[] } {
  const touched: string[] = [];
  const handler = new Proxy(
    {},
    {
      get(_handler, trap) {
        touched.push(String(trap));
        return undefined;
      },
    },
  );
  return { error: new Proxy(error, handler), touched };
}

/** Every event once; the type fails the typecheck when one is added or removed. */
const EVENT_SET: Record<BookingLogEvent, true> = {
  create_failed: true,
  cancel_failed: true,
  google_event_failed: true,
  google_delete_failed: true,
  confirmation_mail_failed: true,
  cancellation_mail_failed: true,
  availability_action_failed: true,
  book_action_failed: true,
  cancel_action_failed: true,
  confirmation_ref_unsigned: true,
  admin_google_delete_failed: true,
  admin_cancellation_mail_failed: true,
};
const EVENTS = Object.keys(EVENT_SET) as BookingLogEvent[];

/** Every console call of a test, with its level. */
let calls: Array<{ level: string; args: unknown[] }> = [];

beforeEach(() => {
  calls = [];
  for (const level of ['debug', 'info', 'log', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      calls.push({ level, args });
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

function json(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Each logged argument as JSON and as Node prints it (deeper than `console` does). */
function renderings(args: unknown[]): string[] {
  return args.flatMap((arg) => [json(arg), inspect(arg, { depth: 10 })]);
}

function expectNoLeak() {
  expect(calls.length).toBeGreaterThan(0);
  for (const { args } of calls) {
    for (const text of renderings(args)) {
      const lower = text.toLowerCase();
      for (const [label, value] of LEAKS) {
        expect(lower.includes(value.toLowerCase()), `${label} leaked: ${text}`).toBe(false);
      }
      expect(text.includes('@'), `an e-mail address leaked: ${text}`).toBe(false);
    }
  }
}

describe('logBookingFailure', () => {
  it.each(EVENTS)('%s: one console.error line, the fixed code and the booking id', (event) => {
    logBookingFailure(event, BOOKING_ID);
    expect(calls).toStrictEqual([
      { level: 'error', args: [`[booking] ${event}`, { event, bookingId: BOOKING_ID }] },
    ]);
    expectNoLeak();
  });

  it('without a booking id: the fixed code only', () => {
    logBookingFailure('create_failed');
    expect(calls).toStrictEqual([
      { level: 'error', args: ['[booking] create_failed', { event: 'create_failed' }] },
    ]);
    expectNoLeak();
  });

  it.each<[string, string | null | undefined]>([
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
    ['not a UUID', 'booking-17'],
    ['an e-mail address', CUSTOMER_EMAIL],
    ['a UUID followed by a name', `${BOOKING_ID} ${CUSTOMER_NAME}`],
    ['a UUID followed by a new line', `${BOOKING_ID}\n${CUSTOMER_NAME}`],
    ['a cancel token', CANCEL_TOKEN],
  ])('leaves out a booking id that is %s', (_label, bookingId) => {
    logBookingFailure('create_failed', bookingId);
    expect(calls[0].args).toStrictEqual(['[booking] create_failed', { event: 'create_failed' }]);
    expectNoLeak();
  });

  it.each<[string, () => Error]>([
    ['a failed insert on Neon', leakyInsertFailure],
    ['a failed token lookup on PGlite', tokenLookupFailure],
    ['a Google write that failed twice', googleWriteFailure],
  ])('takes no error: %s, passed anyway, is neither read nor logged', (_label, failure) => {
    // A call in the old shape, `(event, error, bookingId)`, from plain JS or
    // behind a cast: the error lands where the id goes, or after it.
    const untyped = logBookingFailure as (...args: unknown[]) => void;
    const { error, touched } = watched(failure());
    untyped('create_failed', error, BOOKING_ID);
    untyped('google_event_failed', BOOKING_ID, error);
    expect(touched).toStrictEqual([]);
    expect(calls).toStrictEqual([
      { level: 'error', args: ['[booking] create_failed', { event: 'create_failed' }] },
      {
        level: 'error',
        args: [
          '[booking] google_event_failed',
          { event: 'google_event_failed', bookingId: BOOKING_ID },
        ],
      },
    ]);
    expectNoLeak();
  });

  it('never throws, whatever is passed as the booking id', () => {
    const untyped = logBookingFailure as (...args: unknown[]) => void;
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error(CUSTOMER_EMAIL);
        },
      },
    );
    const { proxy: revoked, revoke } = Proxy.revocable({}, {});
    revoke();
    const ids: unknown[] = [hostile, revoked, Symbol(CUSTOMER_NAME), CUSTOMER_AGE, [BOOKING_ID]];
    for (const bookingId of ids) {
      expect(() => untyped('create_failed', bookingId)).not.toThrow();
    }
    expect(calls).toStrictEqual(
      ids.map(() => ({
        level: 'error',
        args: ['[booking] create_failed', { event: 'create_failed' }],
      })),
    );
    expectNoLeak();
  });
});

describe('isUniqueViolation', () => {
  it('is true for SQLSTATE 23505 on the Neon error behind Drizzle', () => {
    const neon = Object.assign(new Error(UNIQUE_MESSAGE), {
      name: 'NeonDbError',
      code: '23505',
      constraint: 'cms_bookings_provider_start_confirmed_key',
    });
    expect(isUniqueViolation(failedQuery(INSERT_SQL, INSERT_PARAMS, neon))).toBe(true);
  });

  it('is true for SQLSTATE 23505 on the PGlite error behind Drizzle', () => {
    const pglite = pgliteError('23505', UNIQUE_MESSAGE, INSERT_SQL, INSERT_PARAMS);
    expect(isUniqueViolation(failedQuery(INSERT_SQL, INSERT_PARAMS, pglite))).toBe(true);
  });

  it('is true for 23505 on an unwrapped error or deeper in the cause chain', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ cause: { cause: { code: '23505' } } })).toBe(true);
  });

  it('is false when only the visitor’s notes say "duplicate key" (cause 22021)', () => {
    const notes = `${UNIQUE_MESSAGE} \u0000`;
    const params = INSERT_PARAMS.map((value) => (value === NOTES ? notes : value));
    const cause = pgliteError(
      '22021',
      `invalid byte sequence for encoding "UTF8": 0x00 (${notes})`,
      INSERT_SQL,
      params,
    );
    const error = failedQuery(INSERT_SQL, params, cause);
    // What the old message check matched on.
    expect(error.message).toContain('duplicate key');
    expect(cause.message).toContain('unique constraint');
    expect(isUniqueViolation(error)).toBe(false);
  });

  it('has no message fallback: without SQLSTATE 23505 nothing is a unique violation', () => {
    expect(isUniqueViolation(new Error(UNIQUE_MESSAGE))).toBe(false);
    expect(isUniqueViolation({ message: 'unique constraint' })).toBe(false);
    const wrapped = Object.assign(new Error('x'), { cause: new Error(UNIQUE_MESSAGE) });
    expect(isUniqueViolation(wrapped)).toBe(false);
  });

  it('wants the code as text, and only follows cause', () => {
    expect(isUniqueViolation({ code: 23505 })).toBe(false);
    expect(isUniqueViolation({ sourceError: { code: '23505' } })).toBe(false);
  });

  it('is false for anything that is not an object, and for a cause loop', () => {
    for (const value of [null, undefined, '23505', 23505, UNIQUE_MESSAGE]) {
      expect(isUniqueViolation(value)).toBe(false);
    }
    const first: Record<string, unknown> = { code: '22021' };
    first.cause = { code: '57P01', cause: first };
    expect(isUniqueViolation(first)).toBe(false);
  });

  it('does not throw on a hostile error', () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error(CUSTOMER_EMAIL);
        },
      },
    );
    expect(isUniqueViolation(hostile)).toBe(false);
  });
});
