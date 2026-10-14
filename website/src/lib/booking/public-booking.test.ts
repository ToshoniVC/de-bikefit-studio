import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelBookingByToken,
  createPublicBooking,
  generateCancelToken,
  hashCancelToken,
} from './public-booking';

// The pure token helpers, and what the two public flows log when a query
// fails. `server-only` is stubbed in vitest.config.ts and `@/db/cms` is
// replaced by a database whose every query fails, so nothing here opens a
// real one. The log helper itself is covered in `booking-log.test.ts`.

/** A database handle whose every query rejects with `state.failure` once awaited. */
const fake = vi.hoisted(() => {
  const state: { failure: unknown } = { failure: new Error('no failure set') };
  const query: Record<string, unknown> = {
    then: (
      onFulfilled?: ((value: never) => unknown) | null,
      onRejected?: ((reason: unknown) => unknown) | null,
    ) => Promise.reject(state.failure).then(onFulfilled, onRejected),
  };
  for (const step of ['from', 'where', 'limit', 'values', 'set', 'returning']) {
    query[step] = () => query;
  }
  const db = {
    select: () => query,
    insert: () => query,
    update: () => query,
    delete: () => query,
  };
  return { state, db };
});

vi.mock('@/db/cms', () => ({ getCmsDb: async () => fake.db }));

describe('hashCancelToken', () => {
  it('is deterministic', () => {
    const token = generateCancelToken();
    expect(hashCancelToken(token)).toBe(hashCancelToken(token));
  });

  it('is the lowercase hex SHA-256 of the token', () => {
    expect(hashCancelToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashCancelToken(generateCancelToken())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives different tokens different hashes, case-sensitively', () => {
    expect(hashCancelToken('Abc')).not.toBe(hashCancelToken('abc'));
    const token = generateCancelToken();
    expect(hashCancelToken(token)).not.toContain(token);
  });
});

describe('generateCancelToken', () => {
  it('is 32 random bytes as unpadded base64url (43 characters)', () => {
    for (let i = 0; i < 20; i += 1) {
      const token = generateCancelToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    }
  });

  it('does not repeat', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateCancelToken()));
    expect(tokens.size).toBe(200);
  });
});

describe('public flows: a failed query is logged without personal data', () => {
  const CUSTOMER_EMAIL = 'kanarie.klant@lek-test.invalid';
  const CLIENT_IP = '203.0.113.77';
  const INPUT = {
    serviceId: 'svc-bikefit',
    providerId: null,
    startsAt: '2026-10-20T08:00:00.000Z',
    customerName: 'Kanarie Klant-Vogelaar',
    customerEmail: CUSTOMER_EMAIL,
    customerPhone: '+32 470 11 22 33',
    customerAge: 113,
    guardianName: 'Kanarie Voogd-Vogelaar',
    guardianEmail: 'kanarie.voogd@lek-test.invalid',
    guardianPhone: '+32 499 98 76 54',
    customerAddress: 'Kanariestraat 17, 9999 Vogeldorp',
    bikeDetails: 'Kanarie Racer, maat 58',
    notes: 'Kanarie-notitie: knie links',
    website: '',
    locale: 'nl',
  };

  /** Drizzle's wrapper as 0.45 builds it: the params in the message and as a property. */
  function failedQuery(query: string, params: unknown[], cause: unknown): Error {
    return Object.assign(new Error(`Failed query: ${query}\nparams: ${params.join(',')}`), {
      query,
      params,
      cause,
    });
  }

  let logged: Array<{ level: string; args: unknown[] }> = [];

  beforeEach(() => {
    logged = [];
    for (const level of ['debug', 'info', 'log', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push({ level, args });
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** No console call, as JSON or as Node prints it, contains any of `values`. */
  function expectNoneLogged(values: string[]) {
    for (const { args } of logged) {
      let json: string;
      try {
        json = JSON.stringify(args);
      } catch {
        json = '';
      }
      for (const text of [json, inspect(args, { depth: 10 })]) {
        for (const value of values) {
          const leaked = text.toLowerCase().includes(value.toLowerCase());
          expect(leaked, `${value} leaked: ${text}`).toBe(false);
        }
      }
    }
  }

  it('createPublicBooking: a failed rate-limit query, the generic error and one safe line', async () => {
    const sql =
      'select count(*)::int from "cms_booking_rate_limit" where ("cms_booking_rate_limit"."attempted_at" >= $1 and ("cms_booking_rate_limit"."email" = $2 OR "cms_booking_rate_limit"."ip_address" = $3))';
    const params = ['2026-10-20T07:45:00.000Z', CUSTOMER_EMAIL, CLIENT_IP];
    fake.state.failure = failedQuery(
      sql,
      params,
      Object.assign(new Error(`connection to ${CLIENT_IP} failed for ${CUSTOMER_EMAIL}`), {
        name: 'NeonDbError',
        code: '08006',
        detail: `params: ${params.join(', ')}`,
      }),
    );

    const result = await createPublicBooking(INPUT, {
      ipAddress: CLIENT_IP,
      now: new Date('2026-10-20T07:45:00.000Z'),
    });

    expect(result).toStrictEqual({
      ok: false,
      code: 'error',
      message: 'Er ging iets mis bij het boeken. Probeer het opnieuw of bel ons.',
      fieldErrors: {},
    });
    expect(logged).toHaveLength(1);
    expect(logged[0].level).toBe('error');
    expect(logged[0].args).toStrictEqual(['[booking] create_failed', { event: 'create_failed' }]);
    expectNoneLogged([CUSTOMER_EMAIL, CLIENT_IP, 'kanarie', 'Failed query', 'params', '@']);
  });

  it('cancelBookingByToken: a failed token lookup, the generic error and one safe line', async () => {
    const token = generateCancelToken();
    const hash = hashCancelToken(token);
    const sql =
      'select "id", "cancel_token_hash" from "cms_bookings" where "cms_bookings"."cancel_token_hash" = $1 limit $2';
    const params = [hash, 1];
    fake.state.failure = failedQuery(
      sql,
      params,
      Object.assign(new Error(`terminating connection; link /afspraak/annuleren/${token}`), {
        name: 'DatabaseError',
        code: '57P01',
        query: sql,
        params,
      }),
    );

    const result = await cancelBookingByToken(token);

    expect(result).toStrictEqual({
      ok: false,
      code: 'error',
      message: 'Er ging iets mis. Probeer het opnieuw of bel ons.',
      booking: null,
    });
    expect(logged).toHaveLength(1);
    expect(logged[0].level).toBe('error');
    expect(logged[0].args).toStrictEqual(['[booking] cancel_failed', { event: 'cancel_failed' }]);
    expectNoneLogged([token, hash, 'cancel_token_hash', 'Failed query', 'params']);
  });
});
