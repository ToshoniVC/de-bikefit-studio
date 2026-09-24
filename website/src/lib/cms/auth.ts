import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { cache } from 'react';
import { getCmsDb, type CmsDatabase } from '@/db/cms';
import {
  cmsAuditLog,
  cmsLoginAttempts,
  cmsUsers,
  type CmsRole,
  type CmsUserPublic,
} from '@/db/cms-schema';
import { can, roleAtLeast, type CmsPermission } from './permissions';
import {
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
  generateTemporaryPassword,
} from './password';
import {
  clearSessionCookie,
  createSession,
  readSessionCookie,
  resolveSession,
  revokeAllUserSessions,
  revokeSession,
  setSessionCookie,
  toPublicUser,
  type SessionContext,
} from './session';

/**
 * CMS authentication.
 *
 * Deliberately independent of Clerk: Clerk guards the webshop's customer
 * account/checkout routes, this guards `/admin`. They share no tables.
 *
 * Usable from server components and server actions. `getCurrentCmsUser()` is
 * wrapped in `React.cache` so a request that renders ten admin components still
 * does exactly one session lookup.
 */

// --- Rate limiting -----------------------------------------------------------

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_ATTEMPTS = 10;

export type AuthError =
  | 'invalid_credentials'
  | 'rate_limited'
  | 'inactive'
  | 'weak_password'
  | 'email_taken'
  | 'not_found'
  | 'forbidden';

export type AuthResult<T> = { ok: true; data: T } | { ok: false; error: AuthError; message: string };

const MESSAGES: Record<AuthError, string> = {
  invalid_credentials: 'E-mailadres of wachtwoord is onjuist.',
  rate_limited: 'Te veel mislukte pogingen. Probeer het over 15 minuten opnieuw.',
  inactive: 'Dit account is gedeactiveerd.',
  weak_password: 'Dit wachtwoord voldoet niet aan de eisen.',
  email_taken: 'Er bestaat al een gebruiker met dit e-mailadres.',
  not_found: 'Gebruiker niet gevonden.',
  forbidden: 'Je hebt geen toestemming voor deze actie.',
};

