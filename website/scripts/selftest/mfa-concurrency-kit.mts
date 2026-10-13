/**
 * Shared set-up for self-test section 5f (`./mfa-concurrency.mts`): simulated
 * browsers, the spy that counts TOTP checks, the modules under test (loaded
 * lazily, after the request-context stubs) and small helpers. "Test-only"
 * helpers are marked; everything else is the production code path.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import nodeCrypto from 'node:crypto';
import nodeModule from 'node:module';
import type { CmsDatabase } from '@/db/cms';

export type Jar = Map<string, string>;

export const EMAIL = 'parallel-beheerder@selftest.local';
export const ENROL_EMAIL = 'parallel-nieuw@selftest.local';
export const PASSWORD = 'Parallel-Beheerder-2026';
export const NEW_PASSWORD = 'Parallel-Nieuw-Wachtwoord-2026';
export const IP = '10.60.0.1';
export const CTX = { ipAddress: IP, userAgent: 'selftest-mfa-concurrency' };

/**
 * One cookie jar per simulated browser: `cms-selftest.mts`'s `next/headers`
 * stub reads `__bikefitSelftestCookieScope` first. Returns the uninstaller.
 */
const browsers = new AsyncLocalStorage<Jar>();
export const inBrowser = <T,>(jar: Jar, run: () => Promise<T>) => browsers.run(jar, run);
export function installBrowserJars(): () => void {
  const scope = globalThis as unknown as { __bikefitSelftestCookieScope?: AsyncLocalStorage<Jar> };
  scope.__bikefitSelftestCookieScope = browsers;
  return () => {
    delete scope.__bikefitSelftestCookieScope;
  };
}

/**
 * Test-only spy: the TOTP checks that ran between the call and `stop()`. A
 * check computes 2·window + 1 HMAC-SHA1 values (`verifyTotp` in totp.ts) and
 * nothing else on these paths uses SHA-1 (tokens are HMAC-SHA256, recovery
 * codes SHA-256), so counting `crypto.createHmac('sha1')` counts checks.
 * `syncBuiltinESMExports` makes ES-module importers see the replacement too.
 */
export function countTotpChecks(window: number): () => number {
  const target = nodeCrypto as unknown as { createHmac: typeof nodeCrypto.createHmac };
  const original = target.createHmac;
  let hmacs = 0;
  target.createHmac = (...args: Parameters<typeof original>) => {
    if (args[0] === 'sha1') hmacs += 1;
    return original(...args);
  };
  nodeModule.syncBuiltinESMExports();
  return () => {
    target.createHmac = original;
    nodeModule.syncBuiltinESMExports();
    return hmacs / (2 * window + 1);
  };
}

export const tally = (answers: string[]) =>
  [...new Set(answers)].map((a) => `${a}×${answers.filter((b) => b === a).length}`).join(', ');

