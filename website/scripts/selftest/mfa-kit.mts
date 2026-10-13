/**
 * Shared set-up for self-test section 5c (`./mfa.mts`, `./mfa-manage.mts`):
 * the modules under test, loaded lazily after the request-context stubs, and
 * small helpers. "Test-only" helpers are marked.
 */
import type { CmsDatabase } from '@/db/cms';

export type Check = (label: string, condition: boolean, detail?: string) => void;
export type Call = [label: string, call: () => Promise<unknown>];

export const CTX = { ipAddress: '10.20.0.1', userAgent: 'selftest-mfa' };

export type MfaSectionContext = {
  db: CmsDatabase;
  admin: { id: string; email: string };
  /** The admin's own (permanent) password, set in section 5b. */
  password: string;
  check: Check;
  section: (title: string) => void;
  cookieJar: Map<string, string>;
};

export async function loadMfaKit(ctx: MfaSectionContext) {
  const { db, admin, cookieJar } = ctx;
  const orm = await import('drizzle-orm');
  const { and, eq, isNull, sql } = orm;
  const schema = await import('@/db/cms-schema');
  const { cmsAuditLog, cmsLoginAttempts, cmsPages, cmsSessions, cmsUsers } = schema;
  const { cmsMfaChallenges, cmsMfaFactors, cmsMfaRateLimits, cmsMfaRecoveryCodes } =
    await import('@/db/cms-mfa-schema');
  const auth = await import('@/lib/cms/auth');
  const users = await import('@/lib/cms/users');
  const flow = await import('@/lib/cms/mfa/flow');
  const manage = await import('@/lib/cms/mfa/manage');
  const repo = await import('@/lib/cms/mfa/repo');
  const rateLimit = await import('@/lib/cms/mfa/rate-limit');
  const { openTotpSecret } = await import('@/lib/cms/mfa/crypto');
  const { base32Decode, base32Encode, hotp, totpStep } = await import('@/lib/cms/mfa/totp');
  const { resolveSession, createSession } = await import('@/lib/cms/session');
  const { hashSessionToken } = await import('@/lib/cms/session');
  const { hashChallengeToken } = await import('@/lib/cms/mfa/challenge');
  const cmsRepo = await import('@/lib/cms/repo');
  const bookingRepo = await import('@/lib/booking/repo');
  const { canPreview } = await import('@/lib/cms/actions/preview');
  const { findActingAdmin } = await import('../lib/cms-actor.mjs');
  const { runMfaReset } = await import('../lib/mfa-reset.mjs');

  // --- helpers ---------------------------------------------------------------
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
  /**
   * Test-only: stands for the 15-minute rate-limit windows passing (section 4
   * deliberately rate-limited this admin's e-mail for password sign-in).
   */
  const clearAttempts = async () => {
    await db.delete(cmsMfaRateLimits);
    await db.delete(cmsLoginAttempts);
  };
  /** Whether a code check for this user from this IP would be refused now (nothing is kept). */
  const limited = async (userId: string, ip: string): Promise<boolean> => {
    const reserved = await rateLimit.reserveMfaAttempt(db, userId, ip);
    if (reserved.ok) await rateLimit.releaseMfaAttempt(db, reserved.reservation);
    return !reserved.ok;
  };
  /** One failed check per IP, kept, at `nowMs` (the production reservation, minus the code). */
  const failFrom = async (userId: string, ips: string[], nowMs = Date.now()) => {
    for (const ip of ips) {
      const reserved = await rateLimit.reserveMfaAttempt(db, userId, ip, nowMs);
      if (!reserved.ok) throw new Error(`reservation for ${ip} refused`);
    }
  };
  const secretOf = (uri: string) => base32Decode(new URL(uri).searchParams.get('secret') ?? '')!;
  const codeAt = (secret: Buffer, offset = 0) => hotp(secret, totpStep(Date.now()) + offset);
  const count = async (table: 'sessions' | 'challenges' | 'factors' | 'codes', userId: string) => {
    const n = sql<number>`count(*)::int`;
    const rows =
      table === 'sessions'
        ? await db.select({ n }).from(cmsSessions).where(eq(cmsSessions.userId, userId))
        : table === 'challenges'
          ? await db.select({ n }).from(cmsMfaChallenges).where(eq(cmsMfaChallenges.userId, userId))
          : table === 'factors'
            ? await db.select({ n }).from(cmsMfaFactors).where(eq(cmsMfaFactors.userId, userId))
            : await db
                .select({ n })
                .from(cmsMfaRecoveryCodes)
                .where(
                  and(eq(cmsMfaRecoveryCodes.userId, userId), isNull(cmsMfaRecoveryCodes.usedAt)),
                );
    return Number(rows[0]?.n ?? 0);
  };
  const audited = async (action: string, userId: string | null = admin.id) => {
    const rows = await db
      .select({ id: cmsAuditLog.id, userId: cmsAuditLog.userId, metadata: cmsAuditLog.metadata })
      .from(cmsAuditLog)
      .where(and(eq(cmsAuditLog.action, action), eq(cmsAuditLog.entityId, userId ?? admin.id)));
    return rows;
  };
  const signInWithPassword = async (email: string, secretPassword: string) => {
    cookieJar.clear();
    return auth.login({ email, password: secretPassword, context: CTX });
  };
  const sessionUser = async () => {
    const token = cookieJar.get('cms_session');
    return token ? resolveSession(db, token) : null;
  };

  return {
    ...ctx,
    orm,
    and,
    eq,
    isNull,
    sql,
    schema,
    cmsAuditLog,
    cmsLoginAttempts,
    cmsPages,
    cmsSessions,
    cmsUsers,
    cmsMfaChallenges,
    cmsMfaFactors,
    cmsMfaRateLimits,
    cmsMfaRecoveryCodes,
    auth,
    users,
    flow,
    manage,
    repo,
    rateLimit,
    openTotpSecret,
    base32Decode,
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
    runMfaReset,
    outcome,
    clearAttempts,
    limited,
    failFrom,
    secretOf,
    codeAt,
    count,
    audited,
    signInWithPassword,
    sessionUser,
  };
}

export type MfaKit = Awaited<ReturnType<typeof loadMfaKit>>;
