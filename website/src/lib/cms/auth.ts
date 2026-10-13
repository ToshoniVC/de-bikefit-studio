import { and, eq, gte, sql } from 'drizzle-orm';
import { cache } from 'react';
import { getCmsDb, type CmsDatabase } from '@/db/cms';
import {
  cmsAuditLog,
  cmsLoginAttempts,
  cmsUsers,
  type CmsRole,
  type CmsUserPublic,
} from '@/db/cms-schema';
import { assertCmsAccess, CMS_AUTH_MESSAGES, roleRequiresMfa } from './guard';
import {
  clearChallengeCookie,
  createMfaChallenge,
  deleteMfaChallenge,
  deleteUserMfaChallenges,
  readChallengeCookie,
  resolveMfaChallenge,
  setChallengeCookie,
} from './mfa/challenge';
import { clearMfaAttempts } from './mfa/rate-limit';
import { hasConfirmedFactor } from './mfa/repo';
import type { CmsPermission } from './permissions';
import {
  hashPassword,
  PASSWORD_HASH_PARAMS,
  validatePasswordStrength,
  verifyPassword,
} from './password';
import { upgradePasswordHashIfNeeded } from './password-upgrade';
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

export type AuthResult<T> =
  { ok: true; data: T } | { ok: false; error: AuthError; message: string };

const MESSAGES: Record<AuthError, string> = {
  invalid_credentials: 'E-mailadres of wachtwoord is onjuist.',
  rate_limited: 'Te veel mislukte pogingen. Probeer het over 15 minuten opnieuw.',
  inactive: 'Dit account is gedeactiveerd.',
  weak_password: 'Dit wachtwoord voldoet niet aan de eisen.',
  email_taken: 'Er bestaat al een gebruiker met dit e-mailadres.',
  not_found: 'Gebruiker niet gevonden.',
  forbidden: CMS_AUTH_MESSAGES.forbidden,
};

