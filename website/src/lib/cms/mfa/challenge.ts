import { and, eq, lt, sql } from 'drizzle-orm';
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
 * The pre-MFA state: what a correct password buys an admin. It is NOT a
 * session. It lives in its own table and its own `cms_mfa` cookie, no auth
 * guard ever reads it, and it grants no CMS access: the only things it can do
 * are the steps of `/admin/mfa` (`./flow.ts`): change a temporary password,
 * enrol an authenticator, enter a code. A full session is created only after
 * the second step succeeds.
 *
 * - Token: 32 random bytes, like a session token; the database stores only its
 *   HMAC, in its own domain ({@link hashChallengeToken}), so the same bytes
 *   could never match as both a challenge and a session.
 * - Lifetime {@link MFA_CHALLENGE_TTL_MS}, never extended. One live challenge
 *   per user: a new password sign-in replaces the previous one.
 * - {@link MFA_CHALLENGE_MAX_FAILURES} wrong codes delete it; the user then has
 *   to enter the password again (on top of the per-user/IP limits in `./repo`).
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

export async function createMfaChallenge(
  db: CmsDatabase,
  userId: string,
  context: SessionContext = {},
): Promise<CreatedChallenge> {
  await db.delete(cmsMfaChallenges).where(eq(cmsMfaChallenges.userId, userId));
  // Opportunistic pruning, as for login attempts.
  await db.delete(cmsMfaChallenges).where(lt(cmsMfaChallenges.expiresAt, new Date()));

  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + MFA_CHALLENGE_TTL_MS);
  const [row] = await db
    .insert(cmsMfaChallenges)
    .values({
      userId,
      tokenHash: hashChallengeToken(token),
      expiresAt,
      userAgent: context.userAgent?.slice(0, 500) ?? null,
      ipAddress: context.ipAddress ?? null,
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
  const usedUp = row.challenge.failedAttempts >= MFA_CHALLENGE_MAX_FAILURES;
  if (expired || usedUp || !row.user.isActive) {
    await deleteMfaChallenge(db, row.challenge.id);
    return null;
  }
  return { id: row.challenge.id, user: toPublicUser(row.user), expiresAt: row.challenge.expiresAt };
}

/**
 * Counts one wrong code against the challenge (atomic increment); deletes it
 * once the limit is reached. Returns whether the challenge is still usable.
 */
export async function recordChallengeFailure(db: CmsDatabase, id: string): Promise<boolean> {
  const [row] = await db
    .update(cmsMfaChallenges)
    .set({ failedAttempts: sql`${cmsMfaChallenges.failedAttempts} + 1` })
    .where(eq(cmsMfaChallenges.id, id))
    .returning({ failedAttempts: cmsMfaChallenges.failedAttempts });
  if (!row) return false;
  if (row.failedAttempts >= MFA_CHALLENGE_MAX_FAILURES) {
    await deleteMfaChallenge(db, id);
    return false;
  }
  return true;
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
