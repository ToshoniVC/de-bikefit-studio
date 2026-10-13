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
import { fail, ipOf, ok, type MfaResult } from './outcome';
import { hasConfirmedFactor, mfaRateLimited, recordMfaAttempt, verifySecondFactor } from './repo';

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
 * Both are rate limited together with the sign-in codes (`./repo.ts`) and
 * audited; a successful one upgrades a legacy password hash.
 */

export type Reauthentication = { password: string; code: string };

/**
 * The current password AND (when `requireCode`) a current code or recovery
 * code, checked in that order so a wrong password never burns a recovery
 * code. One generic message for either mistake.
 */
export async function reauthenticate(
  db: CmsDatabase,
  user: Pick<CmsUserPublic, 'id' | 'email'>,
  input: Reauthentication,
  context: SessionContext,
  requireCode = true,
): Promise<MfaResult<true>> {
  if (await mfaRateLimited(db, user.id, ipOf(context))) return fail('rate_limited');
  const [row] = await db
    .select({ passwordHash: cmsUsers.passwordHash })
    .from(cmsUsers)
    .where(eq(cmsUsers.id, user.id))
    .limit(1);
  if (!row) return fail('not_found');

  const passwordOk = await verifyPassword(input.password, row.passwordHash);
  let code: Awaited<ReturnType<typeof verifySecondFactor>> | null = null;
  try {
    code =
      passwordOk && requireCode
        ? await verifySecondFactor(db, user.id, input.code)
        : passwordOk
          ? { ok: true as const, method: 'totp' as const }
          : null;
  } catch (error) {
    if (error instanceof MfaConfigError) return fail('not_configured');
    throw error;
  }
  if (!code?.ok) {
    await recordMfaAttempt(db, user.id, ipOf(context), false);
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
  await recordMfaAttempt(db, user.id, ipOf(context), true);
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
