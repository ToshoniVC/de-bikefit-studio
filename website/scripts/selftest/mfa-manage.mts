/**
 * Self-test section 5c, parts G–L (recovery codes, key change, signed-in
 * management, a new admin and break-glass, editors, the CLI core). Entry point
 * and part list: `./mfa.mts`.
 */
import { randomBytes } from 'node:crypto';
import { CTX, type MfaKit } from './mfa-kit.mjs';

const SECOND_ADMIN = 'tweede-beheerder@selftest.local';
const SECOND_ADMIN_PASSWORD = 'Tweede-Beheerder-2026';
const EDITOR = 'redacteur-mfa@selftest.local';

export async function managementChecks(
  kit: MfaKit,
  enrolled: { secret: Buffer; recoveryCodes: string[] },
): Promise<void> {
  const { secret, recoveryCodes } = enrolled;
  const {
    db,
    admin,
    password,
    check,
    cookieJar,
    orm,
    eq,
    schema,
    cmsUsers,
    cmsMfaFactors,
    auth,
    users,
    flow,
    manage,
    repo,
    openTotpSecret,
    resolveSession,
    createSession,
    cmsRepo,
    findActingAdmin,
    runMfaReset,
    outcome,
    clearAttempts,
    secretOf,
    codeAt,
    count,
    audited,
    signInWithPassword,
    sessionUser,
  } = kit;

  // --- G. recovery codes -----------------------------------------------------------------
  await signInWithPassword(admin.email, password);
  const viaRecovery = await flow.challengeVerify(recoveryCodes[0].toLowerCase(), CTX);
  check(
    'recovery code (lower case) signs in, nine left, session with MFA',
    viaRecovery.ok &&
      viaRecovery.data.method === 'recovery' &&
      viaRecovery.data.recoveryCodesLeft === 9 &&
      (await sessionUser())?.mfaVerified === true,
  );
  await signInWithPassword(admin.email, password);
  check(
    'a used recovery code is refused',
    (await outcome(() => flow.challengeVerify(recoveryCodes[0], CTX))) === 'invalid_code',
  );
  const noDashes = await flow.challengeVerify(recoveryCodes[1].replace(/-/g, ''), CTX);
  check(
    'a recovery code without dashes works (eight left)',
    noDashes.ok && (await count('codes', admin.id)) === 8,
  );

  // --- H. key change / misconfiguration -------------------------------------------------
  await clearAttempts();
  process.env.CMS_MFA_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  await signInWithPassword(admin.email, password);
  const unreadable = await outcome(() => flow.challengeVerify(codeAt(secret), CTX));
  const recoveredAfterKeyChange = await flow.challengeVerify(recoveryCodes[2], CTX);
  delete process.env.CMS_MFA_ENCRYPTION_KEY;
  check(
    'another encryption key: the factor is unreadable, a recovery code still signs in',
    unreadable === 'unreadable' && recoveredAfterKeyChange.ok,
    unreadable,
  );

  // --- I. signed-in management with re-authentication ------------------------------------
  await clearAttempts();
  const current = cookieJar.get('cms_session') ?? '';
  const otherDevice = await createSession(db, admin.id, CTX, { mfaVerified: true });
  const codesBefore = await count('codes', admin.id);
  const wrongPassword = await manage.startFactorReplacement(
    { password: 'Verkeerd-Wachtwoord-2026', code: recoveryCodes[3] },
    CTX,
  );
  const wrongCode = await manage.startFactorReplacement({ password, code: '000002' }, CTX);
  check(
    're-auth: a wrong password or a wrong code is refused; the wrong password burns no recovery code',
    !wrongPassword.ok &&
      wrongPassword.error === 'reauth_failed' &&
      !wrongCode.ok &&
      wrongCode.error === 'reauth_failed' &&
      (await count('codes', admin.id)) === codesBefore,
  );
  const replacing = await manage.startFactorReplacement({ password, code: recoveryCodes[3] }, CTX);
  if (!replacing.ok) throw new Error(`startFactorReplacement failed: ${replacing.message}`);
  const secret2 = secretOf(replacing.data.otpauthUri);
  cookieJar.set('cms_session', otherDevice.token);
  check(
    'replacement: another session cannot confirm it (bound to the starting session)',
    (await outcome(() => manage.confirmFactorReplacement(codeAt(secret2), CTX))) === 'not_allowed',
  );
  cookieJar.set('cms_session', current);
  const beforeReplace = await resolveSession(db, current);
  const replaced = await manage.confirmFactorReplacement(codeAt(secret2), CTX);
  const newCodes = replaced.ok ? replaced.data.recoveryCodes : [];
  const factorsNow = await db
    .select()
    .from(cmsMfaFactors)
    .where(eq(cmsMfaFactors.userId, admin.id));
  check(
    'replacement: the new authenticator is the only factor, old codes gone, ten new ones',
    replaced.ok &&
      factorsNow.length === 1 &&
      openTotpSecret(admin.id, factorsNow[0].secretEnc)?.equals(secret2) === true &&
      newCodes.length === 10 &&
      !(await repo.consumeRecoveryCode(db, admin.id, recoveryCodes[4])).ok,
  );
  check(
    'replacement: every other session revoked, this browser re-issued with MFA',
    (await resolveSession(db, otherDevice.token)) === null &&
      (await resolveSession(db, current)) === null &&
      (await sessionUser())?.mfaVerified === true,
  );
  const afterReplace = await sessionUser();
  check(
    'replacement: the new session keeps the absolute end and the step-up time (no extension)',
    !!beforeReplace?.absoluteExpiresAt &&
      afterReplace?.absoluteExpiresAt?.getTime() === beforeReplace.absoluteExpiresAt.getTime() &&
      afterReplace?.reauthenticatedAt?.getTime() === beforeReplace.reauthenticatedAt?.getTime(),
  );
  check(
    'replacement: audited (auth.mfa_replace)',
    (await audited('auth.mfa_replace')).length === 1,
  );
  const thisBrowser = cookieJar.get('cms_session') ?? '';
  const anotherDevice = await createSession(db, admin.id, CTX, { mfaVerified: true });
  const regenerated = await manage.regenerateRecoveryCodes({ password, code: newCodes[0] }, CTX);
  const codes3 = regenerated.ok ? regenerated.data.recoveryCodes : [];
  check(
    'new recovery codes: old set void, other sessions revoked, this one kept',
    regenerated.ok &&
      codes3.length === 10 &&
      !(await repo.consumeRecoveryCode(db, admin.id, newCodes[1])).ok &&
      (await resolveSession(db, anotherDevice.token)) === null &&
      (await resolveSession(db, thisBrowser))?.mfaVerified === true,
  );
  check(
    'an admin cannot switch MFA off',
    (await outcome(() => manage.removeOwnFactor({ password, code: codes3[0] }, CTX))) ===
      'not_allowed',
  );

  // --- J. a new admin, then break-glass by another admin ------------------------------
  await clearAttempts();
  const created = await users.createUser({ email: SECOND_ADMIN, name: 'Tweede', role: 'admin' });
  if (!created.ok || !created.data.temporaryPassword) throw new Error('createUser failed');
  const adminCookies = new Map(cookieJar);
  const secondId = created.data.user.id;
  const secondLogin = await signInWithPassword(SECOND_ADMIN, created.data.temporaryPassword);
  check(
    'new admin: password sign-in → challenge, step "password" first, enrolment closed',
    secondLogin.ok &&
      secondLogin.data.secondStep &&
      (await flow.getCurrentMfaChallenge())?.step === 'password' &&
      (await outcome(() => flow.challengeStartEnrolment())) === 'not_allowed',
  );
  const badChange = await flow.challengeChangePassword({
    currentPassword: 'Verkeerd-Wachtwoord-2026',
    newPassword: SECOND_ADMIN_PASSWORD,
  });
  const goodChange = await flow.challengeChangePassword({
    currentPassword: created.data.temporaryPassword,
    newPassword: SECOND_ADMIN_PASSWORD,
  });
  check(
    'new admin: the temporary password is replaced inside the challenge (no session yet)',
    !badChange.ok &&
      goodChange.ok &&
      (await flow.getCurrentMfaChallenge())?.step === 'enrol' &&
      (await count('sessions', secondId)) === 0,
  );
  process.env.CMS_MFA_ENCRYPTION_KEY = 'kort';
  const misconfigured = await outcome(() => flow.challengeStartEnrolment());
  delete process.env.CMS_MFA_ENCRYPTION_KEY;
  check(
    'a malformed encryption key fails closed (not_configured)',
    misconfigured === 'not_configured',
  );
  const secondStart = await flow.challengeStartEnrolment();
  if (!secondStart.ok) throw new Error('second admin enrolment failed to start');
  const secondEnrol = await flow.challengeConfirmEnrolment(
    codeAt(secretOf(secondStart.data.otpauthUri)),
    CTX,
  );
  const secondToken = cookieJar.get('cms_session') ?? '';
  check(
    'new admin: enrolled, signed in with MFA, can work',
    secondEnrol.ok &&
      (await sessionUser())?.mfaVerified === true &&
      (await outcome(() => cmsRepo.listPages())) === 'ok',
  );
  cookieJar.clear();
  for (const [name, value] of adminCookies) cookieJar.set(name, value);
  const selfReset = await outcome(() =>
    manage.adminResetUserMfa(admin.id, { password, code: codes3[1] }, CTX),
  );
  const badReset = await outcome(() =>
    manage.adminResetUserMfa(
      secondId,
      { password: 'Verkeerd-Wachtwoord-2026', code: codes3[1] },
      CTX,
    ),
  );
  check(
    'break-glass: not for yourself; a wrong password is refused',
    selfReset === 'not_allowed' && badReset === 'reauth_failed',
    `${selfReset} / ${badReset}`,
  );
  // Someone holding the old password locked the colleague out (daily backstop).
  await kit.failFrom(
    secondId,
    Array.from({ length: 50 }, (_, i) => `10.40.0.${i}`),
  );
  const lockedBefore = await kit.limited(secondId, '10.50.0.1');
  const reset = await manage.adminResetUserMfa(secondId, { password, code: codes3[1] }, CTX);
  check(
    'break-glass also lifts a lock-out caused by guessing (counters of the user cleared)',
    lockedBefore && !(await kit.limited(secondId, '10.50.0.1')),
  );
  const [secondRow] = await db.select().from(cmsUsers).where(eq(cmsUsers.id, secondId));
  check(
    'break-glass: factor and codes gone, sessions revoked, temporary password, audited',
    reset.ok &&
      reset.data.temporaryPassword.length >= 12 &&
      (await count('factors', secondId)) === 0 &&
      (await count('codes', secondId)) === 0 &&
      (await resolveSession(db, secondToken)) === null &&
      secondRow?.mustChangePassword === true &&
      (await audited('user.mfa_reset', secondId)).length === 1,
  );
  const oldPassword = await auth.verifyCredentials(db, SECOND_ADMIN, SECOND_ADMIN_PASSWORD, CTX);
  check('break-glass: the old password no longer works', !oldPassword.ok);
  if (reset.ok) {
    await signInWithPassword(SECOND_ADMIN, reset.data.temporaryPassword);
    check(
      'break-glass: next sign-in starts at the password step again',
      (await flow.getCurrentMfaChallenge())?.step === 'password',
    );
  }

  // --- K. editors are unchanged ------------------------------------------------------------
  cookieJar.clear();
  for (const [name, value] of adminCookies) cookieJar.set(name, value);
  const editor = await users.createUser({ email: EDITOR, name: 'Redacteur', role: 'editor' });
  if (!editor.ok || !editor.data.temporaryPassword) throw new Error('createUser (editor) failed');
  const editorLogin = await signInWithPassword(EDITOR, editor.data.temporaryPassword);
  const editorSession = await sessionUser();
  check(
    'editor: password sign-in gives a session directly (no challenge), as before',
    editorLogin.ok &&
      editorLogin.data.secondStep === false &&
      editorSession?.mfaVerified === false &&
      (await count('challenges', editor.data.user.id)) === 0,
  );
  const editorChange = await auth.changePassword({
    currentPassword: editor.data.temporaryPassword,
    newPassword: 'Redacteur-Eigen-2026',
  });
  check(
    'editor: forced password change, then content access without MFA',
    editorChange.ok && (await outcome(() => cmsRepo.listPages())) === 'ok',
  );

  // --- L. break-glass CLI core, then re-enrol ------------------------------------------------
  cookieJar.clear();
  const quiet = () => {};
  const dry = await runMfaReset({ db, email: admin.email, apply: false, log: quiet });
  check(
    'CLI dry run: counts only, nothing removed',
    dry.authenticators === 1 && (await count('factors', admin.id)) === 1,
  );
  const BREAK_GLASS = 'Nood-Wachtwoord-2026x';
  await runMfaReset({
    db,
    email: admin.email.toUpperCase(),
    apply: true,
    temporaryPassword: BREAK_GLASS,
    log: quiet,
  });
  const cliAudit = await audited('auth.mfa_break_glass');
  check(
    'CLI apply: factor, codes and sessions gone; audited without an actor',
    (await count('factors', admin.id)) === 0 &&
      (await count('codes', admin.id)) === 0 &&
      (await count('sessions', admin.id)) === 0 &&
      cliAudit.length === 1 &&
      cliAudit[0].userId === null,
  );
  await clearAttempts();
  const oldAfterCli = await auth.verifyCredentials(db, admin.email, password, CTX);
  check('CLI with a temporary password: the old password no longer works', !oldAfterCli.ok);
  await signInWithPassword(admin.email, BREAK_GLASS);
  const cliChange = await flow.challengeChangePassword({
    currentPassword: BREAK_GLASS,
    newPassword: password,
  });
  check(
    'after the CLI reset: temporary password replaced first, then enrolment',
    cliChange.ok && (await flow.getCurrentMfaChallenge())?.step === 'enrol',
  );
  const again = await flow.challengeStartEnrolment();
  const reEnrolled = again.ok
    ? await flow.challengeConfirmEnrolment(codeAt(secretOf(again.data.otpauthUri)), CTX)
    : again;
  check('re-enrolled (sections 14–19 act as this admin)', reEnrolled.ok);
  check(
    'CLI actor lookup picks the re-enrolled admin',
    (await findActingAdmin({ db, orm, schema }))?.id === admin.id,
  );

  await auth.logout();
  await clearAttempts();
  cookieJar.clear();
}
