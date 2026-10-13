/**
 * Self-test section 5c: mandatory TOTP two-step verification for admins, on
 * the throwaway PGlite of `cms-selftest.mts`, through the real modules
 * (`src/lib/cms/mfa/*`, `auth.ts`, the content and booking repos) with the
 * cookie-jar stub standing in for the browser. It runs on the self-test's own
 * admin, whose password section 5b made permanent, and ends with that admin
 * enrolled, so sections 14–16 (and the CLIs they drive) act as an admin who
 * could do the same in the browser.
 *
 *  A. migration 0004: tables, the new session column, re-runnable;
 *  B. legacy admin session (from before MFA): valid, yet refused everywhere
 *     with `mfa_required`, direct repo calls included; nothing written;
 *  C. password sign-in: only a challenge, no session; the challenge token is
 *     no session token; only the enrolment step is open;
 *  D. enrolment: sealed secret, wrong code counted, first code → session with
 *     MFA, ten hashed recovery codes, CLI actor now this admin;
 *  E. TOTP sign-in: no re-enrolment over a challenge, replay, earlier step and
 *     concurrent use rejected, a later step accepted;
 *  F. challenge expiry, the five-failure challenge limit, user / IP / daily
 *     rate limits (a correct code is refused while limited);
 *  G. recovery-code sign-in: one use each, forgiving format;
 *  H. a changed encryption key: factor unreadable, recovery codes still work;
 *     a malformed key fails closed;
 *  I. signed-in management with re-authentication: replace the authenticator
 *     (bound to the session that started it; old factor, codes and other
 *     sessions gone), new recovery codes, an admin cannot remove MFA;
 *  J. a new admin: temporary password → own password → enrolment, and the
 *     break-glass reset by another admin (temporary password, sessions gone);
 *  K. editors unchanged: password-only session, no challenge;
 *  L. the break-glass CLI core (dry run, apply, audit), then re-enrolment.
 *
 * "Test-only" steps (moving a challenge's expiry, clearing the attempt log to
 * stand for the 15-minute window passing, verifying at an injected time) are
 * marked; everything else is the production code path.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { managementChecks } from './mfa-manage.mjs';
import { CTX, loadMfaKit, type Call, type MfaKit, type MfaSectionContext } from './mfa-kit.mjs';

export async function mfaSection(ctx: MfaSectionContext) {
  ctx.section('5c. two-step verification (TOTP) for admins');
  const kit = await loadMfaKit(ctx);
  const enrolled = await signInChecks(kit);
  await managementChecks(kit, enrolled);
}

/** A–F. Returns what G–L continue with. */
async function signInChecks(kit: MfaKit): Promise<{ secret: Buffer; recoveryCodes: string[] }> {
  const {
    db,
    admin,
    password,
    check,
    cookieJar,
    orm,
    eq,
    sql,
    schema,
    cmsPages,
    cmsUsers,
    cmsMfaAttempts,
    cmsMfaChallenges,
    cmsMfaFactors,
    cmsMfaRecoveryCodes,
    auth,
    users,
    flow,
    manage,
    repo,
    openTotpSecret,
    base32Encode,
    hotp,
    totpStep,
    resolveSession,
    createSession,
    hashSessionToken,
    hashChallengeToken,
    cmsRepo,
    bookingRepo,
    canPreview,
    findActingAdmin,
    outcome,
    clearAttempts,
    secretOf,
    codeAt,
    count,
    audited,
    signInWithPassword,
    sessionUser,
  } = kit;

  // --- A. migration ----------------------------------------------------------
  const tables = await db.execute(
    sql`select table_name from information_schema.tables where table_schema = 'public'`,
  );
  const tableNames = (tables as unknown as { rows: Array<{ table_name: string }> }).rows.map(
    (row) => row.table_name,
  );
  for (const table of [
    'cms_mfa_factors',
    'cms_mfa_recovery_codes',
    'cms_mfa_challenges',
    'cms_mfa_attempts',
  ]) {
    check(`migration 0004: table ${table}`, tableNames.includes(table));
  }
  const column = await db.execute(
    sql`select data_type, is_nullable from information_schema.columns
        where table_name = 'cms_sessions' and column_name = 'mfa_verified_at'`,
  );
  const columnRow = (column as unknown as { rows: Array<Record<string, string>> }).rows[0];
  check(
    'migration 0004: cms_sessions.mfa_verified_at is a nullable timestamptz',
    columnRow?.data_type === 'timestamp with time zone' && columnRow?.is_nullable === 'YES',
    JSON.stringify(columnRow),
  );
  const migrationSql = await readFile(
    resolve(process.cwd(), 'drizzle/0004_cms_admin_mfa.sql'),
    'utf8',
  );
  check(
    'migration 0004: additive only (no DROP, no TRUNCATE, no DELETE, no UPDATE)',
    !/\b(DROP|TRUNCATE)\b|\bDELETE\s+FROM\b|\bUPDATE\s+"?\w+"?\s+SET\b/i.test(
      migrationSql.replace(/^--.*$/gm, ''),
    ),
  );
  let rerun = 'ok';
  try {
    for (let pass = 0; pass < 2; pass += 1) {
      for (const statement of migrationSql.split('--> statement-breakpoint')) {
        if (statement.replace(/^--.*$/gm, '').trim()) await db.execute(sql.raw(statement));
      }
    }
  } catch (error) {
    rerun = error instanceof Error ? error.message : String(error);
  }
  check('migration 0004: re-running it twice is a no-op', rerun === 'ok', rerun);

  // --- B. a legacy admin session (from before MFA) -----------------------------
  const legacy = await createSession(db, admin.id, CTX);
  cookieJar.clear();
  cookieJar.set('cms_session', legacy.token);
  const legacyUser = await auth.getCurrentCmsUser();
  check(
    'legacy: the pre-MFA session still resolves (mfaVerified false)',
    legacyUser?.id === admin.id && legacyUser.mfaVerified === false,
  );
  const BYPASS_SLUG = 'selftest-mfa-bypass';
  const refused: Call[] = [
    ['requireCmsUser()', () => auth.requireCmsUser()],
    ["requireCmsUser('admin')", () => auth.requireCmsUser('admin')],
    [
      'requireCmsUser(…, { allowMustChangePassword })',
      () => auth.requireCmsUser(undefined, { allowMustChangePassword: true }),
    ],
    ["requirePermission('page.read')", () => auth.requirePermission('page.read')],
    ['content repo listPages()', () => cmsRepo.listPages()],
    ['content repo createPage()', () => cmsRepo.createPage({ slug: BYPASS_SLUG, title: 'X' })],
    ['users listCmsUsers()', () => users.listCmsUsers()],
    [
      'users createUser()',
      () => users.createUser({ email: 'bypass@selftest.local', name: 'X', role: 'admin' }),
    ],
    ['booking repo listBookings()', () => bookingRepo.listBookings()],
    [
      'changePassword()',
      () =>
        auth.changePassword({ currentPassword: password, newPassword: 'Ander-Wachtwoord-2026' }),
    ],
    [
      'startFactorReplacement()',
      () => manage.startFactorReplacement({ password, code: '000000' }, CTX),
    ],
    [
      'adminResetUserMfa()',
      () => manage.adminResetUserMfa('someone', { password, code: '000000' }, CTX),
    ],
  ];
  for (const [label, call] of refused) {
    const result = await outcome(call);
    check(`legacy: refused ${label}`, result === 'mfa_required', result);
  }
  check('legacy: canPreview() is false', (await canPreview()) === false);
  const [bypassPage] = await db
    .select({ id: cmsPages.id })
    .from(cmsPages)
    .where(eq(cmsPages.slug, BYPASS_SLUG));
  const [bypassUser] = await db
    .select({ id: cmsUsers.id })
    .from(cmsUsers)
    .where(eq(cmsUsers.email, 'bypass@selftest.local'));
  check('legacy: nothing was written', !bypassPage && !bypassUser);

  // --- C. password sign-in: a challenge, never a session -------------------------
  await clearAttempts();
  const loggedIn = await auth.login({ email: admin.email, password, context: CTX });
  check(
    'login(): secondStep, no session',
    loggedIn.ok && loggedIn.data.secondStep === true && !cookieJar.get('cms_session'),
  );
  check(
    'login(): the legacy session of this browser was revoked',
    (await resolveSession(db, legacy.token)) === null,
  );
  check('login(): the admin has no session at all', (await count('sessions', admin.id)) === 0);
  const challengeToken = cookieJar.get('cms_mfa') ?? '';
  const [challengeRow] = await db
    .select()
    .from(cmsMfaChallenges)
    .where(eq(cmsMfaChallenges.userId, admin.id));
  check(
    'challenge: cms_mfa cookie set, only its HMAC stored, expiry ≤ 10 minutes',
    challengeToken.length >= 40 &&
      challengeRow?.tokenHash === hashChallengeToken(challengeToken) &&
      challengeRow.tokenHash !== hashSessionToken(challengeToken) &&
      challengeRow.tokenHash !== challengeToken &&
      challengeRow.expiresAt.getTime() - Date.now() <= 10 * 60 * 1000,
  );
  const challengeOnly: Call[] = [
    ['requireCmsUser()', () => auth.requireCmsUser()],
    ["requirePermission('page.read')", () => auth.requirePermission('page.read')],
    ['content repo listPages()', () => cmsRepo.listPages()],
    ['booking repo listBookings()', () => bookingRepo.listBookings()],
    ['users listCmsUsers()', () => users.listCmsUsers()],
  ];
  for (const [label, call] of challengeOnly) {
    const result = await outcome(call);
    check(`challenge only: refused ${label}`, result === 'unauthenticated', result);
  }
  cookieJar.set('cms_session', challengeToken);
  check(
    'challenge token used as a session cookie: not a session',
    (await auth.getCurrentCmsUser()) === null &&
      (await outcome(() => cmsRepo.listPages())) === 'unauthenticated',
  );
  cookieJar.delete('cms_session');
  const view = await flow.getCurrentMfaChallenge();
  check('challenge: next step is enrolment', view?.step === 'enrol', view?.step);
  check(
    'challenge: verify, password change and confirm are not open yet',
    (await outcome(() => flow.challengeVerify('123456', CTX))) === 'not_allowed' &&
      (await outcome(() =>
        flow.challengeChangePassword({ currentPassword: password, newPassword: password }),
      )) === 'not_allowed' &&
      (await outcome(() => flow.challengeConfirmEnrolment('123456', CTX))) === 'not_allowed',
  );

  // --- D. enrolment ------------------------------------------------------------------
  const started = await flow.challengeStartEnrolment();
  if (!started.ok) throw new Error(`challengeStartEnrolment failed: ${started.message}`);
  const secret = secretOf(started.data.otpauthUri);
  const issuer = new URL(started.data.otpauthUri).searchParams.get('issuer') ?? '';
  check(
    'enrolment: otpauth URI with a 160-bit secret, issuer and manual key',
    secret.length === 20 &&
      issuer.startsWith('De Bikefit Studio') &&
      started.data.manualKey.replace(/ /g, '') === base32Encode(secret) &&
      started.data.qrPath.length > 0,
  );
  const [pending] = await db.select().from(cmsMfaFactors).where(eq(cmsMfaFactors.userId, admin.id));
  check(
    'enrolment: pending factor bound to this challenge, secret sealed (AAD = user id)',
    pending?.confirmedAt === null &&
      pending.pendingContext === `challenge:${challengeRow?.id}` &&
      !pending.secretEnc.includes(base32Encode(secret)) &&
      openTotpSecret(admin.id, pending.secretEnc)?.equals(secret) === true &&
      openTotpSecret('another-user', pending.secretEnc) === null,
  );
  const wrongEnrol = await flow.challengeConfirmEnrolment(
    hotp(secret, totpStep(Date.now()) + 5),
    CTX,
  );
  const [afterWrong] = await db
    .select({ failed: cmsMfaChallenges.failedAttempts })
    .from(cmsMfaChallenges)
    .where(eq(cmsMfaChallenges.userId, admin.id));
  check(
    'enrolment: a wrong code is refused and counted (challenge, attempt log, audit)',
    !wrongEnrol.ok &&
      wrongEnrol.error === 'invalid_code' &&
      afterWrong?.failed === 1 &&
      (await audited('auth.mfa_failed')).length >= 1,
  );
  const enrolled = await flow.challengeConfirmEnrolment(codeAt(secret), CTX);
  const recoveryCodes = enrolled.ok ? enrolled.data.recoveryCodes : [];
  check('enrolment: the first code confirms it', enrolled.ok, enrolled.ok ? '' : enrolled.message);
  check(
    'enrolment: ten recovery codes shown once, only their hashes stored',
    recoveryCodes.length === 10 && (await count('codes', admin.id)) === 10,
  );
  const storedHashes = await db
    .select({ hash: cmsMfaRecoveryCodes.codeHash })
    .from(cmsMfaRecoveryCodes)
    .where(eq(cmsMfaRecoveryCodes.userId, admin.id));
  check(
    'enrolment: no plaintext recovery code in the database',
    storedHashes.every(
      (row) => !recoveryCodes.some((code) => row.hash.includes(code.replace(/-/g, ''))),
    ),
  );
  const firstSession = await sessionUser();
  check(
    'enrolment: a session WITH mfa_verified_at, challenge consumed, cms_mfa cleared',
    firstSession?.user.id === admin.id &&
      firstSession.mfaVerified === true &&
      (await count('challenges', admin.id)) === 0 &&
      !cookieJar.get('cms_mfa'),
  );
  check('enrolment: audited (auth.mfa_enrol)', (await audited('auth.mfa_enrol')).length === 1);
  const passing: Call[] = [
    ["requireCmsUser('admin')", () => auth.requireCmsUser('admin')],
    ['content repo listPages()', () => cmsRepo.listPages()],
    ['booking repo listBookings()', () => bookingRepo.listBookings()],
    ['users listCmsUsers()', () => users.listCmsUsers()],
  ];
  for (const [label, call] of passing) {
    const result = await outcome(call);
    check(`after enrolment: ${label} passes`, result === 'ok', result);
  }
  const status = await manage.getOwnMfaStatus();
  check(
    'status: enrolled, required, 10 codes left',
    status.enrolled && status.required && status.recoveryCodesLeft === 10,
  );
  const actor = await findActingAdmin({ db, orm, schema });
  check('CLI actor lookup now picks this admin', actor?.id === admin.id, actor?.email ?? '');

  // --- E. TOTP sign-in, replay ---------------------------------------------------------
  await auth.logout();
  check('logout(): the MFA session is revoked', (await count('sessions', admin.id)) === 0);
  await signInWithPassword(admin.email, password);
  check(
    'second sign-in: verify step; enrolling again over a challenge is refused',
    (await flow.getCurrentMfaChallenge())?.step === 'verify' &&
      (await outcome(() => flow.challengeStartEnrolment())) === 'not_allowed',
  );
  const [factor] = await db.select().from(cmsMfaFactors).where(eq(cmsMfaFactors.userId, admin.id));
  const lastStep = factor?.lastUsedStep ?? -1;
  const replay = await flow.challengeVerify(hotp(secret, lastStep), CTX);
  check(
    'replay: the code used for enrolment is refused (same step)',
    !replay.ok && replay.error === 'replayed',
    replay.ok ? 'accepted!' : replay.error,
  );
  const later = await flow.challengeVerify(hotp(secret, lastStep + 1), CTX);
  check(
    'a code for a later step in the window is accepted → session with MFA',
    later.ok && (await sessionUser())?.mfaVerified === true,
    later.ok ? '' : later.message,
  );
  check(
    'sign-in audited (auth.mfa_verify, method totp)',
    (await audited('auth.mfa_verify')).some(
      (row) => (row.metadata as { method?: string } | null)?.method === 'totp',
    ),
  );
  check(
    'the consumed challenge cannot be used again',
    (await outcome(() => flow.challengeVerify(hotp(secret, lastStep + 1), CTX))) === 'expired',
  );
  // Test-only: verify at injected times far ahead, so real-time codes are not
  // involved (afterwards real-time TOTP for this factor reads as replayed).
  const future = lastStep + 100;
  const at = (step: number) => step * 30_000 + 1_000;
  const once = await repo.verifyTotpFactor(db, admin.id, hotp(secret, future), at(future));
  const twice = await repo.verifyTotpFactor(db, admin.id, hotp(secret, future), at(future));
  const earlier = await repo.verifyTotpFactor(db, admin.id, hotp(secret, future - 1), at(future));
  check(
    'replay (repo): same step twice → second refused; an earlier step → refused',
    once.ok &&
      !twice.ok &&
      twice.reason === 'replayed' &&
      !earlier.ok &&
      earlier.reason === 'replayed',
  );
  const race = await Promise.all([
    repo.verifyTotpFactor(db, admin.id, hotp(secret, future + 50), at(future + 50)),
    repo.verifyTotpFactor(db, admin.id, hotp(secret, future + 50), at(future + 50)),
  ]);
  check(
    'replay (repo): two concurrent uses of one code → exactly one accepted',
    race.filter((result) => result.ok).length === 1,
  );

  // --- F. expiry and limits ---------------------------------------------------------
  await clearAttempts();
  await signInWithPassword(admin.email, password);
  await db
    .update(cmsMfaChallenges)
    .set({ expiresAt: new Date(Date.now() - 1000) }) // test-only: let it expire
    .where(eq(cmsMfaChallenges.userId, admin.id));
  check(
    'an expired challenge is refused and deleted',
    (await outcome(() => flow.challengeVerify(recoveryCodes[0], CTX))) === 'expired' &&
      (await count('challenges', admin.id)) === 0,
  );
  await signInWithPassword(admin.email, password);
  const failures: string[] = [];
  for (let i = 0; i < 5; i += 1)
    failures.push(await outcome(() => flow.challengeVerify('000001', CTX)));
  check(
    'five wrong codes use the challenge up (fifth → expired, row deleted)',
    failures.slice(0, 4).every((f) => f === 'invalid_code') &&
      failures[4] === 'expired' &&
      (await count('challenges', admin.id)) === 0,
    failures.join(','),
  );
  await signInWithPassword(admin.email, password);
  check(
    'user+IP rate limit: after five failures a CORRECT recovery code is refused',
    (await outcome(() => flow.challengeVerify(recoveryCodes[0], CTX))) === 'rate_limited' &&
      (await count('codes', admin.id)) === 10,
  );
  check(
    'someone guessing elsewhere does not block the owner on another IP',
    (await repo.mfaRateLimited(db, admin.id, '10.20.5.5')) === false,
  );
  check(
    'an unknown client IP is not one shared bucket (user rule alone applies)',
    (await repo.mfaRateLimited(db, admin.id, 'unknown')) === true,
  );
  await clearAttempts();
  const recentIp = '10.20.9.9';
  // Another user's failures from one IP: only the IP rule can block the admin.
  const [ipUser] = await db
    .insert(cmsUsers)
    .values({
      email: 'ip-test@selftest.local',
      name: 'IP',
      role: 'editor',
      passwordHash: 'x',
      isActive: false,
    })
    .returning({ id: cmsUsers.id });
  await db.insert(cmsMfaAttempts).values(
    Array.from({ length: 10 }, () => ({
      userId: ipUser.id,
      ipAddress: recentIp,
      successful: false,
    })),
  );
  check(
    'IP rate limit: ten failures from one IP block that IP, not others',
    (await repo.mfaRateLimited(db, admin.id, recentIp)) === true &&
      (await repo.mfaRateLimited(db, admin.id, '10.20.9.10')) === false,
  );
  await db.delete(cmsUsers).where(eq(cmsUsers.id, ipUser.id));
  await clearAttempts();
  await db.insert(cmsMfaAttempts).values(
    Array.from({ length: 50 }, () => ({
      userId: admin.id,
      ipAddress: `10.30.0.${Math.floor(Math.random() * 200)}`,
      successful: false,
      attemptedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    })),
  );
  check(
    'daily backstop: fifty failures in a day from many IPs block the user everywhere',
    (await repo.mfaRateLimited(db, admin.id, '10.20.0.77')) === true,
  );
  await clearAttempts();
  check(
    'no limit with a clean log',
    (await repo.mfaRateLimited(db, admin.id, CTX.ipAddress)) === false,
  );

  return { secret, recoveryCodes };
}
