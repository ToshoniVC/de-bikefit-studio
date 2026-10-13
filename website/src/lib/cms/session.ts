import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { CmsDatabase } from '@/db/cms';
import { cmsSessions, cmsUsers, type CmsUser, type CmsUserPublic } from '@/db/cms-schema';
import { isProduction } from '@/lib/env';
import { sessionSecret } from '@/lib/secrets';
import {
  adminAbsoluteEnd,
  evaluateSession,
  initialSessionTimes,
  sessionCookieExpiry,
  sessionPolicyFor,
} from './session-policy';

/**
 * Opaque server-side sessions for the CMS.
 *
 * - 32 random bytes, base64url-encoded, are handed to the browser in the
 *   `cms_session` cookie and never stored anywhere else.
 * - The database only ever holds `HMAC-SHA256(token, CMS_SESSION_SECRET)`
 *   (`sessionSecret()` in `src/lib/secrets.ts`), so a
 *   leaked `cms_sessions` dump cannot be replayed, and rotating the secret
 *   invalidates every live session at once.
 * - Lifetime by role (`./session-policy.ts`): admin sessions end after 15
 *   minutes without a request and 8 hours after sign-in at the latest;
 *   editor and provider sessions keep 14 days with sliding renewal.
 * - `reauthenticated_at` records the last full authentication (sign-in or
 *   step-up); sensitive admin changes need it to be recent.
 * - `mfa_verified_at` records that the session passed the second step. A
 *   session is only ever created after it (`createSession(…, { mfaVerified })`),
 *   never upgraded in place, so a password-only token can never become an
 *   MFA token. Password sign-in of an admin creates no session at all: it
 *   issues a challenge (`src/lib/cms/mfa/challenge.ts`).
 *
 * The DB-level helpers below take an explicit `db`, so migration/bootstrap/
 * self-test scripts can use them outside a request. The cookie helpers at the
 * bottom import `next/headers` lazily for the same reason.
 */

export const SESSION_COOKIE_NAME = 'cms_session';

const TOKEN_BYTES = 32;

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHmac('sha256', sessionSecret()).update(token).digest('hex');
}

