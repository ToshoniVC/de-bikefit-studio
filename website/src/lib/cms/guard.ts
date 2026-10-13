import type { CmsRole, CmsUserPublic } from '@/db/cms-schema';
import { can, roleAtLeast, type CmsPermission } from './permissions';

/**
 * The decision half of the CMS auth guard, kept pure (no database, cookies or
 * Next runtime) so the whole matrix is unit-tested in `guard.test.ts`.
 * `requireCmsUser()` / `requirePermission()` in `./auth` only add the session
 * lookup; call sites that must not throw (`canPreview()`, the analytics
 * panel) use {@link cmsAccessDenial} directly.
 *
 * Checks run in this order, the first failure wins:
 *  1. no signed-in user                → `unauthenticated`;
 *  2. an admin whose session did not pass the second step (TOTP or recovery
 *     code)                            → `mfa_required`. No opt-out exists:
 *     password sign-in of an admin creates no session at all, only a
 *     challenge (`src/lib/cms/mfa/challenge.ts`), so this catches sessions
 *     from before MFA existed and an editor or provider who was promoted;
 *  3. password still temporary         → `password_change_required`, unless
 *     the call site opts in with `allowMustChangePassword`. Only the forced
 *     password change does: `changePassword()` and the `/admin/password` page;
 *  4. role rank or permission missing  → `forbidden`;
 *  5. a sensitive change (`recentReauthentication`) by a user whose session
 *     has no full authentication in the last 5 minutes → `reauth_required`.
 *     Sign-in sets it; after that only the step-up ("Bevestig je
 *     identiteit": password plus code for admins) renews it. A session that
 *     replaces another inherits its time, never a fresh one.
 *
 * Steps 2, 3 and 5 make MFA, `must_change_password` and step-up server-side rules. A
 * layout redirect alone does not stop a session from posting a server action
 * directly. Login, logout and the MFA challenge steps never pass through this
 * guard, so such a user can still sign in, finish the second step, change the
 * password or sign out.
 */

export type CmsAuthErrorCode =
  'unauthenticated' | 'mfa_required' | 'password_change_required' | 'forbidden' | 'reauth_required';

/** Short Dutch messages, safe to show to the signed-in user. */
export const CMS_AUTH_MESSAGES: Record<CmsAuthErrorCode, string> = {
  unauthenticated: 'Niet aangemeld.',
  mfa_required: 'Bevestig je aanmelding eerst met tweestapsverificatie.',
  password_change_required: 'Kies eerst een nieuw wachtwoord.',
  forbidden: 'Je hebt geen toestemming voor deze actie.',
  reauth_required: 'Bevestig eerst je identiteit met je wachtwoord en je code.',
};

export class CmsAuthError extends Error {
  constructor(
    readonly code: CmsAuthErrorCode,
    message: string = CMS_AUTH_MESSAGES[code],
  ) {
    super(message);
    this.name = 'CmsAuthError';
  }
}

export type CmsAccessRequirement = {
  /** Minimum role rank, as in `requireCmsUser('admin')`. */
  role?: CmsRole;
  /** Fine-grained permission, as in `requirePermission('page.publish')`. */
  permission?: CmsPermission;
  /**
   * Let a user whose password is still temporary through. Reserved for the
   * forced password change itself; it never grants a role or a permission.
   */
  allowMustChangePassword?: boolean;
  /**
   * A sensitive change: password, second factor, user accounts and roles.
   * Requires a full authentication on this session within the last
   * {@link REAUTH_WINDOW_MS}, checked after the role.
   */
  recentReauthentication?: boolean;
};

/**
 * What the decision needs. `mfaVerified` comes from the session
 * (`getCurrentCmsUser()` sets it); anything but `true` counts as not verified.
 */
export type CmsGuardSubject = Pick<CmsUserPublic, 'role' | 'mustChangePassword'> & {
  mfaVerified?: boolean;
  /** Last full authentication on the session; anything missing counts as never. */
  reauthenticatedAt?: Date | null;
};

/**
 * Whether sessions of this role must have passed the second step. Admins do;
 * editors and providers are unchanged for now. Fails closed: any role that
 * is not explicitly exempt requires it.
 */
export function roleRequiresMfa(role: CmsRole | string): boolean {
  return role !== 'editor' && role !== 'provider';
}

/** How long a full (re-)authentication unlocks sensitive changes. */
export const REAUTH_WINDOW_MS = 5 * 60 * 1000;
/** Tolerated clock difference between server instances for a fresh stamp. */
const CLOCK_SKEW_MS = 30 * 1000;

/** Whether `reauthenticatedAt` still unlocks sensitive changes at `now`. */
export function reauthenticationIsRecent(
  reauthenticatedAt: Date | null | undefined,
  now: Date,
): boolean {
  if (!(reauthenticatedAt instanceof Date)) return false;
  const age = now.getTime() - reauthenticatedAt.getTime();
  if (!Number.isFinite(age)) return false;
  // A stamp further in the future than clock skew explains is not trusted.
  return age >= -CLOCK_SKEW_MS && age <= REAUTH_WINDOW_MS;
}

/** Why `user` may not go ahead under `requirement`, or `null` when it may. */
export function cmsAccessDenial(
  user: CmsGuardSubject | null | undefined,
  requirement: CmsAccessRequirement = {},
  now: Date = new Date(),
): CmsAuthErrorCode | null {
  if (!user) return 'unauthenticated';
  if (roleRequiresMfa(user.role) && user.mfaVerified !== true) return 'mfa_required';
  // Fail closed: anything but an explicit `false` counts as temporary.
  if (user.mustChangePassword !== false && requirement.allowMustChangePassword !== true) {
    return 'password_change_required';
  }
  if (requirement.role && !roleAtLeast(user.role, requirement.role)) return 'forbidden';
  if (requirement.permission && !can(user.role, requirement.permission)) return 'forbidden';
  if (
    requirement.recentReauthentication === true &&
    !reauthenticationIsRecent(user.reauthenticatedAt, now)
  ) {
    return 'reauth_required';
  }
  return null;
}

/** Returns `user` when {@link cmsAccessDenial} finds nothing, else throws `CmsAuthError`. */
export function assertCmsAccess<T extends CmsGuardSubject>(
  user: T | null | undefined,
  requirement: CmsAccessRequirement = {},
  now: Date = new Date(),
): T {
  const denial = cmsAccessDenial(user, requirement, now);
  if (denial !== null || !user) throw new CmsAuthError(denial ?? 'unauthenticated');
  return user;
}