function fail(error: AuthError, message = MESSAGES[error]) {
  return { ok: false as const, error, message };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * A well-formed hash that nothing can match. Verifying against it when the
 * email is unknown makes a missing user cost the same scrypt work as a wrong
 * password, so response time does not reveal which accounts exist.
 */
const DUMMY_HASH = [
  'scrypt',
  2 ** 15,
  8,
  1,
  Buffer.from('cms-timing-equaliser').toString('base64'),
  Buffer.alloc(64).toString('base64'),
].join('$');

async function recentFailedAttempts(db: CmsDatabase, email: string, ip: string): Promise<number> {
  const since = new Date(Date.now() - LOGIN_WINDOW_MS);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(cmsLoginAttempts)
    .where(
      and(
        eq(cmsLoginAttempts.successful, false),
        gte(cmsLoginAttempts.attemptedAt, since),
        sql`(${cmsLoginAttempts.email} = ${email} OR ${cmsLoginAttempts.ipAddress} = ${ip})`,
      ),
    );
  return Number(rows[0]?.count ?? 0);
}

async function recordAttempt(
  db: CmsDatabase,
  email: string,
  ip: string,
  successful: boolean,
): Promise<void> {
  await db.insert(cmsLoginAttempts).values({ email, ipAddress: ip, successful });
  // Opportunistic pruning keeps the table from growing without a cron job.
  await db
    .delete(cmsLoginAttempts)
    .where(sql`${cmsLoginAttempts.attemptedAt} < now() - interval '1 day'`);
}

// --- Audit -------------------------------------------------------------------

export type AuditEntry = {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function recordAudit(
  db: CmsDatabase,
  actor: Pick<CmsUserPublic, 'id' | 'email'> | null,
  entry: AuditEntry,
): Promise<void> {
  await db.insert(cmsAuditLog).values({
    userId: actor?.id ?? null,
    userEmail: actor?.email ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    summary: entry.summary ?? null,
    metadata: entry.metadata ?? null,
  });
}

// --- Login / logout ----------------------------------------------------------

export type LoginInput = {
  email: string;
  password: string;
  context?: SessionContext;
};

/**
 * Verifies credentials, records the attempt, creates a session and writes the
 * `cms_session` cookie. Safe to call from a server action.
 *
 * Rate limited to {@link LOGIN_MAX_ATTEMPTS} failures per
 * {@link LOGIN_WINDOW_MS} per email *or* IP.
 */
export async function login(input: LoginInput): Promise<AuthResult<CmsUserPublic>> {
  const db = await getCmsDb();
  const result = await verifyCredentials(db, input.email, input.password, input.context);
  if (!result.ok) return result;

  const session = await createSession(db, result.data.id, input.context);
  await setSessionCookie(session.token, session.expiresAt);

  return result;
}

/**
 * Credential check without any cookie or request-scope dependency: rate limit,
 * constant-time password verify, attempt logging, `last_login_at`, audit entry.
 *
 * `login()` is this plus the session cookie. Scripts and tests use this
 * directly (see `scripts/cms-selftest.mts`).
 */
export async function verifyCredentials(
  db: CmsDatabase,
  rawEmail: string,
  password: string,
  context: SessionContext = {},
): Promise<AuthResult<CmsUserPublic>> {
  const email = normalizeEmail(rawEmail);
  const ip = context.ipAddress ?? 'unknown';

  if ((await recentFailedAttempts(db, email, ip)) >= LOGIN_MAX_ATTEMPTS) {
    return fail('rate_limited');
  }

  const [user] = await db.select().from(cmsUsers).where(eq(cmsUsers.email, email)).limit(1);

  // Always run a hash comparison so a missing user and a wrong password take
  // roughly the same amount of time.
  const stored = user?.passwordHash ?? DUMMY_HASH;
  const passwordOk = await verifyPassword(password, stored);

  if (!user || !passwordOk) {
    await recordAttempt(db, email, ip, false);
    return fail('invalid_credentials');
  }
  if (!user.isActive) {
    await recordAttempt(db, email, ip, false);
    return fail('inactive');
  }

  await recordAttempt(db, email, ip, true);
  await db.update(cmsUsers).set({ lastLoginAt: new Date() }).where(eq(cmsUsers.id, user.id));
  await recordAudit(db, user, { action: 'auth.login', entityType: 'cms_user', entityId: user.id });

  return { ok: true, data: toPublicUser(user) };
}

/** Revokes the current session and clears the cookie. Always succeeds. */
export async function logout(): Promise<void> {
  const token = await readSessionCookie();
  if (token) {
    const db = await getCmsDb();
    await revokeSession(db, token);
  }
  await clearSessionCookie();
}

// --- Current user ------------------------------------------------------------

/**
 * Resolves the signed-in CMS user for the current request, or null.
 * Memoised per request via `React.cache`.
 *
 * Sliding renewal writes a refreshed cookie when the session passes its
 * halfway point. Cookie writes are only legal in a server action or route
 * handler, so the attempt is wrapped in try/catch: in a plain server component
 * render the session stays valid, it just is not extended on that request.
 */
export const getCurrentCmsUser = cache(async (): Promise<CmsUserPublic | null> => {
  const token = await readSessionCookie();
  if (!token) return null;

  const db = await getCmsDb();
  const resolved = await resolveSession(db, token);
  if (!resolved) return null;

  if (resolved.renewed) {
    try {
      await setSessionCookie(token, resolved.expiresAt);
    } catch {
      // Read-only render context — the DB-side expiry was still extended.
    }
  }

  return resolved.user;
});

export class CmsAuthError extends Error {
  constructor(
    readonly code: 'unauthenticated' | 'forbidden',
    message: string,
  ) {
    super(message);
    this.name = 'CmsAuthError';
  }
}

/**
 * Returns the signed-in user, throwing when absent or under-privileged.
 *
 * ```ts
 * const user = await requireCmsUser();          // any signed-in CMS user
 * const admin = await requireCmsUser('admin');  // admins only
 * ```
 *
 * Worker B: catch `CmsAuthError` in the `/admin` layout and `redirect()` to
 * `/admin/login` for `unauthenticated`, or render a 403 for `forbidden`.
 */
export async function requireCmsUser(role?: CmsRole): Promise<CmsUserPublic> {
  const user = await getCurrentCmsUser();
  if (!user) throw new CmsAuthError('unauthenticated', 'Niet aangemeld.');
  if (role && !roleAtLeast(user.role, role)) {
    throw new CmsAuthError('forbidden', MESSAGES.forbidden);
  }
  return user;
}

/** Same as `requireCmsUser` but checks a fine-grained permission. */
export async function requirePermission(permission: CmsPermission): Promise<CmsUserPublic> {
  const user = await requireCmsUser();
  if (!can(user.role, permission)) {
    throw new CmsAuthError('forbidden', MESSAGES.forbidden);
  }
  return user;
}

// --- Password + user management ----------------------------------------------

export type ChangePasswordInput = {
  currentPassword: string;
  newPassword: string;
};

/**
 * Changes the signed-in user's password. Revokes every other session, then
 * issues a fresh one so the current browser stays signed in.
 */
export async function changePassword(input: ChangePasswordInput): Promise<AuthResult<true>> {
  const current = await requireCmsUser();
  const db = await getCmsDb();

  const [row] = await db.select().from(cmsUsers).where(eq(cmsUsers.id, current.id)).limit(1);
  if (!row) return fail('not_found');

  if (!(await verifyPassword(input.currentPassword, row.passwordHash))) {
    return fail('invalid_credentials', 'Het huidige wachtwoord is onjuist.');
  }

  const weak = validatePasswordStrength(input.newPassword);
  if (weak) return fail('weak_password', weak);

  await db
    .update(cmsUsers)
    .set({
      passwordHash: await hashPassword(input.newPassword),
      mustChangePassword: false,
      updatedAt: new Date(),
    })
    .where(eq(cmsUsers.id, row.id));

  // Invalidate everything, including this browser, then re-issue.
  await revokeAllUserSessions(db, row.id);
  const session = await createSession(db, row.id);
  await setSessionCookie(session.token, session.expiresAt);

  await recordAudit(db, current, {
    action: 'auth.password_change',
    entityType: 'cms_user',
    entityId: row.id,
  });

  return { ok: true, data: true };
}

export type CreateUserInput = {
  email: string;
  name: string;
  role: CmsRole;
  /** Omit to have a temporary password generated and returned once. */
  password?: string;
};

export type CreatedUser = { user: CmsUserPublic; temporaryPassword: string | null };

/**
 * Admin-only. New users always start with `mustChangePassword = true`; the
 * returned `temporaryPassword` is the only time the plaintext is available.
 */
export async function createUser(input: CreateUserInput): Promise<AuthResult<CreatedUser>> {
  const actor = await requireCmsUser('admin');
  const db = await getCmsDb();
  const email = normalizeEmail(input.email);

  const [existing] = await db
    .select({ id: cmsUsers.id })
    .from(cmsUsers)
    .where(eq(cmsUsers.email, email))
    .limit(1);
  if (existing) return fail('email_taken');

  const generated = input.password ? null : generateTemporaryPassword();
  const password = input.password ?? generated!;

  const weak = validatePasswordStrength(password);
  if (weak) return fail('weak_password', weak);

  const [row] = await db
    .insert(cmsUsers)
    .values({
      email,
      name: input.name.trim(),
      role: input.role,
      passwordHash: await hashPassword(password),
      mustChangePassword: true,
      isActive: true,
    })
    .returning();

  await recordAudit(db, actor, {
    action: 'user.create',
    entityType: 'cms_user',
    entityId: row.id,
    summary: `${email} (${input.role})`,
  });

  return { ok: true, data: { user: toPublicUser(row), temporaryPassword: generated } };
}

/** Admin-only. Resets another user's password to a fresh temporary one. */
export async function resetUserPassword(userId: string): Promise<AuthResult<string>> {
  const actor = await requireCmsUser('admin');
  const db = await getCmsDb();

  const [row] = await db.select({ id: cmsUsers.id }).from(cmsUsers).where(eq(cmsUsers.id, userId)).limit(1);
  if (!row) return fail('not_found');

  const temporary = generateTemporaryPassword();
  await db
    .update(cmsUsers)
    .set({
      passwordHash: await hashPassword(temporary),
      mustChangePassword: true,
      updatedAt: new Date(),
    })
    .where(eq(cmsUsers.id, userId));
  await revokeAllUserSessions(db, userId);

  await recordAudit(db, actor, {
    action: 'user.password_reset',
    entityType: 'cms_user',
    entityId: userId,
  });

  return { ok: true, data: temporary };
}

/**
 * Admin-only. Deactivating revokes every session for that user.
 * Admins cannot deactivate or demote themselves (prevents lock-out).
 */
export async function setUserActive(userId: string, isActive: boolean): Promise<AuthResult<true>> {
  const actor = await requireCmsUser('admin');
  if (actor.id === userId && !isActive) {
    return fail('forbidden', 'Je kan je eigen account niet deactiveren.');
  }

  const db = await getCmsDb();
  await db.update(cmsUsers).set({ isActive, updatedAt: new Date() }).where(eq(cmsUsers.id, userId));
  if (!isActive) await revokeAllUserSessions(db, userId);

  await recordAudit(db, actor, {
    action: isActive ? 'user.activate' : 'user.deactivate',
    entityType: 'cms_user',
    entityId: userId,
  });
  return { ok: true, data: true };
}

export async function setUserRole(userId: string, role: CmsRole): Promise<AuthResult<true>> {
  const actor = await requireCmsUser('admin');
  if (actor.id === userId && role !== 'admin') {
    return fail('forbidden', 'Je kan je eigen beheerdersrol niet afnemen.');
  }

  const db = await getCmsDb();
  await db.update(cmsUsers).set({ role, updatedAt: new Date() }).where(eq(cmsUsers.id, userId));
  await recordAudit(db, actor, {
    action: 'user.role_change',
    entityType: 'cms_user',
    entityId: userId,
    summary: role,
  });
  return { ok: true, data: true };
}

export async function listCmsUsers(): Promise<CmsUserPublic[]> {
  await requireCmsUser('admin');
  const db = await getCmsDb();
  const rows = await db.select().from(cmsUsers).orderBy(desc(cmsUsers.createdAt));
  return rows.map(toPublicUser);
}

export { can, roleAtLeast } from './permissions';
export type { CmsPermission } from './permissions';
