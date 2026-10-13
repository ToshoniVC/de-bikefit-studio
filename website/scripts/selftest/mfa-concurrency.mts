/**
 * Self-test section 5f: two-step verification under concurrency, on the
 * throwaway PGlite of `cms-selftest.mts`, through the real modules. Runs after
 * 5e on two throwaway admins; every simulated browser has its own cookie jar
 * (an AsyncLocalStorage the `next/headers` stub reads).
 *
 * Bursts count the code checks that ACTUALLY ran, not the answers: a TOTP
 * check computes 2·window + 1 HMAC-SHA1 values (`verifyTotp` in totp.ts) and
 * nothing else on these paths uses SHA-1, so a spy on `crypto.createHmac`
 * counts them; the audit rows and the reserved hits cross-check.
 *
 *  A. migration 0007: rate-limit table, one challenge per user (unique index),
 *     additive apart from the documented dedupe, re-runnable;
 *  B. every scope holds under parallel reservations (user + IP 5, IP 10, day
 *     50), a refused one keeps nothing, a release frees exactly one hit;
 *  C. sign-in: 20 parallel wrong codes on one challenge → at most 5 checked;
 *  D. 2 rounds × 3 parallel password sign-ins × 5 codes from one IP → at most
 *     5 checked in the window; at most one challenge row, replaced cookies dead;
 *  E. enrolment, replacement and re-authentication bursts → at most 5 each;
 *  F. one valid TOTP code twice and one recovery code twice, in parallel →
 *     exactly one success each;
 *  G. a success gives its hit back (a correct code after four failures still
 *     works and is not counted); an unreadable factor costs nothing;
 *  H. a password change and an admin's password reset end a sign-in challenge
 *     from before them.
 *
 * Test-only steps are marked: clearing the counters stands for the 15-minute
 * window passing, moving `last_used_step` back for the next 30-second step.
 * Browsers, the spy and the helpers: `./mfa-concurrency-kit.mts`.
 */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CmsDatabase } from '@/db/cms';
import {
  CTX,
  EMAIL,
  ENROL_EMAIL,
  NEW_PASSWORD,
  PASSWORD,
  countTotpChecks,
  inBrowser,
  installBrowserJars,
  loadConcurrencyKit,
  tally,
  type Jar,
} from './mfa-concurrency-kit.mjs';

type Check = (label: string, condition: boolean, detail?: string) => void;

const BURST = 20;
const LIMIT = 5;

