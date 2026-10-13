import 'server-only';
import { eq } from 'drizzle-orm';
import { getCmsDb } from '@/db/cms';
import { cmsUsers } from '@/db/cms-schema';
import { getCurrentCmsSession, recordAudit, requireCmsUser } from '../auth';
import { roleRequiresMfa } from '../guard';
import { generateTemporaryPassword, hashPassword } from '../password';
import {
  createSession,
  revokeAllUserSessions,
  revokeOtherUserSessions,
  setSessionCookie,
  type SessionContext,
} from '../session';
import { deleteUserMfaChallenges } from './challenge';
import { mfaConfigured, MfaConfigError } from './crypto';
import {
  beginEnrolment,
  fail,
  failedCode,
  holdAttempt,
  issueMfaSession,
  ok,
  releaseAttempt,
  type EnrolmentDisplay,
  type MfaResult,
} from './outcome';
import { clearMfaAttempts } from './rate-limit';
import { reauthenticate, type Reauthentication } from './reauth';
import {
  confirmEnrolment,
  getMfaStatus,
  hasConfirmedFactor,
  listEnrolledUserIds,
  removeAllFactors,
  replaceRecoveryCodes,
  type MfaStatus,
} from './repo';

/**
 * Signed-in MFA management and the admin break-glass path. The access rules
 * are described once, in `./flow.ts`; the re-authentication each change asks
 * for lives in `./reauth.ts`.
 */

export type { Reauthentication } from './reauth';

/** Status for the signed-in user's own account page. */
export async function getOwnMfaStatus(): Promise<MfaStatus & { required: boolean }> {
  const user = await requireCmsUser();
  const db = await getCmsDb();
  return { ...(await getMfaStatus(db, user.id)), required: roleRequiresMfa(user.role) };
}

async function requireSession() {
  const user = await requireCmsUser();
  const current = await getCurrentCmsSession();
  if (!current || current.user.id !== user.id) throw new Error('session vanished');
  return { user, sessionId: current.sessionId, absoluteExpiresAt: current.absoluteExpiresAt };
}

/** Replace the authenticator (new phone, new app), step 1: re-authenticate, then a new secret to scan. */
export async function startFactorReplacement(
  input: Reauthentication,
  context: SessionContext,
): Promise<MfaResult<EnrolmentDisplay>> {
  const { user, sessionId } = await requireSession();
  if (!mfaConfigured()) return fail('not_configured');
  const db = await getCmsDb();
  if (!(await hasConfirmedFactor(db, user.id))) return fail('not_allowed');
  const reauth = await reauthenticate(db, user, input, context);
  if (!reauth.ok) return reauth;
  return ok(await beginEnrolment(db, user, `session:${sessionId}`));
}

/**
 * Replace the authenticator, step 2: the first code of the new one. Signs out
 * every session (this browser gets a fresh one) and returns new recovery codes.
 */
export async function confirmFactorReplacement(
  code: string,
  context: SessionContext,
): Promise<MfaResult<{ recoveryCodes: string[] }>> {
  const { user, sessionId, absoluteExpiresAt } = await requireSession();
  const db = await getCmsDb();
  const hold = await holdAttempt(db, user.id, context);
  if (!hold.ok) return fail(hold.error);
  let result;
  try {
    result = await confirmEnrolment(db, user.id, `session:${sessionId}`, code);
  } catch (error) {
    if (error instanceof MfaConfigError) {
      await releaseAttempt(db, hold.held);
      return fail('not_configured');
    }
    throw error;
  }
  if (!result.ok) {
    if (result.reason === 'no_enrolment') {
      await releaseAttempt(db, hold.held);
      return fail('not_allowed', 'Start het vervangen opnieuw.');
    }
    return failedCode(db, user, 'replace', result.reason, hold.held);
  }
  await releaseAttempt(db, hold.held);
  await revokeAllUserSessions(db, user.id);
  await deleteUserMfaChallenges(db, user.id);
  // The replacement session keeps this one's absolute end and step-up time.
  await issueMfaSession(db, user.id, context, {
    absoluteExpiresAt,
    reauthenticatedAt: user.reauthenticatedAt,
  });
  await recordAudit(db, user, {
    action: 'auth.mfa_replace',
    entityType: 'cms_user',
    entityId: user.id,
  });
  return ok({ recoveryCodes: result.recoveryCodes });
}

