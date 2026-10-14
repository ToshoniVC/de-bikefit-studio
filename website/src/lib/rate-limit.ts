import { and, eq, sql } from 'drizzle-orm';
import type { CmsDatabase } from '@/db/cms';
import { cmsRateLimits } from '@/db/cms-rate-limit-schema';

/**
 * Race-free rate limits for public (anonymous) writes, on `cms_rate_limits`
 * (`drizzle/0008_cms_rate_limits.sql`). The caller's policy says which scopes
 * and limits (`src/lib/booking/rate-limit-policy.ts` for the online booking).
 * Takes an explicit `db` and is not `server-only`, so the self-test loads it.
 *
 * **Reserve, then act.** A request first RESERVES one hit in each of its
 * scopes ({@link reserveRateLimit}); only then does it do the work the limit
 * protects. When a scope is full, the hits already taken in the earlier scopes
 * are given back and the request is refused, so a refused request holds
 * nothing. What a granted reservation keeps is the caller's policy: the
 * booking flow keeps it whatever the outcome (every attempt counts);
 * {@link releaseRateLimit} gives one back when an attempt should not count.
 *
 * **One statement per reservation.** neon-http has no interactive
 * transactions: every statement is its own READ COMMITTED transaction
 * (`src/db/cms.ts`). A reservation is therefore a single
 * `INSERT … ON CONFLICT (scope) DO UPDATE SET hits = <hits in the window> ||
 * <now> WHERE <hits in the window> < limit RETURNING`, decided entirely on
 * the scope's own row: Postgres locks the conflicting row and evaluates the
 * WHERE and SET on its latest committed version, so concurrent reservations
 * of one scope queue on that lock and each sees the hits of those before it.
 * A `count(*)` over a log table would not be safe, not even inside one
 * statement: its snapshot misses rows that concurrent requests insert. A
 * release removes exactly ONE occurrence of its own timestamp, again in one
 * statement, so two parallel requests with the same millisecond stay correct.
 *
 * Statement for statement the same as the second-step limiter
 * (`src/lib/cms/mfa/rate-limit.ts` on `cms_mfa_rate_limits`, which keeps a
 * user column for its remedies); that one can move onto this helper later.
 *
 * Windows are at most a day: rows that no reservation touched for a day hold
 * no hit inside any window and are pruned on the way ({@link pruneRateLimits}).
 */

export type RateLimitScope = {
  /** Primary key of the scope's row in `cms_rate_limits`, namespaced by the policy (`booking:…`). */
  key: string;
  /** Hits allowed inside the window. */
  limit: number;
  /** The sliding window, at most a day. */
  windowMs: number;
};

export type RateLimitReservation = {
  /** The hit's time (ISO 8601, milliseconds), exactly as stored in `hits`. */
  at: string;
  /** The scopes holding the hit, in reservation order. */
  scopes: string[];
};

export type ReservedRateLimit = { ok: true; reservation: RateLimitReservation } | { ok: false };

/** One hit in one scope, or false when the scope already holds `limit` hits in its window. */
async function reserveHit(
  db: CmsDatabase,
  scope: RateLimitScope,
  at: string,
  nowMs: number,
): Promise<boolean> {
  const since = new Date(nowMs - scope.windowMs).toISOString();
  const hits = cmsRateLimits.hits;
  const rows = await db
    .insert(cmsRateLimits)
    .values({
      scope: scope.key,
      hits: sql`ARRAY[${at}::timestamptz]`,
      updatedAt: new Date(at),
    })
    .onConflictDoUpdate({
      target: cmsRateLimits.scope,
      set: {
        hits: sql`array_append(ARRAY(SELECT h FROM unnest(${hits}) AS h WHERE h > ${since}::timestamptz ORDER BY h), ${at}::timestamptz)`,
        updatedAt: sql`greatest(${cmsRateLimits.updatedAt}, ${at}::timestamptz)`,
      },
      setWhere: sql`(SELECT count(*) FROM unnest(${hits}) AS h WHERE h > ${since}::timestamptz) < ${scope.limit}::int`,
    })
    .returning({ scope: cmsRateLimits.scope });
  return rows.length === 1;
}

/** Removes one occurrence of `at` from the scope; a hit already pruned is simply gone. */
async function releaseHit(db: CmsDatabase, key: string, at: string): Promise<void> {
  const hits = cmsRateLimits.hits;
  const position = sql`array_position(${hits}, ${at}::timestamptz)`;
  await db
    .update(cmsRateLimits)
    .set({ hits: sql`${hits}[:${position} - 1] || ${hits}[${position} + 1:]` })
    .where(and(eq(cmsRateLimits.scope, key), sql`${at}::timestamptz = ANY(${hits})`));
}

/**
 * Reserves one hit in every scope, in the order given (a key listed twice
 * counts once). When a scope is full, the hits already taken are given back
 * and the result is `{ ok: false }`: rate limited. Prunes first, so an error
 * there never leaves a hit behind. A statement that throws (the database is
 * down) propagates; a hit taken before it stays until it leaves its window.
 */
export async function reserveRateLimit(
  db: CmsDatabase,
  scopes: readonly RateLimitScope[],
  nowMs: number = Date.now(),
): Promise<ReservedRateLimit> {
  await pruneRateLimits(db);
  const reservation: RateLimitReservation = { at: new Date(nowMs).toISOString(), scopes: [] };
  for (const scope of scopes) {
    if (reservation.scopes.includes(scope.key)) continue;
    if (!(await reserveHit(db, scope, reservation.at, nowMs))) {
      await releaseRateLimit(db, reservation);
      return { ok: false };
    }
    reservation.scopes.push(scope.key);
  }
  return { ok: true, reservation };
}

/** Gives a reservation back, one hit in each of its scopes. */
export async function releaseRateLimit(
  db: CmsDatabase,
  reservation: RateLimitReservation,
): Promise<void> {
  for (const key of reservation.scopes) await releaseHit(db, key, reservation.at);
}

/**
 * Opportunistic pruning (data minimisation: the keys hold IP addresses and
 * e-mail hashes): a row no reservation touched for a day has no hit left
 * inside any window.
 */
export async function pruneRateLimits(db: CmsDatabase): Promise<void> {
  await db.delete(cmsRateLimits).where(sql`${cmsRateLimits.updatedAt} < now() - interval '1 day'`);
}