export async function mfaConcurrencySection(ctx: {
  db: CmsDatabase;
  admin: { id: string; email: string };
  check: Check;
  section: (title: string) => void;
  cookieJar: Jar;
}) {
  const { db, admin, check, section, cookieJar } = ctx;
  section('5f. two-step verification under concurrency (reserve before every check)');
  const uninstallJars = installBrowserJars();
  const {
    sql,
    eq,
    cmsMfaChallenges,
    cmsSessions,
    cmsUsers,
    auth,
    users,
    flow,
    manage,
    confirmIdentity,
    resolveMfaChallenge,
    releaseMfaAttempt,
    reserveMfaAttempt,
    hotp,
    totpStep,
    TOTP_WINDOW,
    hashPassword,
    createSession,
    outcome,
    audits,
    hitsIn,
    sessionsOf,
    challengesOf,
    codesLeft,
    clearLimits,
    freshStep,
    secretOf,
    wrongCodes,
    signIn,
    challengeIn,
    verifyAll,
    newUser,
    userKey,
  } = await loadConcurrencyKit(db);

  // --- A. migration 0007 ----------------------------------------------------------
  const columns = (
    (await db.execute(
      sql`select column_name, data_type, is_nullable from information_schema.columns
          where table_name = 'cms_mfa_rate_limits' order by column_name`,
    )) as unknown as { rows: Array<Record<string, string>> }
  ).rows;
  check(
    'migration 0007: cms_mfa_rate_limits (scope, user_id nullable, hits timestamptz[], updated_at)',
    columns.map((c) => `${c.column_name}:${c.data_type}:${c.is_nullable}`).join(' ') ===
      'hits:ARRAY:NO scope:text:NO updated_at:timestamp with time zone:NO user_id:text:YES',
    JSON.stringify(columns),
  );
  const indexes = (
    (await db.execute(
      sql`select indexname, indexdef from pg_indexes where tablename = 'cms_mfa_challenges'`,
    )) as unknown as { rows: Array<{ indexname: string; indexdef: string }> }
  ).rows;
  const unique = indexes.find((i) => i.indexname === 'cms_mfa_challenges_user_id_unique_idx');
  check(
    'migration 0007: one challenge per user (unique index), the old index kept',
    !!unique?.indexdef.includes('UNIQUE') &&
      indexes.some((i) => i.indexname === 'cms_mfa_challenges_user_id_idx'),
  );
  const migrationSql = await readFile(
    resolve(process.cwd(), 'drizzle/0007_cms_mfa_rate_limits.sql'),
    'utf8',
  );
  const code0007 = migrationSql.replace(/^--.*$/gm, '');
  check(
    'migration 0007: additive (no DROP / TRUNCATE / UPDATE, no webshop table); one DELETE: the challenge dedupe',
    !/\b(DROP|TRUNCATE)\b|\bUPDATE\s+"?\w+"?\s+SET\b/i.test(code0007) &&
      !/"(users|products|orders|order_items)"/.test(code0007) &&
      (code0007.match(/\bDELETE\s+FROM\b/gi) ?? []).length === 1 &&
      /DELETE\s+FROM\s+"cms_mfa_challenges"/.test(code0007),
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
  check('migration 0007: re-running it twice is a no-op', rerun === 'ok', rerun);

  // --- set-up: a throwaway admin with an authenticator, enrolled in the browser ----
  const userId = await newUser(EMAIL, 'admin', await hashPassword(PASSWORD));
  const setup: Jar = new Map();
  await signIn(setup);
  const { secret, recoveryCodes } = await inBrowser(setup, async () => {
    const started = await flow.challengeStartEnrolment();
    if (!started.ok) throw new Error(`enrolment did not start: ${started.message}`);
    const enrolSecret = secretOf(started.data.otpauthUri);
    const enrolled = await flow.challengeConfirmEnrolment(
      hotp(enrolSecret, totpStep(Date.now())),
      CTX,
    );
    if (!enrolled.ok) throw new Error(`enrolment failed: ${enrolled.message}`);
    await auth.logout();
    return { secret: enrolSecret, recoveryCodes: enrolled.data.recoveryCodes };
  });
  await challengeIn(new Map(), userId);
  const second = await db
    .insert(cmsMfaChallenges)
    .values({
      userId,
      tokenHash: `selftest-duplicate-${randomBytes(8).toString('hex')}`,
      expiresAt: new Date(Date.now() + 60_000),
    })
    .then(
      () => 'inserted',
      () => 'refused',
    );
  check(
    'one challenge per user: a second row for the same user is refused by the database',
    second === 'refused' && (await challengesOf(userId)) === 1,
    second,
  );

  // --- B. the scopes under parallel reservations -------------------------------------
  await clearLimits();
  const parallel = (count: number, make: (i: number) => Promise<{ ok: boolean }>) =>
    Promise.all(Array.from({ length: count }, (_, i) => make(i)));
  const sameMs = Date.now();
  const userIp = await parallel(12, () => reserveMfaAttempt(db, userId, '10.61.0.1', sameMs));
  check(
    'user + IP: 12 parallel reservations (one millisecond) → exactly 5 granted, 5 hits stored',
    userIp.filter((r) => r.ok).length === LIMIT &&
      (await hitsIn(userKey(userId, '10.61.0.1'))) === 5,
    `${userIp.filter((r) => r.ok).length} granted`,
  );
  const granted = userIp.find((r) => r.ok) as Extract<
    Awaited<ReturnType<typeof reserveMfaAttempt>>,
    { ok: true }
  >;
  await releaseMfaAttempt(db, granted.reservation);
  const again = await parallel(3, () => reserveMfaAttempt(db, userId, '10.61.0.1'));
  check(
    'a release frees exactly ONE of five equal hits: one of three parallel granted again',
    again.filter((r) => r.ok).length === 1 && (await hitsIn(userKey(userId, '10.61.0.1'))) === 5,
  );
  const others = [
    await newUser('parallel-ip-1@selftest.local', 'editor', 'x'),
    await newUser('parallel-ip-2@selftest.local', 'editor', 'x'),
    await newUser('parallel-ip-3@selftest.local', 'editor', 'x'),
  ];
  const sameIp = await parallel(15, (i) => reserveMfaAttempt(db, others[i % 3], '10.61.0.2'));
  const keptPerUser = await Promise.all(others.map((id) => hitsIn(userKey(id, '10.61.0.2'))));
  check(
    'IP: 3 users × 5 parallel from one IP → exactly 10 granted; refused ones keep no user hit',
    sameIp.filter((r) => r.ok).length === 10 &&
      (await hitsIn('ip:10.61.0.2')) === 10 &&
      keptPerUser.reduce((a, b) => a + b, 0) === 10,
    `${sameIp.filter((r) => r.ok).length} granted, per user ${keptPerUser.join('/')}`,
  );
  await clearLimits();
  const day = await parallel(60, (i) => reserveMfaAttempt(db, userId, `10.62.${i}.1`));
  check(
    'day: 60 parallel reservations from 60 IPs → exactly 50 granted',
    day.filter((r) => r.ok).length === 50 && (await hitsIn(`user:${userId}|day`)) === 50,
    `${day.filter((r) => r.ok).length} granted`,
  );

  // --- C. sign-in burst on one challenge ---------------------------------------------
  await clearLimits();
  const jarC: Jar = new Map();
  await signIn(jarC);
  const failedBefore = await audits('auth.mfa_failed', userId);
  const codesC = wrongCodes(secret, BURST);
  const stopC = countTotpChecks(TOTP_WINDOW);
  const burstC = await verifyAll(jarC, codesC);
  const checkedC = stopC();
  const failedC = (await audits('auth.mfa_failed', userId)) - failedBefore;
  check(
    `sign-in: ${BURST} parallel wrong codes on one challenge → at most ${LIMIT} codes checked`,
    checkedC >= 1 && checkedC <= LIMIT && failedC === checkedC,
    `${checkedC} of ${BURST} checked, ${failedC} failures audited; answers: ${tally(burstC)}`,
  );
  check(
    'sign-in burst: every unchecked request refused (rate_limited / expired), hits = failures',
    burstC.every((a) => ['invalid_code', 'expired', 'rate_limited'].includes(a)) &&
      burstC.filter((a) => a === 'invalid_code').length <= checkedC &&
      (await hitsIn(userKey(userId))) === checkedC,
  );

  // --- D. parallel password sign-ins, one IP ---------------------------------------------
  await clearLimits();
  const codesD = wrongCodes(secret, LIMIT);
  const jarsD: Jar[] = [];
  const answersD: string[] = [];
  const stopD = countTotpChecks(TOTP_WINDOW);
  for (let round = 0; round < 2; round += 1) {
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        const jar: Jar = new Map();
        jarsD.push(jar);
        const login = await signIn(jar);
        answersD.push(...(login.ok ? await verifyAll(jar, codesD) : [`login ${login.error}`]));
      }),
    );
  }
  const checkedD = stopD();
  const liveTokens = (
    await Promise.all(jarsD.map((jar) => resolveMfaChallenge(db, jar.get('cms_mfa'))))
  ).filter(Boolean).length;
  check(
    `2 rounds × 3 parallel password sign-ins × ${LIMIT} codes: at most ${LIMIT} checked in the window`,
    checkedD <= LIMIT,
    `${checkedD} of ${2 * 3 * LIMIT} checked; answers: ${tally(answersD)}`,
  );
  check(
    'parallel sign-ins leave at most one challenge row and one working cookie of six',
    (await challengesOf(userId)) <= 1 && liveTokens <= 1,
    `${await challengesOf(userId)} row(s), ${liveTokens} live`,
  );

  // --- E. enrolment, replacement and re-authentication bursts ------------------------------
  const enrolId = await newUser(ENROL_EMAIL, 'admin', await hashPassword(PASSWORD));
  await clearLimits();
  const jarZ: Jar = new Map();
  await signIn(jarZ, ENROL_EMAIL);
  const started = await inBrowser(jarZ, () => flow.challengeStartEnrolment());
  if (!started.ok) throw new Error(`enrolment did not start: ${started.message}`);
  const codesZ = wrongCodes(secretOf(started.data.otpauthUri), BURST);
  const stopZ = countTotpChecks(TOTP_WINDOW);
  const burstZ = await inBrowser(jarZ, () =>
    Promise.all(codesZ.map((c) => outcome(() => flow.challengeConfirmEnrolment(c, CTX)))),
  );
  const checkedZ = stopZ();
  check(
    `enrolment: ${BURST} parallel wrong first codes → at most ${LIMIT} checked`,
    checkedZ >= 1 && checkedZ <= LIMIT,
    `${checkedZ} of ${BURST} checked; answers: ${tally(burstZ)}`,
  );

  await clearLimits();
  const jarE: Jar = new Map();
  await signIn(jarE);
  const signedIn = await inBrowser(jarE, () => flow.challengeVerify(recoveryCodes[0], CTX));
  if (!signedIn.ok) throw new Error(`sign-in failed: ${signedIn.message}`);
  const reauthBefore = await audits('auth.mfa_reauth_failed', userId);
  const codesE = wrongCodes(secret, BURST);
  const stopE = countTotpChecks(TOTP_WINDOW);
  const burstE = await inBrowser(jarE, () =>
    Promise.all(
      codesE.map((c) => outcome(() => confirmIdentity({ password: PASSWORD, code: c }, CTX))),
    ),
  );
  const checkedE = stopE();
  const reauthFailed = (await audits('auth.mfa_reauth_failed', userId)) - reauthBefore;
  check(
    `re-authentication: ${BURST} parallel wrong codes → at most ${LIMIT} checked, the rest rate_limited`,
    checkedE >= 1 &&
      checkedE <= LIMIT &&
      reauthFailed === checkedE &&
      burstE.filter((a) => a === 'rate_limited').length === BURST - checkedE,
    `${checkedE} of ${BURST} checked, ${reauthFailed} failures audited; answers: ${tally(burstE)}`,
  );

  await clearLimits();
  const replacing = await inBrowser(jarE, () =>
    manage.startFactorReplacement({ password: PASSWORD, code: recoveryCodes[1] }, CTX),
  );
  if (!replacing.ok) throw new Error(`replacement did not start: ${replacing.message}`);
  const codesR = wrongCodes(secretOf(replacing.data.otpauthUri), BURST);
  const stopR = countTotpChecks(TOTP_WINDOW);
  const burstR = await inBrowser(jarE, () =>
    Promise.all(codesR.map((c) => outcome(() => manage.confirmFactorReplacement(c, CTX)))),
  );
  const checkedR = stopR();
  check(
    `authenticator replacement: ${BURST} parallel wrong codes → at most ${LIMIT} checked`,
    checkedR >= 1 && checkedR <= LIMIT,
    `${checkedR} of ${BURST} checked; answers: ${tally(burstR)}`,
  );

  // --- F. one code, two requests --------------------------------------------------------
  await clearLimits();
  await freshStep(userId);
  const jarF: Jar = new Map();
  await challengeIn(jarF, userId);
  const sessionsBefore = await sessionsOf(userId);
  const valid = hotp(secret, totpStep(Date.now()));
  const twice = await verifyAll(jarF, [valid, valid]);
  check(
    'the same valid TOTP code in two parallel requests → exactly one success, one new session',
    twice.filter((a) => a === 'ok').length === 1 &&
      (await sessionsOf(userId)) === sessionsBefore + 1,
    tally(twice),
  );
  const jarF2: Jar = new Map();
  await challengeIn(jarF2, userId);
  const leftBefore = await codesLeft(userId);
  const recoveryTwice = await verifyAll(jarF2, [recoveryCodes[2], recoveryCodes[2]]);
  check(
    'the same recovery code in two parallel requests → exactly one success, one code used',
    recoveryTwice.filter((a) => a === 'ok').length === 1 &&
      (await codesLeft(userId)) === leftBefore - 1,
    tally(recoveryTwice),
  );

  // --- G. what does not count --------------------------------------------------------------
  await clearLimits();
  const jarG: Jar = new Map();
  await challengeIn(jarG, userId);
  const fourWrong: string[] = [];
  for (const c of wrongCodes(secret, 4)) fourWrong.push(...(await verifyAll(jarG, [c])));
  const afterFour = await verifyAll(jarG, [recoveryCodes[3]]);
  check(
    'four failures, then a correct code still works; the success is not counted (4 hits left)',
    fourWrong.every((a) => a === 'invalid_code') &&
      afterFour[0] === 'ok' &&
      (await hitsIn(userKey(userId))) === 4 &&
      (await hitsIn(`user:${userId}|day`)) === 4,
    `${tally(fourWrong)} then ${afterFour[0]}`,
  );
  await clearLimits();
  await freshStep(userId);
  const jarU: Jar = new Map();
  const unreadableChallenge = await challengeIn(jarU, userId);
  process.env.CMS_MFA_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const unreadable: string[] = [];
  // One after the other: parallel tries would hold the five slots while in flight.
  for (let i = 0; i < 7; i += 1) {
    unreadable.push(...(await verifyAll(jarU, [hotp(secret, totpStep(Date.now()))])));
  }
  delete process.env.CMS_MFA_ENCRYPTION_KEY;
  const [slots] = await db
    .select({ failed: cmsMfaChallenges.failedAttempts })
    .from(cmsMfaChallenges)
    .where(eq(cmsMfaChallenges.id, unreadableChallenge.id));
  check(
    'an unreadable factor (other key), 7 tries: nothing counted, the challenge intact',
    unreadable.every((a) => a === 'unreadable') &&
      (await hitsIn(userKey(userId))) === 0 &&
      (await hitsIn(`user:${userId}|day`)) === 0 &&
      slots?.failed === 0,
    tally(unreadable),
  );

  // --- H. a new password ends an earlier challenge ------------------------------------------
  await clearLimits();
  const jarOwner: Jar = new Map();
  await signIn(jarOwner);
  const owner = await inBrowser(jarOwner, () => flow.challengeVerify(recoveryCodes[4], CTX));
  if (!owner.ok) throw new Error(`sign-in failed: ${owner.message}`);
  const codesBeforeStale = await codesLeft(userId);
  const jarStale: Jar = new Map();
  await signIn(jarStale);
  const staleToken = jarStale.get('cms_mfa') ?? '';
  const changed = await inBrowser(jarOwner, () =>
    auth.changePassword({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }),
  );
  const afterChange = await inBrowser(jarStale, () =>
    outcome(() => flow.challengeVerify(recoveryCodes[5], CTX)),
  );
  check(
    'password change: a sign-in challenge from before it can no longer finish',
    changed.ok && afterChange === 'expired' && (await resolveMfaChallenge(db, staleToken)) === null,
    `${changed.ok ? 'changed' : changed.message}; verify afterwards: ${afterChange}`,
  );
  const jarStale2: Jar = new Map();
  await signIn(jarStale2, EMAIL, NEW_PASSWORD);
  const staleToken2 = jarStale2.get('cms_mfa') ?? '';
  // Test-only: the self-test admin, signed in with a fresh step-up.
  const acting = await createSession(db, admin.id, CTX, {
    mfaVerified: true,
    reauthenticated: true,
  });
  const reset = await inBrowser(new Map([['cms_session', acting.token]]), () =>
    users.resetUserPassword(userId),
  );
  const afterReset = await inBrowser(jarStale2, () =>
    outcome(() => flow.challengeVerify(recoveryCodes[6], CTX)),
  );
  check(
    "an admin's password reset: a sign-in challenge from before it can no longer finish",
    reset.ok && afterReset === 'expired' && (await resolveMfaChallenge(db, staleToken2)) === null,
    `${reset.ok ? 'reset' : reset.message}; verify afterwards: ${afterReset}`,
  );
  check(
    'neither stale challenge used a recovery code',
    (await codesLeft(userId)) === codesBeforeStale,
    `${await codesLeft(userId)} left`,
  );

  await db.delete(cmsSessions).where(eq(cmsSessions.id, acting.id));
  for (const id of [userId, enrolId, ...others])
    await db.delete(cmsUsers).where(eq(cmsUsers.id, id));
  await clearLimits();
  uninstallJars();
  cookieJar.clear();
}
