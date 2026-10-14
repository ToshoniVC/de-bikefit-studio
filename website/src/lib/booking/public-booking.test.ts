import { createHash } from 'node:crypto';
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelBookingByToken,
  createPublicBooking,
  generateCancelToken,
  hashCancelToken,
} from './public-booking';

// The pure token helpers, what the two public flows log when a query fails,
// and how `createPublicBooking()` answers when the rate-limit reservation
// refuses. `server-only` is stubbed in vitest.config.ts and `@/db/cms` is
// replaced by a fake database, so nothing here opens a real one. The log
// helper itself is covered in `booking-log.test.ts`; the reservation on a real
// database in self-test section 14b.

/**
 * A database handle: every awaited query takes the next entry of
 * `state.results` (the rows it resolves to) and, once those are used up,
 * rejects with `state.failure`. `state.awaited` counts the awaited queries.
 */
const fake = vi.hoisted(() => {
  const state: { failure: unknown; results: unknown[][]; awaited: number } = {
    failure: new Error('no failure set'),
    results: [],
    awaited: 0,
  };
  const query: Record<string, unknown> = {
    then: (
      onFulfilled?: ((value: never) => unknown) | null,
      onRejected?: ((reason: unknown) => unknown) | null,
    ) => {
      state.awaited += 1;
      const rows = state.results.shift();
      const settled: Promise<never> = rows
        ? Promise.resolve(rows as never)
        : Promise.reject(state.failure);
      return settled.then(onFulfilled, onRejected);
    },
  };
  for (const step of [
    'from',
    'where',
    'limit',
    'values',
    'set',
    'returning',
    'onConflictDoUpdate',
  ]) {
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
    fake.state.results = [];
    fake.state.awaited = 0;
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

  // What the reservation binds (`src/lib/rate-limit.ts`): the scope key, which
  // holds the client IP or the e-mail hash, and the hit's time.
  const AT = '2026-10-20T07:45:00.000Z';
  const SINCE = '2026-10-20T07:30:00.000Z';
  const IP_KEY = `booking:ip:${CLIENT_IP}`;
  const EMAIL_KEY = `booking:email:${createHash('sha256').update(CUSTOMER_EMAIL).digest('hex')}`;
  const RESERVE_SQL =
    'insert into "cms_rate_limits" ("scope", "hits", "updated_at") values ($1, ARRAY[$2::timestamptz], $3) on conflict ("scope") do update set "hits" = array_append(ARRAY(SELECT h FROM unnest("cms_rate_limits"."hits") AS h WHERE h > $4::timestamptz ORDER BY h), $5::timestamptz), "updated_at" = greatest("cms_rate_limits"."updated_at", $6::timestamptz) where (SELECT count(*) FROM unnest("cms_rate_limits"."hits") AS h WHERE h > $7::timestamptz) < $8::int returning "scope"';
  const reserveFailure = (key: string) => {
    const params = [key, AT, AT, SINCE, AT, AT, SINCE, 5];
    return failedQuery(
      RESERVE_SQL,
      params,
      Object.assign(new Error(`connection to ${CLIENT_IP} failed for ${CUSTOMER_EMAIL}`), {
        name: 'NeonDbError',
        code: '08006',
        detail: `params: ${params.join(', ')}`,
      }),
    );
  };
  const book = () =>
    createPublicBooking(INPUT, { ipAddress: CLIENT_IP, now: new Date('2026-10-20T07:45:00.000Z') });
  const GENERIC_ERROR = {
    ok: false,
    code: 'error',
    message: 'Er ging iets mis bij het boeken. Probeer het opnieuw of bel ons.',
    fieldErrors: {},
  };
  const RATE_LIMITED = {
    ok: false,
    code: 'rate_limited',
    message: 'Te veel boekingen op korte tijd. Probeer het over een kwartier opnieuw of bel ons.',
    fieldErrors: {},
  };
  const NOT_LOGGED = [
    CUSTOMER_EMAIL,
    CLIENT_IP,
    EMAIL_KEY.slice('booking:email:'.length),
    'booking:',
    'kanarie',
    'Failed query',
    'params',
    '@',
  ];
  function expectOneSafeLine() {
    expect(logged).toHaveLength(1);
    expect(logged[0].level).toBe('error');
    expect(logged[0].args).toStrictEqual(['[booking] create_failed', { event: 'create_failed' }]);
    expectNoneLogged(NOT_LOGGED);
  }

  it('createPublicBooking: a failed rate-limit query, the generic error and one safe line', async () => {
    // The prune passes; reserving the IP scope fails.
    fake.state.results = [[]];
    fake.state.failure = reserveFailure(IP_KEY);

    expect(await book()).toStrictEqual(GENERIC_ERROR);
    expectOneSafeLine();
    expect(fake.state.awaited).toBe(2);
  });

  it('createPublicBooking: a failed prune (before any reservation), the generic error and one safe line', async () => {
    fake.state.failure = failedQuery(
      'delete from "cms_rate_limits" where "cms_rate_limits"."updated_at" < now() - interval \'1 day\'',
      [],
      Object.assign(new Error(`connection to ${CLIENT_IP} failed for ${CUSTOMER_EMAIL}`), {
        name: 'NeonDbError',
        code: '08006',
      }),
    );

    expect(await book()).toStrictEqual(GENERIC_ERROR);
    expectOneSafeLine();
    expect(fake.state.awaited).toBe(1);
  });

  it('createPublicBooking: the e-mail scope fails after the IP scope was reserved, still one safe line', async () => {
    fake.state.results = [[], [{ scope: IP_KEY }]];
    fake.state.failure = reserveFailure(EMAIL_KEY);

    expect(await book()).toStrictEqual(GENERIC_ERROR);
    expectOneSafeLine();
    expect(fake.state.awaited).toBe(3);
  });

  it('createPublicBooking: a full first scope → rate_limited before the service check, nothing logged', async () => {
    // Prune, then the IP scope's upsert returns no row: full. Nothing to give back.
    fake.state.results = [[], []];

    expect(await book()).toStrictEqual(RATE_LIMITED);
    expect(logged).toHaveLength(0);
    expect(fake.state.awaited).toBe(2);
  });

  it('createPublicBooking: a full e-mail scope gives the IP hit back (one statement) → rate_limited', async () => {
    // Prune, IP reserved, e-mail full, then the release of the IP hit.
    fake.state.results = [[], [{ scope: IP_KEY }], [], []];

    expect(await book()).toStrictEqual(RATE_LIMITED);
    expect(logged).toHaveLength(0);
    expect(fake.state.awaited).toBe(4);
  });

  it('createPublicBooking: a release that fails still refuses, with the generic error and one safe line', async () => {
    fake.state.results = [[], [{ scope: IP_KEY }], []];
    fake.state.failure = failedQuery(
      'update "cms_rate_limits" set "hits" = … where ("cms_rate_limits"."scope" = $3 and …)',
      [AT, AT, IP_KEY, AT],
      new Error(`release failed for ${CLIENT_IP}`),
    );

    expect(await book()).toStrictEqual(GENERIC_ERROR);
    expectOneSafeLine();
    expect(fake.state.awaited).toBe(4);
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
