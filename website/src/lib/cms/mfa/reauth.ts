import 'server-only';
import { eq } from 'drizzle-orm';
import { getCmsDb, type CmsDatabase } from '@/db/cms';
import { cmsUsers, type CmsUserPublic } from '@/db/cms-schema';
import { getCurrentCmsSession, recordAudit, requireCmsUser } from '../auth';
import { REAUTH_WINDOW_MS, reauthenticationIsRecent, roleRequiresMfa } from '../guard';
import { verifyPassword } from '../password';
import { upgradePasswordHashIfNeeded } from '../password-upgrade';
import { markSessionReauthenticated, type SessionContext } from '../session';
import { MfaConfigError } from './crypto';
import { fail, holdAttempt, ok, releaseAttempt, type MfaResult } from './outcome';
import { hasConfirmedFactor, verifySecondFactor } from './repo';

/**
 * Re-authentication for sensitive changes, in two shapes:
 *
 * - **inline** ({@link reauthenticate}): password and code in the same request
 *   as the change. Replacing the authenticator, new recovery codes, removing
 *   a factor and the break-glass reset use it (`./manage.ts`).
 * - **step-up** ({@link confirmIdentity}, "Bevestig je identiteit"): the same
 *   check, recorded on the session as `reauthenticated_at`. For the next
 *   {@link REAUTH_WINDOW_MS} the guard lets this session make the changes
 *   marked `recentReauthentication`: user accounts and roles, an admin's own
 *   password, and the e-mail service key and addresses (`/admin/email`).
 *   Signing in with password and code counts as well.
 *
 * Both count against the same limits as the sign-in codes (`./rate-limit.ts`)
 * and are audited; a successful one upgrades a legacy password hash.
 */

export type Reauthentication = { password: string; code: string };

/**
 * The current password AND (when `requireCode`) a current code or recovery
 * code, checked in that order so a wrong password never burns a recovery
 * code. One generic message for either mistake.
 *
 * The attempt is reserved against the limits BEFORE the password is checked,
 * so parallel requests cannot check more than the limits allow. A wrong
 * password or code keeps the reservation; a success, an unreadable factor
 * (as at sign-in) and a check that never ran (missing key, busy hasher) give
 * it back.
 */
export async function reauthenticate(
  db: CmsDatabase,
  user: Pick<CmsUserPublic, 'id' | 'email'>,
  input: Reauthentication,
  context: SessionContext,
  requireCode = true,
): Promise<MfaResult<true>> {
  const hold = await holdAttempt(db, user.id, context);
  if (!hold.ok) return fail(hold.error);
  const [row] = await db
    .select({ passwordHash: cmsUsers.passwordHash })
    .from(cmsUsers)
    .where(eq(cmsUsers.id, user.id))
    .limit(1);
  if (!row) {
    await releaseAttempt(db, hold.held);
    return fail('not_found');
  }

  let passwordOk: boolean;
  try {
    passwordOk = await verifyPassword(input.password, row.passwordHash);
  } catch (error) {
    // A busy or failing hasher says nothing about the password: not counted.
    await releaseAttempt(db, hold.held);
    throw error;
  }
  let code: Awaited<ReturnType<typeof verifySecondFactor>> | null = null;
  try {
    code =
      passwordOk && requireCode
        ? await verifySecondFactor(db, user.id, input.code)
        : passwordOk
          ? { ok: true as const, method: 'totp' as const }
          : null;
  } catch (error) {
    if (error instanceof MfaConfigError) {
      await releaseAttempt(db, hold.held);
      return fail('not_configured');
    }
    throw error;
  }
  if (!code?.ok) {
    if (code?.ok === false && code.reason === 'unreadable') await releaseAttempt(db, hold.held);
    await recordAudit(db, user, {
      action: 'auth.mfa_reauth_failed',
      entityType: 'cms_user',
      entityId: user.id,
      metadata: {
        reason: passwordOk ? (code?.ok === false ? code.reason : 'invalid') : 'password',
      },
    });
    return fail('reauth_failed');
  }
  await releaseAttempt(db, hold.held);
  await upgradePasswordHashIfNeeded(db, user.id, input.password, row.passwordHash);
  return ok(true);
}

/** Whether this user's step-up asks for a code: admins, and anyone with an authenticator. */
async function stepUpNeedsCode(db: CmsDatabase, user: Pick<CmsUserPublic, 'id' | 'role'>) {
  return roleRequiresMfa(user.role) || (await hasConfirmedFactor(db, user.id));
}

/**
 * "Bevestig je identiteit": re-authenticate and open the step-up window on
 * the current session. Allowed with a temporary password, because the forced
 * password change of an admin may need it.
 */
export async function confirmIdentity(
  input: Reauthentication,
  context: SessionContext,
): Promise<MfaResult<{ until: Date }>> {
  const user = await requireCmsUser(undefined, { allowMustChangePassword: true });
  const current = await getCurrentCmsSession();
  if (!current || current.user.id !== user.id) return fail('expired');

  const db = await getCmsDb();
  const reauth = await reauthenticate(db, user, input, context, await stepUpNeedsCode(db, user));
  if (!reauth.ok) return reauth;

  const at = new Date();
  await markSessionReauthenticated(db, current.sessionId, at);
  await recordAudit(db, user, {
    action: 'auth.step_up',
    entityType: 'cms_user',
    entityId: user.id,
  });
  return ok({ until: new Date(at.getTime() + REAUTH_WINDOW_MS) });
}

export type StepUpStatus = {
  /** The step-up form asks for a code as well as the password. */
  needsCode: boolean;
  /** Until when sensitive changes are unlocked, or null when a step-up is needed. */
  until: Date | null;
};

/** For pages that render sensitive forms: show the step-up form or the open window. */
export async function getStepUpStatus(): Promise<StepUpStatus> {
  const user = await requireCmsUser(undefined, { allowMustChangePassword: true });
  const db = await getCmsDb();
  const recent = reauthenticationIsRecent(user.reauthenticatedAt, new Date());
  return {
    needsCode: await stepUpNeedsCode(db, user),
    until:
      recent && user.reauthenticatedAt
        ? new Date(user.reauthenticatedAt.getTime() + REAUTH_WINDOW_MS)
        : null,
  };
}