/** An `AuthResult` failure with the standard Dutch message (or `message`). */
export function authFail(error: AuthError, message = MESSAGES[error]) {
  return { ok: false as const, error, message };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * A well-formed hash that nothing can match, with the current parameters.
 * Verifying against it when the email is unknown makes a missing user cost the
 * same scrypt work as a wrong password, so response time does not reveal which
 * accounts exist.
 */
const DUMMY_HASH = [
  'scrypt',
  PASSWORD_HASH_PARAMS.N,
  PASSWORD_HASH_PARAMS.r,
  PASSWORD_HASH_PARAMS.p,
  Buffer.from('cms-timing-equaliser').toString('base64'),
  Buffer.alloc(PASSWORD_HASH_PARAMS.keyBytes).toString('base64'),
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

export type LoginOutcome = {
  user: CmsUserPublic;
  /**
   * `true`: no session was created. The password only bought a short-lived
   * MFA challenge (`cms_mfa` cookie); the browser continues at `/admin/mfa`.
   */
  secondStep: boolean;
};

/**
 * Whether a password sign-in must be followed by the second step: always for
 * roles that require MFA (admins), and for anyone else who has an
 * authenticator (e.g. a former admin), so a factor once set is always asked.
 */
export async function requiresSecondStep(
  db: CmsDatabase,
  user: Pick<CmsUserPublic, 'id' | 'role'>,
): Promise<boolean> {
  return roleRequiresMfa(user.role) || (await hasConfirmedFactor(db, user.id));
}

/**
 * Verifies credentials and records the attempt. Then either:
 *  - second step required (admins): creates an MFA challenge and writes the
 *    `cms_mfa` cookie. **No session is created.** Any session this browser
 *    still had is revoked, so a pre-MFA session cannot linger next to it;
 *  - otherwise (editors, providers, unchanged): creates a session and writes
 *    the `cms_session` cookie.
 * Safe to call from a server action.
 *
 * Rate limited to {@link LOGIN_MAX_ATTEMPTS} failures per
 * {@link LOGIN_WINDOW_MS} per email *or* IP.
 */
export async function login(input: LoginInput): Promise<AuthResult<LoginOutcome>> {
  const db = await getCmsDb();
  const result = await verifyCredentials(db, input.email, input.password, input.context);
  if (!result.ok) return result;

  if (await requiresSecondStep(db, result.data)) {
    const previous = await readSessionCookie();
    if (previous) {
      await revokeSession(db, previous);
      await clearSessionCookie();
    }
    const challenge = await createMfaChallenge(db, result.data.id, input.context);
    await setChallengeCookie(challenge.token, challenge.expiresAt);
    return { ok: true, data: { user: result.data, secondStep: true } };
  }

  // For a role without a second step, the password is the full authentication.
  const session = await createSession(db, result.data.id, input.context, {
    reauthenticated: true,
  });
  await setSessionCookie(session.token, session.cookieExpiresAt);

  return { ok: true, data: { user: result.data, secondStep: false } };
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
    return authFail('rate_limited');
  }

  const [user] = await db.select().from(cmsUsers).where(eq(cmsUsers.email, email)).limit(1);

  // Always run a hash comparison so a missing user and a wrong password take
  // roughly the same amount of time.
  const stored = user?.passwordHash ?? DUMMY_HASH;
  const passwordOk = await verifyPassword(password, stored);

  if (!user || !passwordOk) {
    await recordAttempt(db, email, ip, false);
    return authFail('invalid_credentials');
  }
  if (!user.isActive) {
    await recordAttempt(db, email, ip, false);
    return authFail('inactive');
  }

  await recordAttempt(db, email, ip, true);
  // A hash from older, weaker parameters is replaced now that the password is known.
  await upgradePasswordHashIfNeeded(db, user.id, password, user.passwordHash);
  await db.update(cmsUsers).set({ lastLoginAt: new Date() }).where(eq(cmsUsers.id, user.id));
  await recordAudit(db, user, { action: 'auth.login', entityType: 'cms_user', entityId: user.id });

  return { ok: true, data: toPublicUser(user) };
}

/**
 * Revokes the current session and any half-finished MFA challenge of this
 * browser, and clears both cookies. Always succeeds.
 */
export async function logout(): Promise<void> {
  const token = await readSessionCookie();
  const challengeToken = await readChallengeCookie();
  if (token || challengeToken) {
    const db = await getCmsDb();
    if (token) await revokeSession(db, token);
    const challenge = await resolveMfaChallenge(db, challengeToken);
    if (challenge) await deleteMfaChallenge(db, challenge.id);
  }
  await clearSessionCookie();
  if (challengeToken) await clearChallengeCookie();
}

// --- Current user ------------------------------------------------------------

/** The signed-in user plus what the guard needs to know about the session. */
export type CmsSessionUser = CmsUserPublic & {
  /** The session passed the second step (`cms_sessions.mfa_verified_at`). */
  mfaVerified: boolean;
  /** Last full authentication on the session (`cms_sessions.reauthenticated_at`). */
  reauthenticatedAt: Date | null;
};

/** The current session as `getCurrentCmsSession()` returns it. */
export type CurrentCmsSession = {
  user: CmsSessionUser;
  sessionId: string;
  /** Stored absolute end; a replacement session inherits it. */
  absoluteExpiresAt: Date | null;
};

/**
 * The current session: user, session id and MFA state, or null. Memoised per
 * request via `React.cache`. `getCurrentCmsUser()` is the same without the
 * session id; the MFA management in `./mfa/flow.ts` needs the id to bind an
 * authenticator replacement to the session that asked for it.
 */
export const getCurrentCmsSession = cache(async (): Promise<CurrentCmsSession | null> => {
  const token = await readSessionCookie();
  if (!token) return null;

  const db = await getCmsDb();
  const resolved = await resolveSession(db, token);
  if (!resolved) return null;

  if (resolved.renewed) {
    try {
      await setSessionCookie(token, resolved.cookieExpiresAt);
    } catch {
      // Read-only render context — the DB-side expiry was still extended.
    }
  }

  return {
    user: {
      ...resolved.user,
      mfaVerified: resolved.mfaVerified === true,
      reauthenticatedAt: resolved.reauthenticatedAt ?? null,
    },
    sessionId: resolved.sessionId,
    absoluteExpiresAt: resolved.absoluteExpiresAt ?? null,
  };
});

/**
 * Resolves the signed-in CMS user for the current request, or null.
 * Memoised per request via `React.cache`.
 *
 * Identity only: it does NOT apply the MFA or temporary-password rules.
 * Anything that returns CMS data or changes something goes through
 * `requireCmsUser()` / `requirePermission()` (or `cmsAccessDenial()` from
 * `./guard`, which reads the `mfaVerified` flag carried here).
 *
 * Lifetime rules (idle and absolute limits for admins, sliding renewal for
 * editors and providers) are applied by `resolveSession()`. A standard
 * session's renewal writes a refreshed cookie; cookie writes are only legal in
 * a server action or route handler, so the attempt is wrapped in try/catch: in
 * a plain server component render the database expiry still moves. Admin
 * cookies need no refresh: they expire at the absolute end.
 */
export const getCurrentCmsUser = cache(async (): Promise<CmsSessionUser | null> => {
  return (await getCurrentCmsSession())?.user ?? null;
});

export { CmsAuthError, type CmsAuthErrorCode } from './guard';

export type RequireCmsUserOptions = {
  /**
   * Accept a user whose password is still temporary (`mustChangePassword`).
   * Only the forced password change uses this: `changePassword()` below and
   * the `/admin/password` page. Everything else leaves it off.
   */
  allowMustChangePassword?: boolean;
  /**
   * A sensitive change: refuse with `reauth_required` unless this session had
   * a full authentication in the last five minutes (sign-in or step-up).
   */
  recentReauthentication?: boolean;
};

/**
 * Returns the signed-in user, or throws `CmsAuthError`: `unauthenticated`
 * without a session, `mfa_required` for an admin session that did not pass
 * the second step, `password_change_required` while the password is still
 * temporary, `forbidden` when the role ranks too low, `reauth_required` for a
 * sensitive change without a recent step-up. The decision is
 * `assertCmsAccess()` in `./guard`.
 *
 * ```ts
 * const user = await requireCmsUser();          // any signed-in CMS user
 * const admin = await requireCmsUser('admin');  // admins only
 * ```
 *
 * The `/admin` layout redirects `password_change_required` to
 * `/admin/password` and the other codes to `/admin/login`; `runAction()`
 * turns every code into a short Dutch form message.
 */
export async function requireCmsUser(
  role?: CmsRole,
  options: RequireCmsUserOptions = {},
): Promise<CmsSessionUser> {
  return assertCmsAccess(await getCurrentCmsUser(), {
    role,
    allowMustChangePassword: options.allowMustChangePassword,
    recentReauthentication: options.recentReauthentication,
  });
}

/** What `requirePermission()` accepts: the step-up requirement, nothing else. */
export type RequirePermissionOptions = Pick<RequireCmsUserOptions, 'recentReauthentication'>;

/**
 * Same as `requireCmsUser()` but checks a fine-grained permission. There is no
 * temporary-password opt-in here: no permission-gated path is part of the
 * forced password change. A sensitive change adds the step-up, e.g. the
 * e-mail service credential and addresses (`src/lib/email/repo.ts`):
 *
 * ```ts
 * await requirePermission('email.manage', { recentReauthentication: true });
 * ```
 */
export async function requirePermission(
  permission: CmsPermission,
  options: RequirePermissionOptions = {},
): Promise<CmsSessionUser> {
  return assertCmsAccess(await getCurrentCmsUser(), {
    permission,
    recentReauthentication: options.recentReauthentication,
  });
}

// --- Password + user management ----------------------------------------------

export type ChangePasswordInput = {
  currentPassword: string;
  newPassword: string;
};

/**
 * Changes the signed-in user's password. Revokes every other session, then
 * issues a fresh one so the current browser stays signed in. The fresh
 * session carries over the MFA state, the absolute end and the step-up time
 * of the one it replaces, never more.
 *
 * The one write a temporary-password session may make: it is how such a user
 * gets out of that state, hence `allowMustChangePassword`. For roles with a
 * second step (admins) it is a sensitive change: besides the current password
 * it needs a recent full authentication (sign-in or step-up, password plus
 * code), so a hijacked session plus a phished password is not enough.
 */
export async function changePassword(input: ChangePasswordInput): Promise<AuthResult<true>> {
  const signedIn = await getCurrentCmsSession();
  const current = await requireCmsUser(undefined, {
    allowMustChangePassword: true,
    recentReauthentication: signedIn ? roleRequiresMfa(signedIn.user.role) : false,
  });
  const db = await getCmsDb();

  const [row] = await db.select().from(cmsUsers).where(eq(cmsUsers.id, current.id)).limit(1);
  if (!row) return authFail('not_found');

  if (!(await verifyPassword(input.currentPassword, row.passwordHash))) {
    return authFail('invalid_credentials', 'Het huidige wachtwoord is onjuist.');
  }

  const weak = validatePasswordStrength(input.newPassword);
  if (weak) return authFail('weak_password', weak);

  await db
    .update(cmsUsers)
    .set({
      passwordHash: await hashPassword(input.newPassword),
      mustChangePassword: false,
      updatedAt: new Date(),
    })
    .where(eq(cmsUsers.id, row.id));

  // Invalidate everything, including this browser, then re-issue. A new password also ends a
  // lock-out someone caused by guessing codes, and any sign-in challenge of the old password.
  await revokeAllUserSessions(db, row.id);
  await clearMfaAttempts(db, row.id);
  await deleteUserMfaChallenges(db, row.id);
  const session = await createSession(
    db,
    row.id,
    {},
    {
      mfaVerified: current.mfaVerified,
      replaces: {
        absoluteExpiresAt: signedIn?.absoluteExpiresAt ?? null,
        reauthenticatedAt: current.reauthenticatedAt,
      },
    },
  );
  await setSessionCookie(session.token, session.cookieExpiresAt);

  await recordAudit(db, current, {
    action: 'auth.password_change',
    entityType: 'cms_user',
    entityId: row.id,
  });

  return { ok: true, data: true };
}

export { can, roleAtLeast } from './permissions';
export type { CmsPermission } from './permissions';
