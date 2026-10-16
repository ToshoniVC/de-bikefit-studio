/**
 * Self-test section 5g, parts F–I. Entry point and part list:
 * `./provider-mfa.mts`.
 *
 *  F. a provider cannot switch MFA off, cannot reset anyone's MFA and cannot
 *     reach user management (role isolation: `forbidden`, nothing changes);
 *     the step-up asks for the code; an own password change needs a recent
 *     step-up and keeps MFA and the standard session class;
 *  G. an admin resets the provider's MFA (sessions gone, temporary password,
 *     the next sign-in replaces it and enrols again); the break-glass CLI core
 *     does the same for a provider;
 *  H. role changes: editor → provider makes the same session `mfa_required`
 *     at its next request and the next sign-in enrols; provider → editor keeps
 *     the authenticator (still asked at sign-in), which the editor may then
 *     remove;
 *  I. regressions: an editor without an authenticator signs in with the
 *     password alone (checked in H, before the promotion); an admin is still
 *     challenged and gets the admin session class.
 */
import type { Jar } from './mfa-concurrency-kit.mjs';
import { CTX, type Call, type MfaKit } from './mfa-kit.mjs';
import {
  HOUR,
  MIN,
  PROVIDER,
  PROVIDER_PASSWORD,
  providerKit,
  type ProviderState,
} from './provider-mfa-kit.mjs';

const NEW_PASSWORD = 'Aanbieder-Nieuw-2026x';
const EDITOR = 'promotie-redacteur@selftest.local';
const EDITOR_PASSWORD = 'Redacteur-Promotie-2026';

