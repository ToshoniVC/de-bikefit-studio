/**
 * Self-test section 5e: admin session limits and step-up re-authentication
 * (`src/lib/cms/session-policy.ts`, `src/lib/cms/mfa/reauth.ts`), on the
 * throwaway PGlite of `cms-selftest.mts`, after section 5c left the admin
 * enrolled and signed out.
 *
 *  A. migration 0006: both columns nullable timestamptz, additive, re-runnable;
 *  B. lifetime on the real rows: 15-minute idle end (row deleted), 8-hour
 *     absolute end however active, expiry never slid past it, admin cookie at
 *     the absolute end, pre-0006 rows capped at created_at + 8 h, concurrent
 *     use harmless; editor sessions unchanged (14 days, no absolute end);
 *  C. step-up: user management and an admin's own password change refused
 *     without a recent full authentication — calling the library directly,
 *     as a forged server-action POST would — and nothing written; wrong
 *     password or code refused and audited; a correct one opens a 5-minute
 *     window on THIS session only; a back-dated window is refused again;
 *     the password change keeps the absolute end and the step-up time.
 *
 * Time is moved by passing `now` to `resolveSession()` or by back-dating
 * columns ("test-only" below), never by sleeping.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CmsDatabase } from '@/db/cms';

type Check = (label: string, condition: boolean, detail?: string) => void;

const CTX = { ipAddress: '10.20.0.5', userAgent: 'selftest-session-limits' };
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const STEP_UP_USER = 'stepup@selftest.local';
const EDITOR_EMAIL = 'sessie-redacteur@selftest.local';
const TEMPORARY_ADMIN_PASSWORD = 'Tussenstap-Wachtwoord-2026';

export async function sessionLimitsSection(ctx: {
  db: CmsDatabase;
  admin: { id: string; email: string };
  password: string;
  check: Check;
  section: (title: string) => void;
  cookieJar: Map<string, string>;
}) {
  const { db, admin, password, check, section, cookieJar } = ctx;
  section('5e. admin session limits (15 min idle, 8 h absolute) and step-up');

  const { and, eq, sql } = await import('drizzle-orm');
  const { cmsAuditLog, cmsLoginAttempts, cmsSessions, cmsUsers } = await import('@/db/cms-schema');
  const { cmsMfaRateLimits } = await import('@/db/cms-mfa-schema');
  const auth = await import('@/lib/cms/auth');
  const users = await import('@/lib/cms/users');
  const { confirmIdentity } = await import('@/lib/cms/mfa/reauth');
  const repo = await import('@/lib/cms/mfa/repo');
  const { createSession, resolveSession } = await import('@/lib/cms/session');
  const { hashPassword } = await import('@/lib/cms/password');

  const outcome = async (call: () => Promise<unknown>): Promise<string> => {
    try {
      const value = (await call()) as { ok?: boolean; error?: string } | undefined;
      if (value && typeof value === 'object' && value.ok === false) return value.error ?? 'error';
      return 'ok';
    } catch (error) {
      if (error instanceof auth.CmsAuthError) return error.code;
      return `other: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
  const sessionRow = async (id: string) =>
    (await db.select().from(cmsSessions).where(eq(cmsSessions.id, id)).limit(1))[0] ?? null;
  const userRow = async (email: string) =>
    (await db.select().from(cmsUsers).where(eq(cmsUsers.email, email)).limit(1))[0] ?? null;
  const audits = async (action: string) =>
    db
      .select({ id: cmsAuditLog.id })
      .from(cmsAuditLog)
      .where(and(eq(cmsAuditLog.action, action), eq(cmsAuditLog.entityId, admin.id)));
  /** Test-only: stands for the 15-minute rate-limit windows passing. */
  const clearAttempts = async () => {
    await db.delete(cmsMfaRateLimits);
    await db.delete(cmsLoginAttempts);
  };
  const near = (a: Date | null | undefined, b: number, slackMs = 5_000) =>
    !!a && Math.abs(a.getTime() - b) <= slackMs;

  // --- A. migration 0006 ---------------------------------------------------------------
  const columns = await db.execute(
    sql`select column_name, data_type, is_nullable from information_schema.columns
        where table_name = 'cms_sessions'
          and column_name in ('absolute_expires_at', 'reauthenticated_at')`,
  );
  const columnRows = (columns as unknown as { rows: Array<Record<string, string>> }).rows;
  check(
    'migration 0006: absolute_expires_at and reauthenticated_at are nullable timestamptz',
    columnRows.length === 2 &&
      columnRows.every(
        (row) => row.data_type === 'timestamp with time zone' && row.is_nullable === 'YES',
      ),
    JSON.stringify(columnRows),
  );
  const migrationSql = await readFile(
    resolve(process.cwd(), 'drizzle/0006_cms_session_limits.sql'),
    'utf8',
  );
  check(
    'migration 0006: additive only (no DROP, no TRUNCATE, no DELETE, no UPDATE)',
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
  check('migration 0006: re-running it twice is a no-op', rerun === 'ok', rerun);

  // --- B. lifetime on real rows ----------------------------------------------------------
  const first = await createSession(db, admin.id, CTX, { mfaVerified: true });
  const firstRow = await sessionRow(first.id);
  const t0 = firstRow!.createdAt.getTime();
  check(
    'admin session: expires 15 min after sign-in, absolute end 8 h, cookie at the absolute end',
    near(firstRow?.expiresAt, t0 + 15 * MIN) &&
      near(firstRow?.absoluteExpiresAt, t0 + 8 * HOUR) &&
      first.cookieExpiresAt.getTime() === firstRow?.absoluteExpiresAt?.getTime(),
  );
  const tenMinutes = await resolveSession(db, first.token, new Date(t0 + 10 * MIN));
  const touched = await sessionRow(first.id);
  check(
    'admin session: a request after 10 min is accepted and moves the expiry to +15 min',
    tenMinutes !== null &&
      touched?.lastUsedAt.getTime() === t0 + 10 * MIN &&
      touched?.expiresAt.getTime() === t0 + 25 * MIN,
  );
  check(
    'admin session: 16 min without a request ends it, and the row is deleted',
    (await resolveSession(db, first.token, new Date(t0 + 26 * MIN))) === null &&
      (await sessionRow(first.id)) === null,
  );

  const active = await createSession(db, admin.id, CTX, { mfaVerified: true });
  const ta = (await sessionRow(active.id))!.createdAt.getTime();
  const absoluteEnd = (await sessionRow(active.id))!.absoluteExpiresAt!.getTime();
  let refusedAt: number | null = null;
  let neverPastEnd = true;
  for (let t = ta + 10 * MIN; t <= ta + 9 * HOUR; t += 10 * MIN) {
    const resolved = await resolveSession(db, active.token, new Date(t));
    if (!resolved) {
      refusedAt = t;
      break;
    }
    const row = await sessionRow(active.id);
    if (!row || row.expiresAt.getTime() > absoluteEnd) neverPastEnd = false;
  }
  check(
    'admin session: active every 10 min, it still ends at the 8-hour absolute end',
    refusedAt !== null && refusedAt >= absoluteEnd && refusedAt < absoluteEnd + 10 * MIN,
    refusedAt ? `${((refusedAt - ta) / HOUR).toFixed(2)} h` : 'never refused',
  );
  check('admin session: the expiry never slid past the absolute end', neverPastEnd);

  const legacy = await createSession(db, admin.id, CTX, { mfaVerified: true });
  // Test-only: a row from before 0006 (no absolute end, 14-day expiry), signed in 8 h ago.
  await db
    .update(cmsSessions)
    .set({
      absoluteExpiresAt: null,
      createdAt: new Date(Date.now() - 8 * HOUR - MIN),
      expiresAt: new Date(Date.now() + 14 * 24 * HOUR),
    })
    .where(eq(cmsSessions.id, legacy.id));
  check(
    'pre-0006 admin row: capped at created_at + 8 h even with a 14-day expiry',
    (await resolveSession(db, legacy.token)) === null && (await sessionRow(legacy.id)) === null,
  );

  const busy = await createSession(db, admin.id, CTX, { mfaVerified: true });
  const tb = (await sessionRow(busy.id))!.createdAt.getTime();
  const at = new Date(tb + 5 * MIN);
  const parallel = await Promise.all(
    Array.from({ length: 5 }, () => resolveSession(db, busy.token, at)),
  );
  const afterParallel = await sessionRow(busy.id);
  check(
    'concurrent requests: all accepted, last use recorded once at that time',
    parallel.every((value) => value !== null) &&
      afterParallel?.lastUsedAt.getTime() === at.getTime(),
  );
  const earlier = await resolveSession(db, busy.token, new Date(tb + 4 * MIN));
  check(
    'a late, older request never moves last use backwards',
    earlier !== null && (await sessionRow(busy.id))?.lastUsedAt.getTime() === at.getTime(),
  );

  await db.insert(cmsUsers).values({
    email: EDITOR_EMAIL,
    name: 'Sessie-redacteur',
    role: 'editor',
    passwordHash: await hashPassword('Redacteur-Sessie-2026'),
    mustChangePassword: false,
    isActive: true,
  });
  const editor = (await userRow(EDITOR_EMAIL))!;
  const editorSession = await createSession(db, editor.id, CTX);
  const editorRow = await sessionRow(editorSession.id);
  const te = editorRow!.createdAt.getTime();
  const threeDays = await resolveSession(db, editorSession.token, new Date(te + 3 * 24 * HOUR));
  check(
    'editor session unchanged: 14 days, no absolute end, valid after 3 idle days',
    near(editorRow?.expiresAt, te + 14 * 24 * HOUR) &&
      editorRow?.absoluteExpiresAt === null &&
      editorSession.cookieExpiresAt.getTime() === editorRow?.expiresAt.getTime() &&
      threeDays !== null,
  );
  await db.delete(cmsUsers).where(eq(cmsUsers.id, editor.id));

  // --- C. step-up ------------------------------------------------------------------------
  await clearAttempts();
  const codes = await repo.replaceRecoveryCodes(db, admin.id);
  // An admin session that passed MFA but whose sign-in is longer than 5 min ago.
  const stale = await createSession(db, admin.id, CTX, { mfaVerified: true });
  const otherDevice = await createSession(db, admin.id, CTX, { mfaVerified: true });
  cookieJar.clear();
  cookieJar.set('cms_session', stale.token);

  const usersBefore = (await db.select({ id: cmsUsers.id }).from(cmsUsers)).length;
  const hashBefore = (await userRow(admin.email))!.passwordHash;
  const bypass: Array<[string, () => Promise<unknown>]> = [
    ['createUser()', () => users.createUser({ email: STEP_UP_USER, name: 'Stap', role: 'admin' })],
    ['setUserRole()', () => users.setUserRole(admin.id, 'admin')],
    ['setUserActive()', () => users.setUserActive(admin.id, true)],
    ['resetUserPassword()', () => users.resetUserPassword(admin.id)],
    [
      'changePassword()',
      () =>
        auth.changePassword({ currentPassword: password, newPassword: TEMPORARY_ADMIN_PASSWORD }),
    ],
  ];
  for (const [label, call] of bypass) {
    check(
      `no step-up: ${label} refused (reauth_required)`,
      (await outcome(call)) === 'reauth_required',
    );
  }
  check(
    'no step-up: nothing was written (users, password, sessions)',
    (await db.select({ id: cmsUsers.id }).from(cmsUsers)).length === usersBefore &&
      (await userRow(admin.email))?.passwordHash === hashBefore &&
      (await sessionRow(stale.id)) !== null &&
      (await sessionRow(otherDevice.id)) !== null,
  );
  check(
    'plain admin reads still work without a step-up',
    (await outcome(() => users.listCmsUsers())) === 'ok',
  );

  const codesLeft = async () => (await repo.getMfaStatus(db, admin.id)).recoveryCodesLeft;
  const codesAtStart = await codesLeft();
  const wrongPassword = await confirmIdentity(
    { password: 'Verkeerd-Wachtwoord-2026', code: codes[0] },
    CTX,
  );
  const wrongCode = await confirmIdentity({ password, code: '000000' }, CTX);
  check(
    'step-up: a wrong password or code is refused; the wrong password burns no recovery code',
    !wrongPassword.ok &&
      wrongPassword.error === 'reauth_failed' &&
      !wrongCode.ok &&
      wrongCode.error === 'reauth_failed' &&
      (await codesLeft()) === codesAtStart &&
      (await sessionRow(stale.id))?.reauthenticatedAt === null,
  );
  check(
    'step-up: failures audited (auth.mfa_reauth_failed)',
    (await audits('auth.mfa_reauth_failed')).length >= 2,
  );
  const absoluteBeforeStepUp = (await sessionRow(stale.id))?.absoluteExpiresAt?.getTime();
  const stepped = await confirmIdentity({ password, code: codes[0] }, CTX);
  const steppedRow = await sessionRow(stale.id);
  check(
    'step-up: password + recovery code opens a 5-minute window on this session',
    stepped.ok &&
      near(steppedRow?.reauthenticatedAt, Date.now()) &&
      near(stepped.data.until, Date.now() + 5 * MIN),
    stepped.ok ? '' : stepped.message,
  );
  check(
    'step-up: audited (auth.step_up); idle and absolute ends unchanged',
    (await audits('auth.step_up')).length === 1 &&
      steppedRow?.absoluteExpiresAt?.getTime() === absoluteBeforeStepUp,
  );

  const created = await users.createUser({ email: STEP_UP_USER, name: 'Stap', role: 'editor' });
  const createdId = created.ok ? created.data.user.id : '';
  check('within the window: createUser() allowed', created.ok);
  check(
    'within the window: setUserActive() allowed',
    (await outcome(() => users.setUserActive(createdId, false))) === 'ok',
  );

  cookieJar.set('cms_session', otherDevice.token);
  check(
    "the window belongs to one session: the admin's other session is still refused",
    (await outcome(() => users.setUserActive(createdId, true))) === 'reauth_required',
  );
  cookieJar.set('cms_session', stale.token);

  // Test-only: the five minutes pass.
  await db
    .update(cmsSessions)
    .set({ reauthenticatedAt: new Date(Date.now() - 5 * MIN - 1_000) })
    .where(eq(cmsSessions.id, stale.id));
  check(
    'after 5 minutes: refused again (reauth_required)',
    (await outcome(() => users.setUserActive(createdId, true))) === 'reauth_required',
  );

  const { markSessionReauthenticated } = await import('@/lib/cms/session');
  const dead = await createSession(db, admin.id, CTX, { mfaVerified: true });
  // Test-only: the session expired a moment ago.
  await db
    .update(cmsSessions)
    .set({ expiresAt: new Date(Date.now() - 1_000) })
    .where(eq(cmsSessions.id, dead.id));
  await markSessionReauthenticated(db, dead.id);
  check(
    'a step-up is never recorded on an expired session',
    (await sessionRow(dead.id))?.reauthenticatedAt === null,
  );
  await db.delete(cmsSessions).where(eq(cmsSessions.id, dead.id));

  await clearAttempts();
  const again = await confirmIdentity({ password, code: codes[1] }, CTX);
  const stampBefore = (await sessionRow(stale.id))?.reauthenticatedAt?.getTime();
  const absoluteBefore = (await sessionRow(stale.id))?.absoluteExpiresAt?.getTime();
  const changed = await auth.changePassword({
    currentPassword: password,
    newPassword: TEMPORARY_ADMIN_PASSWORD,
  });
  const replacement = await resolveSession(db, cookieJar.get('cms_session') ?? '');
  const replacementRow = replacement ? await sessionRow(replacement.sessionId) : null;
  check(
    'with a step-up: an admin can change the password',
    again.ok && changed.ok,
    changed.ok ? '' : changed.message,
  );
  check(
    'the replacement session keeps MFA, the absolute end and the step-up time (no extension)',
    replacement?.mfaVerified === true &&
      replacementRow?.absoluteExpiresAt?.getTime() === absoluteBefore &&
      replacementRow?.reauthenticatedAt?.getTime() === stampBefore &&
      (await sessionRow(otherDevice.id)) === null,
  );
  const restored = await auth.changePassword({
    currentPassword: TEMPORARY_ADMIN_PASSWORD,
    newPassword: password,
  });
  check('password restored for the later sections', restored.ok);

  await db.delete(cmsUsers).where(eq(cmsUsers.email, STEP_UP_USER));
  await auth.logout();
  await clearAttempts();
  cookieJar.clear();
}
