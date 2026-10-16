import 'server-only';
import { eq } from 'drizzle-orm';
import { cache } from 'react';
import { getCmsDb, type CmsDatabase } from '@/db/cms';
import { cmsUsers, type CmsUserPublic } from '@/db/cms-schema';
import { recordAudit } from '../auth';
import { hashPassword, validatePasswordStrength, verifyPassword } from '../password';
import { revokeAllUserSessions, type SessionContext } from '../session';
import {
  clearChallengeCookie,
  consumeMfaChallenge,
  readChallengeCookie,
  releaseChallengeAttempt,
  reserveChallengeAttempt,
  resolveMfaChallenge,
  settleChallengeFailure,
  type ResolvedChallenge,
} from './challenge';
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
import { clearMfaAttempts, releaseMfaAttempt } from './rate-limit';
import { confirmEnrolment, hasConfirmedFactor, verifySecondFactor } from './repo';

/**
 * Request-scope MFA flows: what `/admin/mfa`, `/admin/account` and
 * `/admin/users` call through the server actions in
 * `src/lib/cms/actions/mfa.ts`. Access rules, in one place:
 *
 * - **Challenge steps** (after a correct password, before any session): need
 *   the live `cms_mfa` challenge (`./challenge.ts`) and act only on that
 *   challenge's own user. In order: change a temporary password (only while
 *   no authenticator exists yet), enrol (only without an authenticator),
 *   verify (only with one). Success consumes the challenge and creates the
 *   first and only session, with `mfaVerified`.
 * - **Signed-in management** needs a full session (`requireCmsUser()`, so an
 *   admin's or provider's session must itself have passed MFA) plus re-authentication in
 *   the same request: the current password AND a current code or a recovery
 *   code. Replacing the authenticator and new recovery codes work this way.
 * - **Break-glass**: another admin, re-authenticated the same way, resets a
 *   user's MFA ({@link adminResetUserMfa}); with no admin left, an operator
 *   with database access runs `npm run cms:mfa-reset`.
 *
 * Every factor change revokes the user's sessions. Every code check is
 * RESERVED against the per-user/IP, IP and daily limits (`./rate-limit.ts`)
 * and, inside a challenge, against the challenge's own slots
 * (`./challenge.ts`) before the code is looked at, so parallel requests can
 * never check more codes than the limits allow; a success or a result that
 * says nothing about the code gives the reservation back, and every failure
 * is audited. No secret, code or token is logged; the enrolment secret leaves
 * the server once, in the action response.
 */

// ---------------------------------------------------------------------------
// Challenge steps (after the password, before any session)
// ---------------------------------------------------------------------------

export type ChallengeStep = 'password' | 'enrol' | 'verify';

export type ChallengeView = {
  user: CmsUserPublic;
  enrolled: boolean;
  step: ChallengeStep;
  expiresAt: Date;
};

/**
 * Which step comes next. With an authenticator: verify first (a temporary
 * password is then changed on `/admin/password`, inside a full session).
 * Without one: a temporary password is replaced first, then the enrolment.
 */
export function challengeStep(user: Pick<CmsUserPublic, 'mustChangePassword'>, enrolled: boolean) {
  if (enrolled) return 'verify' as const;
  return user.mustChangePassword === false ? ('enrol' as const) : ('password' as const);
}

async function currentChallenge(
  db: CmsDatabase,
): Promise<{ challenge: ResolvedChallenge; enrolled: boolean } | null> {
  const challenge = await resolveMfaChallenge(db, await readChallengeCookie());
  if (!challenge) return null;
  return { challenge, enrolled: await hasConfirmedFactor(db, challenge.user.id) };
}

/** The live challenge of this browser, for rendering `/admin/mfa`. Memoised per request. */
export const getCurrentMfaChallenge = cache(async (): Promise<ChallengeView | null> => {
  const db = await getCmsDb();
  const current = await currentChallenge(db);
  if (!current) return null;
  const { challenge, enrolled } = current;
  return {
    user: challenge.user,
    enrolled,
    step: challengeStep(challenge.user, enrolled),
    expiresAt: challenge.expiresAt,
  };
});

