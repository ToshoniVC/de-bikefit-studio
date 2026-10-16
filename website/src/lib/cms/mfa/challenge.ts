import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { CmsDatabase } from '@/db/cms';
import { cmsMfaChallenges } from '@/db/cms-mfa-schema';
import { cmsUsers, type CmsUserPublic } from '@/db/cms-schema';
import { isProduction } from '@/lib/env';
import {
  generateSessionToken,
  hashSessionToken,
  toPublicUser,
  type SessionContext,
} from '../session';

/**
 * The pre-MFA state: what a correct password buys an admin, a provider or an
 * editor with an authenticator. It is NOT a session. It lives in its own table and its own `cms_mfa` cookie, no auth
 * guard ever reads it, and it grants no CMS access: the only things it can do
 * are the steps of `/admin/mfa` (`./flow.ts`): change a temporary password,
 * enrol an authenticator, enter a code. A full session is created only after
 * the second step succeeds.
 *
 * - Token: 32 random bytes, like a session token; the database stores only its
 *   HMAC, in its own domain ({@link hashChallengeToken}), so the same bytes
 *   could never match as both a challenge and a session.
 * - Lifetime {@link MFA_CHALLENGE_TTL_MS}, never extended. One challenge per
 *   user (unique index, migration 0007): a new password sign-in replaces the
 *   row in one upsert, with a new id and token, so the old cookie and an
 *   enrolment bound to the old id stop working.
 * - At most {@link MFA_CHALLENGE_MAX_FAILURES} checks (codes, or the password
 *   at the password step) per challenge: each one is RESERVED on the row
 *   before it runs ({@link reserveChallengeAttempt}, one conditional UPDATE),
 *   given back when it did not count, and the failure that uses up the last
 *   slot deletes the challenge; the user then has to enter the password
 *   again. This is on top of the per-user/IP and daily limits
 *   (`./rate-limit.ts`), which a new sign-in does NOT reset.
 * - Cookie: `httpOnly`, `sameSite=lax`, `secure` in production, `path=/admin`.
 *
 * DB helpers take an explicit `db` so the self-test can drive them; the cookie
 * helpers import `next/headers` lazily, as in `../session.ts`.
 */

export const MFA_CHALLENGE_COOKIE = 'cms_mfa';
export const MFA_CHALLENGE_TTL_MS = 10 * 60 * 1000;
export const MFA_CHALLENGE_MAX_FAILURES = 5;

export type CreatedChallenge = { id: string; token: string; expiresAt: Date };

/** HMAC of a challenge token, domain-separated from session tokens. */
export function hashChallengeToken(token: string): string {
  return hashSessionToken(`cms-mfa-challenge:${token}`);
}

/**
 * The user's one challenge, created or replaced in a single upsert, so two
 * sign-ins at once leave one row (the later one), never two. A replaced row
 * gets a new id, token and expiry and its slots back; the per-user/IP and
 * daily counters are untouched, so signing in again buys no extra codes.
 */
export async function createMfaChallenge(
  db: CmsDatabase,
  userId: string,
  context: SessionContext = {},
): Promise<CreatedChallenge> {
  // Opportunistic pruning, as for login attempts.
  await db.delete(cmsMfaChallenges).where(lt(cmsMfaChallenges.expiresAt, new Date()));

  const token = generateSessionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MFA_CHALLENGE_TTL_MS);
  const [row] = await db
    .insert(cmsMfaChallenges)
    .values({
      userId,
      tokenHash: hashChallengeToken(token),
      expiresAt,
      failedAttempts: 0,
      createdAt: now,
      userAgent: context.userAgent?.slice(0, 500) ?? null,
      ipAddress: context.ipAddress ?? null,
    })
    .onConflictDoUpdate({
      target: cmsMfaChallenges.userId,
      set: {
        id: sql`excluded.id`,
        tokenHash: sql`excluded.token_hash`,
        expiresAt: sql`excluded.expires_at`,
        failedAttempts: 0,
        createdAt: sql`excluded.created_at`,
        userAgent: sql`excluded.user_agent`,
        ipAddress: sql`excluded.ip_address`,
      },
    })
    .returning({ id: cmsMfaChallenges.id });
  return { id: row.id, token, expiresAt };
}

export type ResolvedChallenge = {
  id: string;
  user: CmsUserPublic;
  expiresAt: Date;
};

