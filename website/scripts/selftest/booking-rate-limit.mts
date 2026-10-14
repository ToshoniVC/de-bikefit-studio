/**
 * Self-test section 14b: the public booking rate limit under concurrency
 * (review finding R-2, 14 Oct 2026), on the throwaway PGlite of
 * `cms-selftest.mts`, through the real `createPublicBooking()` and the shared
 * helper `src/lib/rate-limit.ts`. Runs after section 14.
 *
 * Every attempt asks for a start in 2020, so one that gets past the limit
 * stops at the slot re-check (`slot_taken`, like section 14's sequential
 * check): nothing is booked or mailed. A throwaway service carries the
 * attempts and is deleted at the end. Answers are counted per request.
 *
 *  A. migration 0008: the table, its columns and index; additive (the old
 *     `cms_booking_rate_limit` untouched), re-runnable;
 *  B. the helper: 12 parallel reservations in one millisecond → exactly 5; a
 *     release frees exactly one of five equal hits; a refused two-scope
 *     reservation keeps nothing; hits outside the window do not count; a row
 *     untouched for a day is pruned;
 *  C. one IP, 20 e-mails in parallel → exactly 5 pass, the IP holds 5 hits;
 *  D. one e-mail, 20 IPs in parallel → exactly 5 pass, the e-mail holds 5
 *     hits, every refused attempt gave its IP hit back;
 *  E. no usable IP (missing or malformed), one e-mail → exactly 5 pass, no
 *     IP key written;
 *  F. one guardian e-mail, 20 customers and IPs → exactly 5 pass;
 *  G. the stored keys hold no address; bookings no longer write
 *     `cms_booking_rate_limit`;
 *  H. without the table (0008 not applied) an attempt fails closed: `error`
 *     and one `[booking] create_failed` line.
 *
 * Every burst uses its own addresses, so no burst sees another's hits.
 * Imported lazily by `cms-selftest.mts` after its request-context stubs.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CmsDatabase } from '@/db/cms';

type Check = (label: string, condition: boolean, detail?: string) => void;

const BURST = 20;
const LIMIT = 5;
const WINDOW_MS = 15 * 60 * 1000;
const PAST_START = '2020-01-01T09:00:00.000Z';
const SERVICE_SLUG = 'selftest-parallel-rate-limit';

const tally = (answers: string[]) =>
  [...new Set(answers)].map((a) => `${a}×${answers.filter((b) => b === a).length}`).join(', ');
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

export async function bookingRateLimitSection(ctx: {
  db: CmsDatabase;
  check: Check;
  section: (title: string) => void;
}) {
  const { db, check, section } = ctx;
  section('14b. public booking rate limit under concurrency (reserve before the slot check)');

  const { eq, inArray, like, sql } = await import('drizzle-orm');
  const { cmsBookingRateLimit, cmsServices } = await import('@/db/cms-schema');
  const { cmsRateLimits } = await import('@/db/cms-rate-limit-schema');
  const { createPublicBooking } = await import('@/lib/booking/public-booking');
  const { bookingEmailKey, bookingIpKey } = await import('@/lib/booking/rate-limit-policy');
  const { pruneRateLimits, releaseRateLimit, reserveRateLimit } = await import('@/lib/rate-limit');

  const rowsOf = async (query: ReturnType<typeof sql>) =>
    ((await db.execute(query)) as unknown as { rows: Array<Record<string, string>> }).rows;
  const hitsIn = async (key: string | null) =>
    key === null
      ? 0
      : Number(
          (
            await db
              .select({ n: sql<number>`cardinality(${cmsRateLimits.hits})` })
              .from(cmsRateLimits)
              .where(eq(cmsRateLimits.scope, key))
          )[0]?.n ?? 0,
        );
  const rowExists = async (key: string) =>
    (
      await db
        .select({ scope: cmsRateLimits.scope })
        .from(cmsRateLimits)
        .where(eq(cmsRateLimits.scope, key))
    ).length === 1;
  const legacyRows = async () =>
    Number((await db.select({ n: sql<number>`count(*)::int` }).from(cmsBookingRateLimit))[0]?.n);
  const parallel = <T,>(count: number, make: (i: number) => Promise<T>) =>
    Promise.all(Array.from({ length: count }, (_, i) => make(i)));

  // Every key this section writes, for the clean-up.
  const used = new Set<string>();
  const ipKey = (ip: string) => {
    const key = bookingIpKey(ip);
    if (key) used.add(key);
    return key;
  };
  const emailKey = (email: string) => {
    const key = bookingEmailKey(email);
    used.add(key);
    return key;
  };

  // --- A. migration 0008 ----------------------------------------------------------
  const columns = await rowsOf(
    sql`select column_name, data_type, is_nullable from information_schema.columns
        where table_name = 'cms_rate_limits' order by column_name`,
  );
  check(
    'migration 0008: cms_rate_limits (scope, hits timestamptz[], updated_at)',
    columns.map((c) => `${c.column_name}:${c.data_type}:${c.is_nullable}`).join(' ') ===
      'hits:ARRAY:NO scope:text:NO updated_at:timestamp with time zone:NO',
    JSON.stringify(columns),
  );
  const indexes = (
    await rowsOf(sql`select indexname from pg_indexes where tablename = 'cms_rate_limits'`)
  )
    .map((row) => row.indexname)
    .sort();
  check(
    'migration 0008: primary key on scope + index on updated_at',
    indexes.join(' ') === 'cms_rate_limits_pkey cms_rate_limits_updated_at_idx',
    indexes.join(', '),
  );
  const migrationSql = await readFile(
    resolve(process.cwd(), 'drizzle/0008_cms_rate_limits.sql'),
    'utf8',
  );
  const code0008 = migrationSql.replace(/^--.*$/gm, '');
  check(
    'migration 0008: additive (one CREATE TABLE + one CREATE INDEX, both IF NOT EXISTS; no DROP / TRUNCATE / DELETE / UPDATE / ALTER, no webshop table, cms_booking_rate_limit untouched)',
    !/\b(DROP|TRUNCATE|DELETE|ALTER)\b|\bUPDATE\s+"?\w+"?\s+SET\b/i.test(code0008) &&
      !/"(users|products|orders|order_items|cms_booking_rate_limit)"/.test(code0008) &&
      (code0008.match(/\bCREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/g) ?? []).length === 1 &&
      (code0008.match(/\bCREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\b/g) ?? []).length === 1 &&
      (code0008.match(/\bCREATE\b/g) ?? []).length === 2,
  );
  let rerun = 'ok';
  try {
    for (let pass = 0; pass < 2; pass += 1) {
      for (const statement of migrationSql.split('--> statement-breakpoint')) {
        if (statement.replace(/^--.*$/gm, '').trim()) await db.execute(sql.raw(statement));
      }
    }
  } catch (error) {
    rerun = error instanceof Error ? error.message : String(error);
  }
  check('migration 0008: re-running it twice is a no-op', rerun === 'ok', rerun);
  const legacyColumns = (
    await rowsOf(
      sql`select column_name from information_schema.columns
          where table_name = 'cms_booking_rate_limit' order by column_name`,
    )
  ).map((row) => row.column_name);
  check(
    'cms_booking_rate_limit unchanged (the gift voucher requests still use it)',
    legacyColumns.join(',') === 'attempted_at,email,id,ip_address',
    legacyColumns.join(','),
  );

  // --- B. the helper on its own --------------------------------------------------------
  const scope = (key: string) => ({ key, limit: LIMIT, windowMs: WINDOW_MS });
  const ONE = 'selftest:helper:one';
  const FREE = 'selftest:helper:free';
  const STALE = 'selftest:helper:window';
  const OLD = 'selftest:helper:old';
  for (const key of [ONE, FREE, STALE, OLD]) used.add(key);

  const sameMs = Date.now();
  const twelve = await parallel(12, () => reserveRateLimit(db, [scope(ONE)], sameMs));
  check(
    'helper: 12 parallel reservations (one millisecond) → exactly 5 granted, 5 hits stored',
    twelve.filter((r) => r.ok).length === LIMIT && (await hitsIn(ONE)) === LIMIT,
    `${twelve.filter((r) => r.ok).length} granted, ${await hitsIn(ONE)} hits`,
  );
  const granted = twelve.find((r) => r.ok) as Extract<(typeof twelve)[number], { ok: true }>;
  await releaseRateLimit(db, granted.reservation);
  const afterRelease = await hitsIn(ONE);
  const three = await parallel(3, () => reserveRateLimit(db, [scope(ONE)]));
  check(
    'helper: a release frees exactly ONE of five equal hits; one of three parallel granted again',
    afterRelease === LIMIT - 1 &&
      three.filter((r) => r.ok).length === 1 &&
      (await hitsIn(ONE)) === LIMIT,
    `${afterRelease} hits after the release, ${three.filter((r) => r.ok).length} of 3 granted`,
  );
  const refused = await reserveRateLimit(db, [scope(FREE), scope(ONE)]);
  check(
    'helper: a full later scope refuses the reservation and the earlier scope keeps nothing',
    !refused.ok && (await hitsIn(FREE)) === 0,
  );
  await db.insert(cmsRateLimits).values({
    scope: STALE,
    hits: sql`array_fill(now() - interval '16 minutes', ARRAY[${LIMIT}::int])::timestamptz[]`,
  });
  const afterWindow = await reserveRateLimit(db, [scope(STALE)]);
  check(
    'helper: five hits older than the window do not count and are dropped on the next reservation',
    afterWindow.ok && (await hitsIn(STALE)) === 1,
  );
  await db.insert(cmsRateLimits).values({
    scope: OLD,
    hits: sql`ARRAY[now() - interval '2 days']::timestamptz[]`,
    updatedAt: sql`now() - interval '25 hours'`,
  });
  await pruneRateLimits(db);
  check(
    'helper: a row untouched for a day is pruned, a fresh one kept',
    !(await rowExists(OLD)) && (await rowExists(ONE)),
  );

  // --- set-up: a throwaway service; every attempt asks for a start in 2020 ------------
  await db.delete(cmsServices).where(eq(cmsServices.slug, SERVICE_SLUG));
  const [service] = await db
    .insert(cmsServices)
    .values({ slug: SERVICE_SLUG, name: 'Parallel (selftest)', durationMinutes: 60 })
    .returning({ id: cmsServices.id });
  const legacyBefore = await legacyRows();
  const book = async (
    customerEmail: string,
    ipAddress: string | null,
    extra: Record<string, string> = {},
  ) => {
    const result = await createPublicBooking(
      {
        serviceId: service.id,
        providerId: null,
        startsAt: PAST_START,
        customerName: 'Parallel Klant',
        customerEmail,
        ...extra,
      },
      { ipAddress },
    );
    return result.ok ? 'booked' : result.code;
  };
  const passedOnly = (answers: string[]) =>
    answers.filter((a) => a !== 'rate_limited').length === LIMIT &&
    answers.filter((a) => a === 'rate_limited').length === BURST - LIMIT &&
    answers.every((a) => a === 'slot_taken' || a === 'rate_limited');

  try {
    // --- C. one IP, many e-mails ------------------------------------------------------
    const IP_C = '192.0.2.10';
    const mailsC = Array.from({ length: BURST }, (_, i) => `parallel-ip-${i}@selftest.local`);
    const answersC = await Promise.all(mailsC.map((mail) => book(mail, IP_C)));
    const mailHitsC = await Promise.all(mailsC.map((mail) => hitsIn(emailKey(mail))));
    const ipHitsC = await hitsIn(ipKey(IP_C));
    check(
      `one IP, ${BURST} e-mails in parallel → exactly ${LIMIT} reach the slot check, the rest rate_limited`,
      passedOnly(answersC),
      tally(answersC),
    );
    check(
      `one IP: its scope holds exactly ${LIMIT} hits; only the attempts that passed hold an e-mail hit`,
      ipHitsC === LIMIT &&
        answersC.every((a, i) => mailHitsC[i] === (a === 'rate_limited' ? 0 : 1)),
      `IP ${ipHitsC} hits, e-mails ${sum(mailHitsC)}`,
    );

    // --- D. one e-mail, many IPs ------------------------------------------------------
    const MAIL_D = 'parallel-mail@selftest.local';
    const ipsD = Array.from({ length: BURST }, (_, i) => `192.0.2.${100 + i}`);
    const answersD = await Promise.all(ipsD.map((ip) => book(MAIL_D, ip)));
    const ipHitsD = await Promise.all(ipsD.map((ip) => hitsIn(ipKey(ip))));
    const mailHitsD = await hitsIn(emailKey(MAIL_D));
    check(
      `one e-mail, ${BURST} IPs in parallel → exactly ${LIMIT} reach the slot check, the rest rate_limited`,
      passedOnly(answersD),
      tally(answersD),
    );
    check(
      `one e-mail: its scope holds exactly ${LIMIT} hits; each IP at most one, a refused attempt gave its IP hit back`,
      mailHitsD === LIMIT &&
        answersD.every((a, i) => ipHitsD[i] === (a === 'rate_limited' ? 0 : 1)),
      `e-mail ${mailHitsD} hits, IPs ${ipHitsD.join('')}`,
    );

    // --- E. no usable IP ------------------------------------------------------------------
    const ipKeys = async () =>
      (
        await db
          .select({ scope: cmsRateLimits.scope })
          .from(cmsRateLimits)
          .where(like(cmsRateLimits.scope, 'booking:ip:%'))
      )
        .map((row) => row.scope)
        .sort();
    const ipKeysBefore = await ipKeys();
    const MAIL_E = 'parallel-unknown@selftest.local';
    const mailKeyE = emailKey(MAIL_E);
    // Half without an IP, half with text that is not one: neither is a key.
    const answersE = await parallel(BURST, (i) => book(MAIL_E, i % 2 ? null : 'unknown'));
    const ipKeysAfter = await ipKeys();
    const mailHitsE = await hitsIn(mailKeyE);
    check(
      `no usable IP, one e-mail, ${BURST} in parallel → exactly ${LIMIT} reach the slot check`,
      passedOnly(answersE) && mailHitsE === LIMIT,
      `${tally(answersE)}; e-mail ${mailHitsE} hits`,
    );
    check(
      'no usable IP: no IP key written (no shared "unknown" bucket)',
      ipKeysAfter.join(' ') === ipKeysBefore.join(' '),
      `${ipKeysBefore.length} → ${ipKeysAfter.length} IP keys`,
    );

    // --- F. one guardian e-mail, many customers and IPs ---------------------------------
    const GUARDIAN_F = 'parallel-voogd@selftest.local';
    const guardianKeyF = emailKey(GUARDIAN_F);
    const kidsF = Array.from({ length: BURST }, (_, i) => `parallel-kind-${i}@selftest.local`);
    const ipsF = Array.from({ length: BURST }, (_, i) => `192.0.2.${200 + i}`);
    const answersF = await Promise.all(
      kidsF.map((kid, i) =>
        book(kid, ipsF[i], { guardianName: 'Parallel Voogd', guardianEmail: GUARDIAN_F }),
      ),
    );
    const guardianHitsF = await hitsIn(guardianKeyF);
    const kidHitsF = await Promise.all(kidsF.map((kid) => hitsIn(emailKey(kid))));
    const ipHitsF = await Promise.all(ipsF.map((ip) => hitsIn(ipKey(ip))));
    check(
      `one guardian e-mail, ${BURST} customers and IPs in parallel → exactly ${LIMIT} reach the slot check`,
      passedOnly(answersF) && guardianHitsF === LIMIT,
      `${tally(answersF)}; guardian ${guardianHitsF} hits`,
    );
    check(
      'guardian burst: a refused attempt gave back both earlier hits (its IP and its customer e-mail)',
      answersF.every(
        (a, i) => kidHitsF[i] === (a === 'rate_limited' ? 0 : 1) && ipHitsF[i] === kidHitsF[i],
      ),
      `customers ${sum(kidHitsF)}, IPs ${sum(ipHitsF)} hits`,
    );

    // --- G. what is stored ----------------------------------------------------------------
    const keys = (
      await db
        .select({ scope: cmsRateLimits.scope })
        .from(cmsRateLimits)
        .where(like(cmsRateLimits.scope, 'booking:%'))
    ).map((row) => row.scope);
    check(
      'stored keys: booking:ip:<address> or booking:email:<SHA-256 hex>, never an e-mail address',
      keys.length > 0 &&
        keys.every((key) => /^booking:(ip:[0-9a-f.:]+|email:[0-9a-f]{64})$/.test(key)) &&
        keys.includes(`booking:email:${sha256(MAIL_D)}`),
      `${keys.length} keys`,
    );
    const legacyAfter = await legacyRows();
    check(
      'bookings no longer write cms_booking_rate_limit',
      legacyAfter === legacyBefore,
      `${legacyBefore} → ${legacyAfter} rows`,
    );

    // --- H. a database without 0008 -----------------------------------------------------
    // Test-only: the table is renamed away and back, standing for a database that
    // has not run 0008 yet (the deploy order in staging-runbook.md §3.1).
    const errors: unknown[][] = [];
    const realError = console.error;
    let withoutTable = 'not run';
    await db.execute(sql.raw('ALTER TABLE "cms_rate_limits" RENAME TO "cms_rate_limits_hidden"'));
    try {
      console.error = (...args: unknown[]) => {
        errors.push(args);
      };
      withoutTable = await book('parallel-zonder-tabel@selftest.local', '192.0.2.250');
    } finally {
      console.error = realError;
      await db.execute(sql.raw('ALTER TABLE "cms_rate_limits_hidden" RENAME TO "cms_rate_limits"'));
    }
    check(
      'without the table (0008 not applied) an attempt fails closed: error, one [booking] create_failed line',
      withoutTable === 'error' &&
        errors.length === 1 &&
        JSON.stringify(errors[0]) ===
          JSON.stringify(['[booking] create_failed', { event: 'create_failed' }]),
      `${withoutTable}; ${errors.length} line(s)`,
    );
  } finally {
    await db.delete(cmsRateLimits).where(inArray(cmsRateLimits.scope, [...used]));
    await db.delete(cmsServices).where(eq(cmsServices.id, service.id));
  }

  const leftKeys = await db
    .select({ scope: cmsRateLimits.scope })
    .from(cmsRateLimits)
    .where(inArray(cmsRateLimits.scope, [...used]));
  const leftService = await db
    .select({ id: cmsServices.id })
    .from(cmsServices)
    .where(eq(cmsServices.slug, SERVICE_SLUG));
  check(
    'cleanup: the scopes of this section and the throwaway service are gone',
    leftKeys.length === 0 && leftService.length === 0,
    `${used.size} scopes removed`,
  );
}
