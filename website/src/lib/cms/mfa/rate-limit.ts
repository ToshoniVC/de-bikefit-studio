import { and, eq, sql } from 'drizzle-orm';
import type { CmsDatabase } from '@/db/cms';
import { cmsMfaAttempts, cmsMfaRateLimits } from '@/db/cms-mfa-schema';
import { mfaRateLimitScopes, type MfaRateLimitScope } from './rate-limit-policy';

/**
 * Database half of the second-step rate limits; which scopes and limits:
 * `./rate-limit-policy.ts`. Takes an explicit `db` and is not `server-only`,
 * like `./repo.ts`, so the break-glass CLI and the self-test load it.
 *
 * **Reserve, then check.** Every code check (sign-in, enrolment, replacement,
 * re-authentication, `./outcome.ts` and `./reauth.ts`) first RESERVES one hit
 * in each of its scopes ({@link reserveMfaAttempt}); only then is the code
 * (or password) looked at. A failure keeps its hits. A success, or a result
 * that says nothing about the code (an unreadable factor, a missing key, a
 * busy password hasher), gives them back ({@link releaseMfaAttempt}). So per
 * scope and window at most `limit` checks are in flight or failed, however
 * many requests run in parallel, and successes never count.
 *
 * **One statement per reservation.** neon-http has no interactive
 * transactions: every statement is its own READ COMMITTED transaction
 * (`src/db/cms.ts`). A reservation is therefore a single
 * `INSERT … ON CONFLICT (scope) DO UPDATE SET hits = <hits in the window> ||
 * <now> WHERE <hits in the window> < limit RETURNING`, decided entirely on
 * the scope's own row: Postgres locks the conflicting row and evaluates the
 * WHERE and SET on its latest committed version, so concurrent reservations
 * of one scope queue on that lock and each sees the hits of those before it.
 * A `count(*)` over a log table inside the statement would not be safe: its
 * snapshot misses rows that concurrent requests insert. A release removes
 * exactly ONE occurrence of its own timestamp, again in one statement, so two
 * parallel requests with the same millisecond stay correct.
 *
 * Rows that no reservation touched for a day hold no hit inside any window
 * and are pruned on the way ({@link pruneMfaRateLimits}).
 */

export type MfaReservation = {
  /** The hit's time (ISO 8601, milliseconds), exactly as stored in `hits`. */
  at: string;
  /** The scopes holding the hit, in reservation order. */
  scopes: string[];
};

export type ReservedMfaAttempt = { ok: true; reservation: MfaReservation } | { ok: false };

/** One hit in one scope, or false when the scope already holds `limit` hits in its window. */
async function reserveHit(
  db: CmsDatabase,
  scope: MfaRateLimitScope,
  at: string,
  nowMs: number,
): Promise<boolean> {
  const since = new Date(nowMs - scope.windowMs).toISOString();
  const hits = cmsMfaRateLimits.hits;
  const rows = await db
    .insert(cmsMfaRateLimits)
    .values({
      scope: scope.key,
      userId: scope.userId,
      hits: sql`ARRAY[${at}::timestamptz]`,
      updatedAt: new Date(at),
    })
    .onConflictDoUpdate({
      target: cmsMfaRateLimits.scope,
      set: {
        hits: sql`array_append(ARRAY(SELECT h FROM unnest(${hits}) AS h WHERE h > ${since}::timestamptz ORDER BY h), ${at}::timestamptz)`,
        updatedAt: sql`greatest(${cmsMfaRateLimits.updatedAt}, ${at}::timestamptz)`,
      },
      setWhere: sql`(SELECT count(*) FROM unnest(${hits}) AS h WHERE h > ${since}::timestamptz) < ${scope.limit}::int`,
    })
    .returning({ scope: cmsMfaRateLimits.scope });
  return rows.length === 1;
}

/** Removes one occurrence of `at` from the scope; a hit already pruned is simply gone. */
async function releaseHit(db: CmsDatabase, key: string, at: string): Promise<void> {
  const hits = cmsMfaRateLimits.hits;
  const position = sql`array_position(${hits}, ${at}::timestamptz)`;
  await db
    .update(cmsMfaRateLimits)
    .set({ hits: sql`${hits}[:${position} - 1] || ${hits}[${position} + 1:]` })
    .where(and(eq(cmsMfaRateLimits.scope, key), sql`${at}::timestamptz = ANY(${hits})`));
}

/**
 * Reserves one check for `userId` from `ip` in every scope, user + IP first,
 * then the IP, then the user's day. When a scope is full, the hits already
 * taken are given back and the result is `{ ok: false }`: rate limited.
 * Prunes first, so an error there never leaves a hit behind.
 */
export async function reserveMfaAttempt(
  db: CmsDatabase,
  userId: string,
  ip: string,
  nowMs: number = Date.now(),
): Promise<ReservedMfaAttempt> {
  await pruneMfaRateLimits(db);
  const reservation: MfaReservation = { at: new Date(nowMs).toISOString(), scopes: [] };
  for (const scope of mfaRateLimitScopes(userId, ip)) {
    if (!(await reserveHit(db, scope, reservation.at, nowMs))) {
      await releaseMfaAttempt(db, reservation);
      return { ok: false };
    }
    reservation.scopes.push(scope.key);
  }
  return { ok: true, reservation };
}

/** Gives a reservation back: the check succeeded, or its result did not count. */
export async function releaseMfaAttempt(
  db: CmsDatabase,
  reservation: MfaReservation,
): Promise<void> {
  for (const key of reservation.scopes) await releaseHit(db, key, reservation.at);
}

/**
 * Forgets the user's counters: the remedies for a leaked password (a new
 * password via `changePassword` or the challenge step, an admin's password or
 * MFA reset, the break-glass CLI) end a lock-out someone caused by guessing.
 * The IP-wide scope has no owner and runs out by itself.
 */
export async function clearMfaAttempts(db: CmsDatabase, userId: string): Promise<void> {
  await db.delete(cmsMfaRateLimits).where(eq(cmsMfaRateLimits.userId, userId));
}

/**
 * Opportunistic pruning (data minimisation: the keys hold IP addresses): a
 * row no reservation touched for a day has no hit left inside any window.
 * Also removes what is left of the attempt log of before 0007, which nothing
 * writes any more.
 */
export async function pruneMfaRateLimits(db: CmsDatabase): Promise<void> {
  await db
    .delete(cmsMfaRateLimits)
    .where(sql`${cmsMfaRateLimits.updatedAt} < now() - interval '1 day'`);
  await db
    .delete(cmsMfaAttempts)
    .where(sql`${cmsMfaAttempts.attemptedAt} < now() - interval '1 day'`);
}