/** New recovery codes (the old ones stop working). Signs out every other session. */
export async function regenerateRecoveryCodes(
  input: Reauthentication,
  context: SessionContext,
): Promise<MfaResult<{ recoveryCodes: string[] }>> {
  const { user, sessionId } = await requireSession();
  const db = await getCmsDb();
  if (!(await hasConfirmedFactor(db, user.id))) return fail('not_allowed');
  const reauth = await reauthenticate(db, user, input, context);
  if (!reauth.ok) return reauth;
  const recoveryCodes = await replaceRecoveryCodes(db, user.id);
  await revokeOtherUserSessions(db, user.id, sessionId);
  await recordAudit(db, user, {
    action: 'auth.mfa_recovery_regenerate',
    entityType: 'cms_user',
    entityId: user.id,
  });
  return ok({ recoveryCodes });
}

/**
 * Switch MFA off for yourself. Only for roles that do not require it (an
 * editor or provider who kept an authenticator from an admin period); an
 * admin cannot remove their own factor, only replace it. Signs out every
 * session; this browser gets a fresh, password-level one.
 */
export async function removeOwnFactor(
  input: Reauthentication,
  context: SessionContext,
): Promise<MfaResult<true>> {
  const { user, absoluteExpiresAt } = await requireSession();
  if (roleRequiresMfa(user.role)) return fail('not_allowed');
  const db = await getCmsDb();
  if (!(await hasConfirmedFactor(db, user.id))) return fail('not_allowed');
  const reauth = await reauthenticate(db, user, input, context);
  if (!reauth.ok) return reauth;
  await removeAllFactors(db, user.id);
  await deleteUserMfaChallenges(db, user.id);
  await revokeAllUserSessions(db, user.id);
  const session = await createSession(db, user.id, context, {
    replaces: { absoluteExpiresAt, reauthenticatedAt: user.reauthenticatedAt },
  });
  await setSessionCookie(session.token, session.cookieExpiresAt);
  await recordAudit(db, user, {
    action: 'auth.mfa_remove',
    entityType: 'cms_user',
    entityId: user.id,
  });
  return ok(true);
}

// ---------------------------------------------------------------------------
// Break-glass by another admin
// ---------------------------------------------------------------------------

/** Admin-only: which users have an authenticator, for the user list. */
export async function listMfaEnrolledUserIds(): Promise<Set<string>> {
  await requireCmsUser('admin');
  const db = await getCmsDb();
  return listEnrolledUserIds(db);
}

/**
 * Admin-only, for a colleague who lost both their authenticator and their
 * recovery codes. The acting admin re-authenticates (password + code). The
 * target's factors, recovery codes, challenges and sessions are deleted AND
 * their password is replaced by a temporary one, returned once: whoever
 * enrols next must hold that password, handed over out of band, not merely
 * the old one. Not for yourself (replace your own authenticator instead).
 */
export async function adminResetUserMfa(
  targetUserId: string,
  input: Reauthentication,
  context: SessionContext,
): Promise<MfaResult<{ temporaryPassword: string; email: string }>> {
  const actor = await requireCmsUser('admin');
  if (actor.id === targetUserId) {
    return fail('not_allowed', 'Vervang je eigen authenticator via Mijn account.');
  }
  const db = await getCmsDb();
  const [target] = await db
    .select({ id: cmsUsers.id, email: cmsUsers.email })
    .from(cmsUsers)
    .where(eq(cmsUsers.id, targetUserId))
    .limit(1);
  if (!target) return fail('not_found');

  const reauth = await reauthenticate(db, actor, input, context);
  if (!reauth.ok) return reauth;

  // Password and sessions first, factors last: a crash in between leaves the
  // target locked behind a password nobody knows yet, never factor-less with
  // the old password.
  const temporaryPassword = generateTemporaryPassword();
  await db
    .update(cmsUsers)
    .set({
      passwordHash: await hashPassword(temporaryPassword),
      mustChangePassword: true,
      updatedAt: new Date(),
    })
    .where(eq(cmsUsers.id, target.id));
  await revokeAllUserSessions(db, target.id);
  await deleteUserMfaChallenges(db, target.id);
  await removeAllFactors(db, target.id);
  await clearMfaAttempts(db, target.id);
  await recordAudit(db, actor, {
    action: 'user.mfa_reset',
    entityType: 'cms_user',
    entityId: target.id,
    summary: target.email,
  });
  return ok({ temporaryPassword, email: target.email });
}
