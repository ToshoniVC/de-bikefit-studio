import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import type { CmsDatabase } from '@/db/cms';
import { cmsSessions, cmsUsers, type CmsUser, type CmsUserPublic } from '@/db/cms-schema';
import { isProduction } from '@/lib/env';
import { sessionSecret } from '@/lib/secrets';

/**
 * Opaque server-side sessions for the CMS.
 *
 * - 32 random bytes, base64url-encoded, are handed to the browser in the
 *   `cms_session` cookie and never stored anywhere else.
 * - The database only ever holds `HMAC-SHA256(token, CMS_SESSION_SECRET)`
 *   (`sessionSecret()` in `src/lib/secrets.ts`), so a
 *   leaked `cms_sessions` dump cannot be replayed, and rotating the secret
 *   invalidates every live session at once.
 * - 14-day lifetime with sliding renewal: once a session is past its halfway
 *   point, using it pushes the expiry back out to a full 14 days.
 *
 * The DB-level helpers below take an explicit `db`, so migration/bootstrap/
 * self-test scripts can use them outside a request. The cookie helpers at the
 * bottom import `next/headers` lazily for the same reason.
 */

export const SESSION_COOKIE_NAME = 'cms_session';
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Renew when less than half the lifetime remains. */
export const SESSION_RENEW_AFTER_MS = SESSION_TTL_MS / 2;

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
};

export type SessionContext = {
  userAgent?: string | null;
  ipAddress?: string | null;
};

export async function createSession(
  db: CmsDatabase,
  userId: string,
  context: SessionContext = {},
): Promise<CreatedSession> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const [row] = await db
    .insert(cmsSessions)
    .values({
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
      userAgent: context.userAgent?.slice(0, 500) ?? null,
      ipAddress: context.ipAddress ?? null,
    })
    .returning({ id: cmsSessions.id });

  return { id: row.id, token, expiresAt };
}

export type ResolvedSession = {
  user: CmsUserPublic;
  sessionId: string;
  expiresAt: Date;
  /** True when the expiry was just slid forward — refresh the cookie. */
  renewed: boolean;
};

/**
 * Looks a raw cookie token up, validates it and applies sliding renewal.
 * Returns null for unknown, expired or deactivated-user sessions.
 */
export async function resolveSession(
  db: CmsDatabase,
  token: string | undefined | null,
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

  const now = Date.now();
  if (row.session.expiresAt.getTime() <= now) {
    await db.delete(cmsSessions).where(eq(cmsSessions.id, row.session.id));
    return null;
  }
  if (!row.user.isActive) {
    await db.delete(cmsSessions).where(eq(cmsSessions.userId, row.user.id));
    return null;
  }

  let expiresAt = row.session.expiresAt;
  const renewed = expiresAt.getTime() - now < SESSION_RENEW_AFTER_MS;
  if (renewed) {
    expiresAt = new Date(now + SESSION_TTL_MS);
    await db
      .update(cmsSessions)
      .set({ expiresAt, lastUsedAt: new Date(now) })
      .where(eq(cmsSessions.id, row.session.id));
  }

  return { user: toPublicUser(row.user), sessionId: row.session.id, expiresAt, renewed };
}

export async function revokeSession(db: CmsDatabase, token: string): Promise<void> {
  await db.delete(cmsSessions).where(eq(cmsSessions.tokenHash, hashSessionToken(token)));
}

export async function revokeSessionById(db: CmsDatabase, sessionId: string): Promise<void> {
  await db.delete(cmsSessions).where(eq(cmsSessions.id, sessionId));
}

/** Used after a password change and when an admin deactivates an account. */
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