export async function providerRoleChecks(kit: MfaKit, state: ProviderState): Promise<void> {
  const {
    db,
    admin,
    password: adminPassword,
    check,
    eq,
    cmsSessions,
    cmsUsers,
    auth,
    users,
    flow,
    manage,
    cmsRepo,
    bookingRepo,
    runMfaReset,
    resolveSession,
    outcome,
    clearAttempts,
    secretOf,
    codeAt,
    count,
    audited,
  } = kit;
  const { as, sessionOf, signIn, sessionRow, userRow, near } = providerKit(kit);
  const reauth = await import('@/lib/cms/mfa/reauth');
  const { hashPassword } = await import('@/lib/cms/password');
  const { providerId, jar, recoveryCodes, adminJar, adminCodes } = state;

  // --- F. what a provider may not do; the step-up -----------------------------------------
  await clearAttempts();
  const removal = await as(jar, () =>
    outcome(() =>
      manage.removeOwnFactor({ password: PROVIDER_PASSWORD, code: recoveryCodes[2] }, CTX),
    ),
  );
  check(
    'a provider cannot switch MFA off (only replace it); no recovery code was spent',
    removal === 'not_allowed' &&
      (await count('factors', providerId)) === 1 &&
      (await count('codes', providerId)) === 8,
    removal,
  );

  const adminFactors = await count('factors', admin.id);
  const adminHash = (await userRow(admin.id))?.passwordHash;
  const isolation: Call[] = [
    [
      "adminResetUserMfa() of the admin's factor",
      () =>
        manage.adminResetUserMfa(
          admin.id,
          { password: PROVIDER_PASSWORD, code: recoveryCodes[2] },
          CTX,
        ),
    ],
    ['listMfaEnrolledUserIds()', () => manage.listMfaEnrolledUserIds()],
    ['listCmsUsers()', () => users.listCmsUsers()],
    ['resetUserPassword() of the admin', () => users.resetUserPassword(admin.id)],
    ['setUserRole() of itself to admin', () => users.setUserRole(providerId, 'admin')],
  ];
  for (const [label, call] of isolation) {
    const result = await as(jar, () => outcome(call));
    check(
      `isolation: the provider is refused ${label} (forbidden)`,
      result === 'forbidden',
      result,
    );
  }
  check(
    'isolation: nothing changed (admin factor and password, provider role and codes)',
    (await count('factors', admin.id)) === adminFactors &&
      (await userRow(admin.id))?.passwordHash === adminHash &&
      (await userRow(providerId))?.role === 'provider' &&
      (await count('codes', providerId)) === 8,
  );

  const current = await sessionOf(jar);
  // Test-only: the provider signed in more than 5 minutes ago.
  await db
    .update(cmsSessions)
    .set({ reauthenticatedAt: new Date(Date.now() - 6 * MIN) })
    .where(eq(cmsSessions.id, current?.sessionId ?? ''));
  const before = await as(jar, () => reauth.getStepUpStatus());
  const noStepUp = await as(jar, () =>
    outcome(() =>
      auth.changePassword({ currentPassword: PROVIDER_PASSWORD, newPassword: NEW_PASSWORD }),
    ),
  );
  check(
    'own password change without a recent step-up: refused (reauth_required); the form asks for a code',
    noStepUp === 'reauth_required' && before.needsCode && before.until === null,
    noStepUp,
  );
  const passwordOnly = await as(jar, () =>
    reauth.confirmIdentity({ password: PROVIDER_PASSWORD, code: '' }, CTX),
  );
  const wrongCode = await as(jar, () =>
    reauth.confirmIdentity({ password: PROVIDER_PASSWORD, code: '000000' }, CTX),
  );
  check(
    'step-up: the password alone, or with a wrong code, is refused',
    !passwordOnly.ok &&
      passwordOnly.error === 'reauth_failed' &&
      !wrongCode.ok &&
      wrongCode.error === 'reauth_failed',
  );
  const stepped = await as(jar, () =>
    reauth.confirmIdentity({ password: PROVIDER_PASSWORD, code: recoveryCodes[2] }, CTX),
  );
  const changedOwn = await as(jar, () =>
    auth.changePassword({ currentPassword: PROVIDER_PASSWORD, newPassword: NEW_PASSWORD }),
  );
  const replacement = await sessionOf(jar);
  check(
    'step-up with password + code, then the own password change works; the new session keeps MFA and the standard class',
    stepped.ok &&
      changedOwn.ok &&
      replacement?.mfaVerified === true &&
      replacement.absoluteExpiresAt === null &&
      replacement.sessionId !== current?.sessionId,
    changedOwn.ok ? '' : changedOwn.message,
  );

  // --- G. an admin's MFA reset, and the break-glass CLI ---------------------------------
  await clearAttempts();
  const providerToken = jar.get('cms_session') ?? '';
  const reset = await as(adminJar, () =>
    manage.adminResetUserMfa(providerId, { password: adminPassword, code: adminCodes[0] }, CTX),
  );
  if (!reset.ok) throw new Error(`adminResetUserMfa failed: ${reset.message}`);
  check(
    "admin resets the provider's MFA: factor and codes gone, sessions revoked, temporary password, audited",
    reset.data.mustEnrol === true &&
      (await count('factors', providerId)) === 0 &&
      (await count('codes', providerId)) === 0 &&
      (await count('sessions', providerId)) === 0 &&
      (await resolveSession(db, providerToken)) === null &&
      (await userRow(providerId))?.mustChangePassword === true &&
      (await audited('user.mfa_reset', providerId)).length === 1,
  );
  const afterReset = await signIn(jar, PROVIDER, reset.data.temporaryPassword);
  check(
    'after the reset: the next sign-in is a challenge that starts with a new password (no session)',
    afterReset.ok &&
      afterReset.data.secondStep &&
      (await as(jar, () => flow.getCurrentMfaChallenge()))?.step === 'password' &&
      (await count('sessions', providerId)) === 0,
  );
  const renewed = await as(jar, () =>
    flow.challengeChangePassword({
      currentPassword: reset.data.temporaryPassword,
      newPassword: PROVIDER_PASSWORD,
    }),
  );
  const restart = await as(jar, () => flow.challengeStartEnrolment());
  if (!restart.ok) throw new Error(`re-enrolment failed to start: ${restart.message}`);
  const reEnrolled = await as(jar, () =>
    flow.challengeConfirmEnrolment(codeAt(secretOf(restart.data.otpauthUri)), CTX),
  );
  check(
    '… then it enrols again: session with MFA, ten new recovery codes',
    renewed.ok &&
      reEnrolled.ok &&
      (await sessionOf(jar))?.mfaVerified === true &&
      (await count('codes', providerId)) === 10,
  );

  const lines: string[] = [];
  const dry = await runMfaReset({
    db,
    email: PROVIDER,
    apply: false,
    log: (_symbol, message) => lines.push(message),
  });
  check(
    'break-glass CLI, dry run: finds the provider (role shown) and counts, changes nothing',
    dry.authenticators === 1 &&
      lines.some((line) => line.startsWith(`${PROVIDER} (provider)`)) &&
      (await count('factors', providerId)) === 1,
    lines[0] ?? '',
  );
  await runMfaReset({ db, email: PROVIDER, apply: true, log: () => {} });
  const cliAudit = await audited('auth.mfa_break_glass', providerId);
  check(
    "break-glass CLI, apply: the provider's factor, codes and sessions gone; audited without an actor",
    (await count('factors', providerId)) === 0 &&
      (await count('codes', providerId)) === 0 &&
      (await count('sessions', providerId)) === 0 &&
      cliAudit.length === 1 &&
      cliAudit[0].userId === null,
  );
  const afterCli = await signIn(jar, PROVIDER, PROVIDER_PASSWORD);
  check(
    'after the CLI reset (password kept): the next sign-in goes straight to a new enrolment',
    afterCli.ok &&
      afterCli.data.secondStep &&
      (await as(jar, () => flow.getCurrentMfaChallenge()))?.step === 'enrol' &&
      (await count('sessions', providerId)) === 0,
  );
  const again = await as(jar, () => flow.challengeStartEnrolment());
  if (!again.ok) throw new Error(`enrolment after the CLI reset failed: ${again.message}`);
  const enrolledAgain = await as(jar, () =>
    flow.challengeConfirmEnrolment(codeAt(secretOf(again.data.otpauthUri)), CTX),
  );
  const codes = enrolledAgain.ok ? enrolledAgain.data.recoveryCodes : [];
  check(
    '… and enrols again: session with MFA',
    enrolledAgain.ok && (await sessionOf(jar))?.mfaVerified === true,
  );

  // --- H. role changes (and the editor regression of I) ----------------------------------
  await clearAttempts();
  // Test-only: role changes need a step-up within 5 minutes; renew the admin's
  // (stamped in B) so a slow runner does not hit the window between B and H.
  const adminActing = await sessionOf(adminJar);
  await db
    .update(cmsSessions)
    .set({ reauthenticatedAt: new Date() })
    .where(eq(cmsSessions.id, adminActing?.sessionId ?? ''));
  const [editorRow] = await db
    .insert(cmsUsers)
    .values({
      email: EDITOR,
      name: 'Promotie',
      role: 'editor',
      passwordHash: await hashPassword(EDITOR_PASSWORD),
      mustChangePassword: false,
      isActive: true,
    })
    .returning({ id: cmsUsers.id });
  const editorId = editorRow.id;
  const editorJar: Jar = new Map();
  const editorLogin = await signIn(editorJar, EDITOR, EDITOR_PASSWORD);
  check(
    'editor (regression): the password alone gives a session; no challenge, no MFA; content access works',
    editorLogin.ok &&
      editorLogin.data.secondStep === false &&
      (await sessionOf(editorJar))?.mfaVerified === false &&
      (await count('challenges', editorId)) === 0 &&
      (await as(editorJar, () => outcome(() => cmsRepo.listPages()))) === 'ok',
  );
  const promoted = await as(adminJar, () => users.setUserRole(editorId, 'provider'));
  const afterPromotion: Call[] = [
    ['requireCmsUser()', () => auth.requireCmsUser()],
    ["requirePermission('provider.self')", () => auth.requirePermission('provider.self')],
    ['getOwnProvider()', () => bookingRepo.getOwnProvider()],
  ];
  for (const [label, call] of afterPromotion) {
    const result = await as(editorJar, () => outcome(call));
    check(
      `promotion editor → provider: the same session is refused at its next request (${label})`,
      promoted.ok && result === 'mfa_required',
      result,
    );
  }
  check(
    'promotion: that session keeps the standard class (no admin limits)',
    (await sessionOf(editorJar))?.absoluteExpiresAt === null,
  );
  const promotedLogin = await as(editorJar, () =>
    auth.login({ email: EDITOR, password: EDITOR_PASSWORD, context: CTX }),
  );
  check(
    'promotion: the next sign-in revokes that session and enrols (no session before the second step)',
    promotedLogin.ok &&
      promotedLogin.data.secondStep &&
      (await as(editorJar, () => flow.getCurrentMfaChallenge()))?.step === 'enrol' &&
      (await count('sessions', editorId)) === 0,
  );

  const demoted = await as(adminJar, () => users.setUserRole(providerId, 'editor'));
  check(
    'demotion provider → editor: the MFA session goes on as an editor one; the authenticator is kept',
    demoted.ok &&
      (await as(jar, () => outcome(() => auth.requirePermission('page.read')))) === 'ok' &&
      (await count('factors', providerId)) === 1,
  );
  const otherBrowser: Jar = new Map();
  const keptFactor = await signIn(otherBrowser, PROVIDER, PROVIDER_PASSWORD);
  check(
    'demotion: the kept authenticator is still asked at sign-in (verify step)',
    keptFactor.ok &&
      keptFactor.data.secondStep &&
      (await as(otherBrowser, () => flow.getCurrentMfaChallenge()))?.step === 'verify',
  );
  await as(otherBrowser, () => flow.abandonMfaChallenge());
  const removed = await as(jar, () =>
    manage.removeOwnFactor({ password: PROVIDER_PASSWORD, code: codes[0] }, CTX),
  );
  check(
    'demotion: as an editor the user may now switch MFA off; then sign-in needs the password only',
    removed.ok &&
      (await count('factors', providerId)) === 0 &&
      (await sessionOf(jar))?.mfaVerified === false &&
      (await auth.requiresSecondStep(db, { id: providerId, role: 'editor' })) === false,
    removed.ok ? '' : removed.message,
  );

  // --- I. admin regression ------------------------------------------------------------------
  await clearAttempts();
  const adminBrowser: Jar = new Map();
  const adminLogin = await signIn(adminBrowser, admin.email, adminPassword);
  check(
    'admin (regression): the password still opens only a challenge (verify step, no session)',
    adminLogin.ok &&
      adminLogin.data.secondStep &&
      !adminBrowser.get('cms_session') &&
      (await as(adminBrowser, () => flow.getCurrentMfaChallenge()))?.step === 'verify',
  );
  const adminVerified = await as(adminBrowser, () => flow.challengeVerify(adminCodes[1], CTX));
  const adminSession = await sessionOf(adminBrowser);
  const adminRow = adminSession ? await sessionRow(adminSession.sessionId) : null;
  const ta = adminRow?.createdAt.getTime() ?? 0;
  check(
    'admin (regression): after the code, the admin session class (15 min idle expiry, 8 h absolute end)',
    adminVerified.ok &&
      adminSession?.mfaVerified === true &&
      near(adminRow?.expiresAt, ta + 15 * MIN) &&
      near(adminRow?.absoluteExpiresAt, ta + 8 * HOUR),
  );

  // --- clean-up: the section's users (their sessions, factors, profile and hours cascade) --
  await as(adminBrowser, () => auth.logout());
  await db.delete(cmsSessions).where(eq(cmsSessions.id, state.adminActingSessionId));
  await db.delete(cmsUsers).where(eq(cmsUsers.id, editorId));
  await db.delete(cmsUsers).where(eq(cmsUsers.id, providerId));
  await clearAttempts();
}