export async function loadConcurrencyKit(db: CmsDatabase) {
  const { and, eq, sql } = await import('drizzle-orm');
  const { cmsAuditLog, cmsLoginAttempts, cmsSessions, cmsUsers } = await import('@/db/cms-schema');
  const { cmsMfaChallenges, cmsMfaFactors, cmsMfaRateLimits, cmsMfaRecoveryCodes } =
    await import('@/db/cms-mfa-schema');
  const auth = await import('@/lib/cms/auth');
  const users = await import('@/lib/cms/users');
  const flow = await import('@/lib/cms/mfa/flow');
  const manage = await import('@/lib/cms/mfa/manage');
  const { confirmIdentity } = await import('@/lib/cms/mfa/reauth');
  const { createMfaChallenge, resolveMfaChallenge } = await import('@/lib/cms/mfa/challenge');
  const { releaseMfaAttempt, reserveMfaAttempt } = await import('@/lib/cms/mfa/rate-limit');
  const { base32Decode, hotp, totpStep, TOTP_WINDOW } = await import('@/lib/cms/mfa/totp');
  const { hashPassword } = await import('@/lib/cms/password');
  const { createSession } = await import('@/lib/cms/session');

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
  const n = sql<number>`count(*)::int`;
  const audits = async (action: string, userId: string) =>
    Number(
      (
        await db
          .select({ n })
          .from(cmsAuditLog)
          .where(and(eq(cmsAuditLog.action, action), eq(cmsAuditLog.entityId, userId)))
      )[0]?.n ?? 0,
    );
  const hitsIn = async (key: string) =>
    Number(
      (
        await db
          .select({ n: sql<number>`cardinality(${cmsMfaRateLimits.hits})` })
          .from(cmsMfaRateLimits)
          .where(eq(cmsMfaRateLimits.scope, key))
      )[0]?.n ?? 0,
    );
  const sessionsOf = async (userId: string) =>
    Number((await db.select({ n }).from(cmsSessions).where(eq(cmsSessions.userId, userId)))[0]?.n);
  const challengesOf = async (userId: string) =>
    Number(
      (await db.select({ n }).from(cmsMfaChallenges).where(eq(cmsMfaChallenges.userId, userId)))[0]
        ?.n,
    );
  const codesLeft = async (userId: string) =>
    Number(
      (
        await db
          .select({ n })
          .from(cmsMfaRecoveryCodes)
          .where(
            and(eq(cmsMfaRecoveryCodes.userId, userId), sql`${cmsMfaRecoveryCodes.usedAt} is null`),
          )
      )[0]?.n ?? 0,
    );
  /** Test-only: stands for the 15-minute windows passing. */
  const clearLimits = async () => {
    await db.delete(cmsMfaRateLimits);
    await db.delete(cmsLoginAttempts);
  };
  /** Test-only: stands for the next 30-second step (each step's code works once). */
  const freshStep = (userId: string) =>
    db
      .update(cmsMfaFactors)
      .set({ lastUsedStep: totpStep(Date.now()) - 2 })
      .where(eq(cmsMfaFactors.userId, userId));
  const secretOf = (uri: string) => base32Decode(new URL(uri).searchParams.get('secret') ?? '')!;
  /** Six-digit codes that match no step near now. Computed before a spy starts. */
  const wrongCodes = (secret: Buffer, count: number) => {
    const now = totpStep(Date.now());
    const near = new Set([-2, -1, 0, 1, 2].map((d) => hotp(secret, now + d)));
    const codes: string[] = [];
    for (let i = 0; codes.length < count; i += 1) {
      const code = hotp(secret, now + 1000 + i);
      if (!near.has(code)) codes.push(code);
    }
    return codes;
  };
  const signIn = (jar: Jar, email = EMAIL, password = PASSWORD) =>
    inBrowser(jar, () => auth.login({ email, password, context: CTX }));
  /** Test-only shortcut for a password sign-in: the challenge `login()` creates. */
  const challengeIn = async (jar: Jar, userId: string) => {
    const created = await createMfaChallenge(db, userId, CTX);
    jar.set('cms_mfa', created.token);
    return created;
  };
  const verifyAll = (jar: Jar, codes: string[]) =>
    inBrowser(jar, () =>
      Promise.all(codes.map((c) => outcome(() => flow.challengeVerify(c, CTX)))),
    );
  const newUser = async (email: string, role: 'admin' | 'editor', passwordHash: string) => {
    await db.delete(cmsUsers).where(eq(cmsUsers.email, email));
    const [row] = await db
      .insert(cmsUsers)
      .values({ email, name: 'Parallel', role, passwordHash, mustChangePassword: false })
      .returning({ id: cmsUsers.id });
    return row.id;
  };
  const userKey = (userId: string, ip = IP) => `user:${userId}|ip:${ip}`;

  return {
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
  };
}

export type ConcurrencyKit = Awaited<ReturnType<typeof loadConcurrencyKit>>;