/** Step 1 for a new admin or provider: replace the temporary password. Revokes any session the user still had. */
export async function challengeChangePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<MfaResult<true>> {
  const db = await getCmsDb();
  const current = await currentChallenge(db);
  if (!current) return fail('expired');
  const { challenge, enrolled } = current;
  if (challengeStep(challenge.user, enrolled) !== 'password') return fail('not_allowed');

  const [row] = await db
    .select({ passwordHash: cmsUsers.passwordHash })
    .from(cmsUsers)
    .where(eq(cmsUsers.id, challenge.user.id))
    .limit(1);
  if (!row) return fail('expired');
  // A wrong password uses up a challenge slot, reserved before the check so
  // parallel guesses cannot take more than the challenge allows.
  const slot = await reserveChallengeAttempt(db, challenge.id);
  if (slot === null) return fail('expired');
  let passwordOk: boolean;
  try {
    passwordOk = await verifyPassword(input.currentPassword, row.passwordHash);
  } catch (error) {
    // A busy or failing hasher says nothing about the password: not counted.
    await releaseChallengeAttempt(db, challenge.id);
    throw error;
  }
  if (!passwordOk) {
    return (await settleChallengeFailure(db, challenge.id, slot))
      ? fail('invalid_password')
      : fail('expired');
  }
  await releaseChallengeAttempt(db, challenge.id);
  const weak = validatePasswordStrength(input.newPassword);
  if (weak) return fail('weak_password', weak);

  await db
    .update(cmsUsers)
    .set({
      passwordHash: await hashPassword(input.newPassword),
      mustChangePassword: false,
      updatedAt: new Date(),
    })
    .where(eq(cmsUsers.id, challenge.user.id));
  await revokeAllUserSessions(db, challenge.user.id);
  await clearMfaAttempts(db, challenge.user.id);
  await recordAudit(db, challenge.user, {
    action: 'auth.password_change',
    entityType: 'cms_user',
    entityId: challenge.user.id,
    metadata: { during: 'mfa_challenge' },
  });
  return ok(true);
}

/** Step 2: a fresh secret for the user to scan. Only without an authenticator, after the password step. */
export async function challengeStartEnrolment(): Promise<MfaResult<EnrolmentDisplay>> {
  const db = await getCmsDb();
  const current = await currentChallenge(db);
  if (!current) return fail('expired');
  const { challenge, enrolled } = current;
  if (challengeStep(challenge.user, enrolled) !== 'enrol') return fail('not_allowed');
  if (!mfaConfigured()) {
    console.error('[cms-mfa] CMS_MFA_ENCRYPTION_KEY missing or malformed; enrolment refused');
    return fail('not_configured');
  }
  return ok(await beginEnrolment(db, challenge.user, `challenge:${challenge.id}`));
}

/**
 * Step 2b: the first code confirms the authenticator. Creates the session and
 * returns the recovery codes, the only time they exist in plain text.
 */
export async function challengeConfirmEnrolment(
  code: string,
  context: SessionContext,
): Promise<MfaResult<{ recoveryCodes: string[] }>> {
  const db = await getCmsDb();
  const current = await currentChallenge(db);
  if (!current) return fail('expired');
  const { challenge, enrolled } = current;
  const user = challenge.user;
  if (challengeStep(user, enrolled) !== 'enrol') return fail('not_allowed');
  const hold = await holdAttempt(db, user.id, context, challenge.id);
  if (!hold.ok) return fail(hold.error);

  let result;
  try {
    result = await confirmEnrolment(db, user.id, `challenge:${challenge.id}`, code);
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
      return fail('not_allowed', 'Start het instellen opnieuw.');
    }
    return failedCode(db, user, 'enrol', result.reason, hold.held);
  }

  // A success does not count; the challenge itself is used up below.
  await releaseMfaAttempt(db, hold.held.reservation);
  if (!(await consumeMfaChallenge(db, challenge.id))) return fail('expired');
  await revokeAllUserSessions(db, user.id);
  await issueMfaSession(db, user.id, context);
  await recordAudit(db, user, {
    action: 'auth.mfa_enrol',
    entityType: 'cms_user',
    entityId: user.id,
  });
  return ok({ recoveryCodes: result.recoveryCodes });
}

/** Step 3 (users with an authenticator): a TOTP code or a recovery code creates the session. */
export async function challengeVerify(
  code: string,
  context: SessionContext,
): Promise<MfaResult<{ method: 'totp' | 'recovery'; recoveryCodesLeft: number | null }>> {
  const db = await getCmsDb();
  const current = await currentChallenge(db);
  if (!current) return fail('expired');
  const { challenge, enrolled } = current;
  const user = challenge.user;
  if (challengeStep(user, enrolled) !== 'verify') return fail('not_allowed');
  const hold = await holdAttempt(db, user.id, context, challenge.id);
  if (!hold.ok) return fail(hold.error);

  let result;
  try {
    result = await verifySecondFactor(db, user.id, code);
  } catch (error) {
    if (error instanceof MfaConfigError) {
      await releaseAttempt(db, hold.held);
      return fail('not_configured');
    }
    throw error;
  }
  if (!result.ok) return failedCode(db, user, 'sign_in', result.reason, hold.held);

  // A success does not count; the challenge itself is used up below.
  await releaseMfaAttempt(db, hold.held.reservation);
  if (!(await consumeMfaChallenge(db, challenge.id))) return fail('expired');
  await issueMfaSession(db, user.id, context);
  await recordAudit(db, user, {
    action: 'auth.mfa_verify',
    entityType: 'cms_user',
    entityId: user.id,
    metadata: { method: result.method, recoveryCodesLeft: result.recoveryCodesLeft ?? null },
  });
  return ok({ method: result.method, recoveryCodesLeft: result.recoveryCodesLeft ?? null });
}

/** "Cancel": forget this browser's challenge. */
export async function abandonMfaChallenge(): Promise<void> {
  const db = await getCmsDb();
  const challenge = await resolveMfaChallenge(db, await readChallengeCookie());
  if (challenge) await consumeMfaChallenge(db, challenge.id);
  await clearChallengeCookie();
}
