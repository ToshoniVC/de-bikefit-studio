/**
 * Self-test section 5g: mandatory two-step verification for providers
 * ("Aanbieder"), on the throwaway PGlite of `cms-selftest.mts`, through the
 * real modules (`src/lib/cms/mfa/*`, `auth.ts`, `users.ts`, the booking repo).
 * Runs after 5f, with the self-test admin enrolled. Every simulated browser
 * has its own cookie jar (`inBrowser()` from `./mfa-concurrency-kit.mts`).
 *
 *  A. policy: providers require the second step, editors do not; providers
 *     keep the standard session class (a separate, open decision);
 *  B. an admin creates the provider login (temporary password, once);
 *  C. a provider session from before this change (no second step) still
 *     resolves, yet the guards, the own agenda reads and writes
 *     (`getOwnProvider()`, bookings, hours), the password change, the check
 *     both Google OAuth routes make and the draft preview all refuse it;
 *     nothing is written;
 *  D. the very first sign-in, in order: password → challenge only (no
 *     session, the old one revoked) → the temporary password replaced inside
 *     the challenge → enrolment (QR, ten recovery codes) → session with MFA,
 *     standard lifetime (not ended by the admin limits), own agenda works;
 *  E. TOTP second step; recovery-code second step, single use;
 *  F–I (`./provider-mfa-roles.mts`): no switch-off, no reset of anyone else,
 *     step-up asks for the code, own password change needs it; an admin's
 *     MFA reset and the break-glass CLI force a new enrolment; role changes;
 *     editor and admin regressions.
 *
 * "Test-only" steps are marked (sessions created directly where the sign-in
 * itself is not under test, back-dated columns, fresh recovery codes for the
 * self-test admin's re-authentication); everything else is the production
 * code path.
 */
import { installBrowserJars, type Jar } from './mfa-concurrency-kit.mjs';
import { CTX, loadMfaKit, type Call, type MfaKit, type MfaSectionContext } from './mfa-kit.mjs';
import {
  DAY,
  HOUR,
  MIN,
  PROVIDER,
  PROVIDER_PASSWORD,
  providerKit,
  type ProviderState,
} from './provider-mfa-kit.mjs';
import { providerRoleChecks } from './provider-mfa-roles.mjs';

const HOURS = [{ weekday: 1, startMinute: 540, endMinute: 720 }];

export async function providerMfaSection(ctx: MfaSectionContext) {
  ctx.section('5g. two-step verification for providers (Aanbieder)');
  const kit = await loadMfaKit(ctx);
  const uninstallJars = installBrowserJars();
  try {
    const state = await signInChecks(kit);
    await providerRoleChecks(kit, state);
  } finally {
    uninstallJars();
    ctx.cookieJar.clear();
  }
}