/** Constant-time compare for two hex digests of equal length. */
export function sessionTokenMatches(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashSessionToken(token), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export type CreatedSession = {
  id: string;
  token: string;
  expiresAt: Date;
  /** What the `cms_session` cookie gets (`sessionCookieExpiry()`). */
  cookieExpiresAt: Date;
};

export type SessionContext = {
  userAgent?: string | null;
  ipAddress?: string | null;
};

export type CreateSessionOptions = {
  /**
   * The second step (TOTP or recovery code) was completed for this session.
   * Admin sessions are refused without it (`src/lib/cms/guard.ts`). Set only by
   * the MFA flow (`src/lib/cms/mfa/flow.ts`), by `changePassword()` when the
   * session it replaces had it, and by the CMS CLIs, whose operator holds the
   * database credentials (`scripts/lib/cms-actor.mts`).
   */
  mfaVerified?: boolean;
  /**
   * A full authentication just happened (password and, for admins, the second
   * step): opens the step-up window for sensitive changes. Set by the MFA
   * sign-in and by the CLIs, never by a password-only sign-in of an admin.
   */
  reauthenticated?: boolean;
  /**
   * The session this one replaces (password change, new authenticator). The
   * new session inherits its absolute end and its step-up time, so replacing
   * a session never extends either.
   */
  replaces?: { absoluteExpiresAt: Date | null; reauthenticatedAt: Date | null } | null;
};

export async function createSession(
  db: CmsDatabase,
  userId: string,
  context: SessionContext = {},
  options: CreateSessionOptions = {},
): Promise<CreatedSession> {
  const [user] = await db
    .select({ role: cmsUsers.role })
    .from(cmsUsers)
    .where(eq(cmsUsers.id, userId))
    .limit(1);
  if (!user) throw new Error('createSession: unknown user');

  const token = generateSessionToken();
  const now = new Date();
  const times = initialSessionTimes(user.role, now, options.replaces);
  const reauthenticatedAt =
    options.reauthenticated === true ? now : (options.replaces?.reauthenticatedAt ?? null);

  const [row] = await db
    .insert(cmsSessions)
    .values({
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt: times.expiresAt,
      absoluteExpiresAt: times.absoluteExpiresAt,
      // One clock for all three: the absolute cap is computed from created_at.
      createdAt: now,
      lastUsedAt: now,
      reauthenticatedAt,
      userAgent: context.userAgent?.slice(0, 500) ?? null,
      ipAddress: context.ipAddress ?? null,
      mfaVerifiedAt: options.mfaVerified === true ? now : null,
    })
    .returning({ id: cmsSessions.id });

  return {
    id: row.id,
    token,
    expiresAt: times.expiresAt,
    cookieExpiresAt: sessionCookieExpiry(user.role, { createdAt: now, ...times }),
  };
}

export type ResolvedSession = {
  user: CmsUserPublic;
  sessionId: string;
  /** The session completed the second step (`mfa_verified_at` is set). */
  mfaVerified: boolean;
  /** Last full authentication on this session; drives the step-up window. */
  reauthenticatedAt: Date | null;
  /** Effective absolute end (admins), to hand on when this session is replaced. */
  absoluteExpiresAt: Date | null;
  expiresAt: Date;
  cookieExpiresAt: Date;
  /** True when a standard session's expiry just slid forward — refresh the cookie. */
  renewed: boolean;
};

/**
 * Looks a raw cookie token up and applies the lifetime rules of
 * `./session-policy.ts` for the user's current role. Returns null for
 * unknown, expired (idle, absolute or plain) or deactivated-user sessions;
 * expired rows are deleted on the spot.
 *
 * Use is recorded with a conditional UPDATE that only moves `last_used_at`
 * forward and never touches a row that has already expired, so concurrent
 * requests cannot rewind it or bring a dead session back.
 */
export async function resolveSession(
  db: CmsDatabase,
  token: string | undefined | null,
  now: Date = new Date(),
): Promise<ResolvedSession | null> {
  if (!token) return null;

  const rows = await db
    .select({ session: cmsSessions, user: cmsUsers })
    .from(cmsSessions)
    .innerJoin(cmsUsers, eq(cmsSessions.userId, cmsUsers.id))
    .where(eq(cmsSessions.tokenHash, hashSessionToken(token)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  if (!row.user.isActive) {
    await db.delete(cmsSessions).where(eq(cmsSessions.userId, row.user.id));
    return null;
  }

  const decision = evaluateSession(row.user.role, row.session, now);
  if (!decision.valid) {
    await db.delete(cmsSessions).where(eq(cmsSessions.id, row.session.id));
    return null;
  }

  if (decision.touch) {
    await db
      .update(cmsSessions)
      .set({ lastUsedAt: now, expiresAt: decision.expiresAt })
      .where(
        and(
          eq(cmsSessions.id, row.session.id),
          lt(cmsSessions.lastUsedAt, now),
          gt(cmsSessions.expiresAt, now),
        ),
      );
  }

  return {
    user: toPublicUser(row.user),
    sessionId: row.session.id,
    mfaVerified: row.session.mfaVerifiedAt !== null,
    reauthenticatedAt: row.session.reauthenticatedAt ?? null,
    absoluteExpiresAt:
      sessionPolicyFor(row.user.role) === 'admin'
        ? adminAbsoluteEnd(row.session)
        : (row.session.absoluteExpiresAt ?? null),
    expiresAt: decision.expiresAt,
    cookieExpiresAt: sessionCookieExpiry(row.user.role, {
      ...row.session,
      expiresAt: decision.expiresAt,
    }),
    renewed: decision.renewed,
  };
}

/** Records a successful step-up ("Bevestig je identiteit") on one session. */
export async function markSessionReauthenticated(
  db: CmsDatabase,
  sessionId: string,
  at: Date = new Date(),
): Promise<void> {
  await db
    .update(cmsSessions)
    .set({ reauthenticatedAt: at })
    .where(and(eq(cmsSessions.id, sessionId), gt(cmsSessions.expiresAt, at)));
}

export async function revokeSession(db: CmsDatabase, token: string): Promise<void> {
  await db.delete(cmsSessions).where(eq(cmsSessions.tokenHash, hashSessionToken(token)));
}

export async function revokeSessionById(db: CmsDatabase, sessionId: string): Promise<void> {
  await db.delete(cmsSessions).where(eq(cmsSessions.id, sessionId));
}

/** Used after a password change, a second-factor change and when an admin deactivates an account. */
export async function revokeAllUserSessions(db: CmsDatabase, userId: string): Promise<void> {
  await db.delete(cmsSessions).where(eq(cmsSessions.userId, userId));
}

export async function revokeOtherUserSessions(
  db: CmsDatabase,
  userId: string,
  keepSessionId: string,
): Promise<void> {
  const rows = await db
    .select({ id: cmsSessions.id })
    .from(cmsSessions)
    .where(eq(cmsSessions.userId, userId));
  for (const row of rows) {
    if (row.id !== keepSessionId) await revokeSessionById(db, row.id);
  }
}

export async function pruneExpiredSessions(db: CmsDatabase): Promise<void> {
  await db.delete(cmsSessions).where(lt(cmsSessions.expiresAt, new Date()));
}

/** Strips the password hash before a user object leaves this module. */
export function toPublicUser(user: CmsUser): CmsUserPublic {
  const copy: Partial<CmsUser> = { ...user };
  delete copy.passwordHash;
  return copy as CmsUserPublic;
}

// ---------------------------------------------------------------------------
// Cookie helpers (request scope only)
// ---------------------------------------------------------------------------

/**
 * `next/headers` is imported lazily so this module stays usable from plain Node
 * scripts. In Next 16 `cookies()` is async and may only be awaited inside a
 * request scope (server component, route handler or server action).
 */
async function cookieStore() {
  const { cookies } = await import('next/headers');
  return cookies();
}

function cookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  };
}

export async function readSessionCookie(): Promise<string | undefined> {
  const store = await cookieStore();
  return store.get(SESSION_COOKIE_NAME)?.value;
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookieStore();
  store.set(SESSION_COOKIE_NAME, token, cookieOptions(expiresAt));
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookieStore();
  store.set(SESSION_COOKIE_NAME, '', { ...cookieOptions(new Date(0)), maxAge: 0 });
}