/** The live challenge for a raw cookie token, or null (unknown, expired, used up, inactive user). */
export async function resolveMfaChallenge(
  db: CmsDatabase,
  token: string | null | undefined,
): Promise<ResolvedChallenge | null> {
  if (!token) return null;
  const [row] = await db
    .select({ challenge: cmsMfaChallenges, user: cmsUsers })
    .from(cmsMfaChallenges)
    .innerJoin(cmsUsers, eq(cmsMfaChallenges.userId, cmsUsers.id))
    .where(eq(cmsMfaChallenges.tokenHash, hashChallengeToken(token)))
    .limit(1);
  if (!row) return null;

  const expired = row.challenge.expiresAt.getTime() <= Date.now();
  if (expired || !row.user.isActive) {
    await deleteMfaChallenge(db, row.challenge.id);
    return null;
  }
  // Every slot reserved: no further check can start. Not deleted here, so a
  // last check still in flight can finish; if it fails, it deletes the row.
  if (row.challenge.failedAttempts >= MFA_CHALLENGE_MAX_FAILURES) return null;
  return { id: row.challenge.id, user: toPublicUser(row.user), expiresAt: row.challenge.expiresAt };
}

/**
 * Reserves one check on the challenge BEFORE the code (or password) is looked
 * at: one conditional `UPDATE … SET failed_attempts = failed_attempts + 1
 * WHERE failed_attempts < MAX AND expires_at > now() RETURNING`, so parallel
 * requests can never take more than {@link MFA_CHALLENGE_MAX_FAILURES} slots.
 * Returns the slot taken (1 … MAX), or null when the challenge is gone,
 * expired or used up.
 */
export async function reserveChallengeAttempt(db: CmsDatabase, id: string): Promise<number | null> {
  const [row] = await db
    .update(cmsMfaChallenges)
    .set({ failedAttempts: sql`${cmsMfaChallenges.failedAttempts} + 1` })
    .where(
      and(
        eq(cmsMfaChallenges.id, id),
        lt(cmsMfaChallenges.failedAttempts, MFA_CHALLENGE_MAX_FAILURES),
        sql`${cmsMfaChallenges.expiresAt} > now()`,
      ),
    )
    .returning({ failedAttempts: cmsMfaChallenges.failedAttempts });
  return row ? row.failedAttempts : null;
}

/** Gives a reserved slot back: the check succeeded at the password step, or did not count. */
export async function releaseChallengeAttempt(db: CmsDatabase, id: string): Promise<void> {
  await db
    .update(cmsMfaChallenges)
    .set({ failedAttempts: sql`${cmsMfaChallenges.failedAttempts} - 1` })
    .where(and(eq(cmsMfaChallenges.id, id), gt(cmsMfaChallenges.failedAttempts, 0)));
}

/**
 * A reserved check failed: its slot stays taken, and the failure in the last
 * slot deletes the challenge. Returns whether the challenge is still usable.
 */
export async function settleChallengeFailure(
  db: CmsDatabase,
  id: string,
  slot: number,
): Promise<boolean> {
  if (slot < MFA_CHALLENGE_MAX_FAILURES) return true;
  await deleteMfaChallenge(db, id);
  return false;
}

/**
 * Single use: deletes the challenge and reports whether this call was the one
 * that deleted it, so two concurrent completions cannot both issue a session.
 */
export async function consumeMfaChallenge(db: CmsDatabase, id: string): Promise<boolean> {
  const rows = await db
    .delete(cmsMfaChallenges)
    .where(and(eq(cmsMfaChallenges.id, id), sql`${cmsMfaChallenges.expiresAt} > now()`))
    .returning({ id: cmsMfaChallenges.id });
  return rows.length === 1;
}

export async function deleteMfaChallenge(db: CmsDatabase, id: string): Promise<void> {
  await db.delete(cmsMfaChallenges).where(eq(cmsMfaChallenges.id, id));
}

export async function deleteUserMfaChallenges(db: CmsDatabase, userId: string): Promise<void> {
  await db.delete(cmsMfaChallenges).where(eq(cmsMfaChallenges.userId, userId));
}

// ---------------------------------------------------------------------------
// Cookie helpers (request scope only)
// ---------------------------------------------------------------------------

async function cookieStore() {
  const { cookies } = await import('next/headers');
  return cookies();
}

function cookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax' as const,
    path: '/admin',
    expires: expiresAt,
  };
}

export async function readChallengeCookie(): Promise<string | undefined> {
  const store = await cookieStore();
  return store.get(MFA_CHALLENGE_COOKIE)?.value;
}

export async function setChallengeCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookieStore();
  store.set(MFA_CHALLENGE_COOKIE, token, cookieOptions(expiresAt));
}

export async function clearChallengeCookie(): Promise<void> {
  const store = await cookieStore();
  store.set(MFA_CHALLENGE_COOKIE, '', { ...cookieOptions(new Date(0)), maxAge: 0 });
}
