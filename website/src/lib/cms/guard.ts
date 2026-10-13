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
 *  2. password still temporary         → `password_change_required`, unless
 *     the call site opts in with `allowMustChangePassword`. Only the forced
 *     password change does: `changePassword()` and the `/admin/password` page;
 *  3. role rank or permission missing  → `forbidden`.
 *
 * Step 2 makes `must_change_password` a server-side rule. The dashboard
 * layout's redirect alone did not stop a temporary-password session from
 * posting a server action directly. Login and logout never pass through this
 * guard, so such a user can still sign in, change the password or sign out.
 */

export type CmsAuthErrorCode = 'unauthenticated' | 'password_change_required' | 'forbidden';

/** Short Dutch messages, safe to show to the signed-in user. */
export const CMS_AUTH_MESSAGES: Record<CmsAuthErrorCode, string> = {
  unauthenticated: 'Niet aangemeld.',
  password_change_required: 'Kies eerst een nieuw wachtwoord.',
  forbidden: 'Je hebt geen toestemming voor deze actie.',
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
};

/** The two fields the decision needs; a `CmsUserPublic` satisfies it. */
export type CmsGuardSubject = Pick<CmsUserPublic, 'role' | 'mustChangePassword'>;

/** Why `user` may not go ahead under `requirement`, or `null` when it may. */
export function cmsAccessDenial(
  user: CmsGuardSubject | null | undefined,
  requirement: CmsAccessRequirement = {},
): CmsAuthErrorCode | null {
  if (!user) return 'unauthenticated';
  // Fail closed: anything but an explicit `false` counts as temporary.
  if (user.mustChangePassword !== false && requirement.allowMustChangePassword !== true) {
    return 'password_change_required';
  }
  if (requirement.role && !roleAtLeast(user.role, requirement.role)) return 'forbidden';
  if (requirement.permission && !can(user.role, requirement.permission)) return 'forbidden';
  return null;
}

/** Returns `user` when {@link cmsAccessDenial} finds nothing, else throws `CmsAuthError`. */
export function assertCmsAccess<T extends CmsGuardSubject>(
  user: T | null | undefined,
  requirement: CmsAccessRequirement = {},
): T {
  const denial = cmsAccessDenial(user, requirement);
  if (denial !== null || !user) throw new CmsAuthError(denial ?? 'unauthenticated');
  return user;
}