/** A–E. */
async function signInChecks(kit: MfaKit): Promise<ProviderState> {
  const {
    db,
    admin,
    check,
    eq,
    schema,
    cmsSessions,
    cmsMfaFactors,
    auth,
    flow,
    manage,
    repo,
    hotp,
    totpStep,
    createSession,
    resolveSession,
    bookingRepo,
    canPreview,
    outcome,
    clearAttempts,
    secretOf,
    codeAt,
    count,
    audited,
  } = kit;
  const { as, sessionOf, signIn, sessionRow, userRow, near } = providerKit(kit);
  const { roleRequiresMfa, cmsAccessDenial } = await import('@/lib/cms/guard');
  const { sessionPolicyFor } = await import('@/lib/cms/session-policy');

  // --- A. policy -----------------------------------------------------------------------
  check(
    'policy: admins and providers need the second step, editors do not',
    roleRequiresMfa('admin') && roleRequiresMfa('provider') && !roleRequiresMfa('editor'),
  );
  check(
    'policy: providers keep the standard session class (decided separately), admins the admin one',
    sessionPolicyFor('provider') === 'standard' && sessionPolicyFor('admin') === 'admin',
  );

  // --- B. an admin creates the provider login ------------------------------------------
  await clearAttempts();
  // Test-only: the self-test admin, signed in with password and code just now.
  const adminActing = await createSession(db, admin.id, CTX, {
    mfaVerified: true,
    reauthenticated: true,
  });
  const adminJar: Jar = new Map([['cms_session', adminActing.token]]);
  // Test-only: fresh recovery codes, so the admin can re-authenticate (5e, 19 do the same).
  const adminCodes = await repo.replaceRecoveryCodes(db, admin.id);
  const created = await as(adminJar, () =>
    bookingRepo.createProvider({ newUser: { email: PROVIDER, name: 'Aanbieder MFA' } }),
  );
  if (!created.ok || !created.data.temporaryPassword) {
    throw new Error(`createProvider failed: ${created.ok ? 'no password' : created.message}`);
  }
  const providerId = created.data.provider.userId;
  const providerRowId = created.data.provider.id;
  const temporary = created.data.temporaryPassword;
  check(
    'admin creates a provider login: role provider, temporary password once, no authenticator',
    created.data.provider.userRole === 'provider' &&
      (await userRow(providerId))?.mustChangePassword === true &&
      (await count('factors', providerId)) === 0,
  );

  // --- C. a provider session from before provider MFA ------------------------------------
  const jar: Jar = new Map();
  // Test-only: the row a password sign-in of a provider created before this change.
  const legacy = await createSession(db, providerId, CTX, { reauthenticated: true });
  jar.set('cms_session', legacy.token);
  const legacyUser = await as(jar, () => auth.getCurrentCmsUser());
  check(
    'legacy: the provider session still resolves (identity only, mfaVerified false)',
    legacyUser?.id === providerId && legacyUser.mfaVerified === false,
  );
  const hashBefore = (await userRow(providerId))?.passwordHash;
  const refused: Call[] = [
    ['requireCmsUser()', () => auth.requireCmsUser()],
    [
      'requireCmsUser(…, { allowMustChangePassword })',
      () => auth.requireCmsUser(undefined, { allowMustChangePassword: true }),
    ],
    ["requirePermission('provider.self')", () => auth.requirePermission('provider.self')],
    ['getOwnProvider() (Mijn agenda)', () => bookingRepo.getOwnProvider()],
    ["listBookings({ scope: 'own' })", () => bookingRepo.listBookings({ scope: 'own' })],
    [
      'setBusinessHours() on the own profile',
      () => bookingRepo.setBusinessHours(providerRowId, HOURS),
    ],
    [
      'changePassword()',
      () => auth.changePassword({ currentPassword: temporary, newPassword: PROVIDER_PASSWORD }),
    ],
    [
      'startFactorReplacement()',
      () => manage.startFactorReplacement({ password: temporary, code: '000000' }, CTX),
    ],
  ];
  for (const [label, call] of refused) {
    const result = await as(jar, () => outcome(call));
    check(`legacy: refused ${label}`, result === 'mfa_required', result);
  }
  const routeCheck = await as(jar, async () => cmsAccessDenial(await auth.getCurrentCmsUser()));
  check(
    'legacy: the check both Google OAuth routes make answers mfa_required',
    routeCheck === 'mfa_required',
    String(routeCheck),
  );
  check('legacy: canPreview() is false', (await as(jar, () => canPreview())) === false);
  const hours = await db
    .select({ id: schema.cmsBusinessHours.id })
    .from(schema.cmsBusinessHours)
    .where(eq(schema.cmsBusinessHours.providerId, providerRowId));
  check(
    'legacy: nothing was written (no hours, password unchanged)',
    hours.length === 0 && (await userRow(providerId))?.passwordHash === hashBefore,
  );

  // --- D. the very first sign-in, in order ------------------------------------------------
  const first = await as(jar, () =>
    auth.login({ email: PROVIDER, password: temporary, context: CTX }),
  );
  check(
    'first sign-in: the password only opens a challenge; no session, the legacy one revoked',
    first.ok &&
      first.data.secondStep === true &&
      !jar.get('cms_session') &&
      Boolean(jar.get('cms_mfa')) &&
      (await resolveSession(db, legacy.token)) === null &&
      (await count('sessions', providerId)) === 0,
  );
  const opened = await as(jar, () => flow.getCurrentMfaChallenge());
  const closed = await as(jar, async () => [
    await outcome(() => flow.challengeStartEnrolment()),
    await outcome(() => flow.challengeVerify('123456', CTX)),
    await outcome(() => flow.challengeConfirmEnrolment('123456', CTX)),
  ]);
  check(
    'first sign-in: the temporary password comes first; enrolment, verify and confirm are closed',
    opened?.step === 'password' && closed.every((result) => result === 'not_allowed'),
    `${opened?.step}; ${closed.join(', ')}`,
  );
  for (const [label, call] of [
    ["requirePermission('provider.self')", () => auth.requirePermission('provider.self')],
    ['getOwnProvider()', () => bookingRepo.getOwnProvider()],
  ] as Call[]) {
    const result = await as(jar, () => outcome(call));
    check(
      `challenge only: refused ${label} (unauthenticated)`,
      result === 'unauthenticated',
      result,
    );
  }
  const changed = await as(jar, () =>
    flow.challengeChangePassword({ currentPassword: temporary, newPassword: PROVIDER_PASSWORD }),
  );
  check(
    'first sign-in: the temporary password is replaced inside the challenge, still no session; next: enrolment',
    changed.ok &&
      (await as(jar, () => flow.getCurrentMfaChallenge()))?.step === 'enrol' &&
      (await userRow(providerId))?.mustChangePassword === false &&
      (await count('sessions', providerId)) === 0,
  );
  const started = await as(jar, () => flow.challengeStartEnrolment());
  if (!started.ok) throw new Error(`provider enrolment failed to start: ${started.message}`);
  const secret = secretOf(started.data.otpauthUri);
  check(
    'enrolment: a 160-bit secret for this provider account, QR code and key to type over',
    secret.length === 20 &&
      started.data.otpauthUri.includes(`:${encodeURIComponent(PROVIDER)}?`) &&
      started.data.qrPath.length > 0 &&
      started.data.manualKey.length > 0,
  );
  const enrolled = await as(jar, () => flow.challengeConfirmEnrolment(codeAt(secret), CTX));
  const recoveryCodes = enrolled.ok ? enrolled.data.recoveryCodes : [];
  const firstSession = await sessionOf(jar);
  check(
    'enrolment: the first code creates the session WITH MFA; ten recovery codes, shown once',
    enrolled.ok &&
      recoveryCodes.length === 10 &&
      (await count('codes', providerId)) === 10 &&
      firstSession?.user.id === providerId &&
      firstSession.mfaVerified === true &&
      !jar.get('cms_mfa') &&
      (await count('challenges', providerId)) === 0,
    enrolled.ok ? '' : enrolled.message,
  );
  check(
    'enrolment: audited (auth.mfa_enrol)',
    (await audited('auth.mfa_enrol', providerId)).length === 1,
  );

  const row = firstSession ? await sessionRow(firstSession.sessionId) : null;
  const t0 = row?.createdAt.getTime() ?? 0;
  check(
    'provider session: the standard class — 14 days, no absolute end, cookie at the sliding expiry',
    near(row?.expiresAt, t0 + 14 * DAY) &&
      row?.absoluteExpiresAt === null &&
      firstSession?.absoluteExpiresAt === null &&
      firstSession.cookieExpiresAt.getTime() === row?.expiresAt.getTime(),
  );
  // Test-only: a second MFA session of the provider, used at moved clocks.
  const probe = await createSession(db, providerId, CTX, { mfaVerified: true });
  const tp = (await sessionRow(probe.id))!.createdAt.getTime();
  const idle = await resolveSession(db, probe.token, new Date(tp + 16 * MIN));
  const long = await resolveSession(db, probe.token, new Date(tp + 9 * HOUR));
  check(
    'provider session: not ended by the admin limits (16 min idle, 9 h after sign-in)',
    idle !== null && long !== null,
  );
  await db.delete(cmsSessions).where(eq(cmsSessions.id, probe.id));

  const working: Call[] = [
    ['getOwnProvider()', () => bookingRepo.getOwnProvider()],
    ["listBookings({ scope: 'own' })", () => bookingRepo.listBookings({ scope: 'own' })],
    [
      'setBusinessHours() on the own profile',
      () => bookingRepo.setBusinessHours(providerRowId, HOURS),
    ],
  ];
  for (const [label, call] of working) {
    const result = await as(jar, () => outcome(call));
    check(`after enrolment: ${label} passes`, result === 'ok', result);
  }
  const status = await as(jar, () => manage.getOwnMfaStatus());
  check(
    'status: enrolled, required (no switch-off offered), ten codes',
    status.enrolled && status.required && status.recoveryCodesLeft === 10,
  );

  // --- E. TOTP and recovery codes as the second step --------------------------------------
  await as(jar, () => auth.logout());
  const second = await signIn(jar, PROVIDER, PROVIDER_PASSWORD);
  check(
    'with an authenticator: verify step, no session yet; no second enrolment over a challenge',
    second.ok &&
      second.data.secondStep &&
      !jar.get('cms_session') &&
      (await as(jar, () => flow.getCurrentMfaChallenge()))?.step === 'verify' &&
      (await as(jar, () => outcome(() => flow.challengeStartEnrolment()))) === 'not_allowed',
  );
  const [factor] = await db
    .select()
    .from(cmsMfaFactors)
    .where(eq(cmsMfaFactors.userId, providerId));
  // A step after the enrolment code's, inside the ±1 window around now.
  const step = Math.max((factor?.lastUsedStep ?? 0) + 1, totpStep(Date.now()));
  const viaTotp = await as(jar, () => flow.challengeVerify(hotp(secret, step), CTX));
  check(
    'TOTP second step → session with MFA, audited as method totp',
    viaTotp.ok &&
      viaTotp.data.method === 'totp' &&
      (await sessionOf(jar))?.mfaVerified === true &&
      (await audited('auth.mfa_verify', providerId)).some(
        (entry) => (entry.metadata as { method?: string } | null)?.method === 'totp',
      ),
    viaTotp.ok ? '' : viaTotp.message,
  );

  await as(jar, () => auth.logout());
  await signIn(jar, PROVIDER, PROVIDER_PASSWORD);
  const viaRecovery = await as(jar, () => flow.challengeVerify(recoveryCodes[0], CTX));
  check(
    'recovery-code second step → session with MFA, nine left',
    viaRecovery.ok &&
      viaRecovery.data.method === 'recovery' &&
      viaRecovery.data.recoveryCodesLeft === 9 &&
      (await sessionOf(jar))?.mfaVerified === true,
  );
  await as(jar, () => auth.logout());
  await signIn(jar, PROVIDER, PROVIDER_PASSWORD);
  const reused = await as(jar, () => outcome(() => flow.challengeVerify(recoveryCodes[0], CTX)));
  const another = await as(jar, () => flow.challengeVerify(recoveryCodes[1], CTX));
  check(
    'a used recovery code is refused (single use); another one signs in',
    reused === 'invalid_code' && another.ok && (await count('codes', providerId)) === 8,
    reused,
  );

  return {
    providerId,
    providerRowId,
    jar,
    recoveryCodes,
    adminJar,
    adminActingSessionId: adminActing.id,
    adminCodes,
  };
}
