/**
 * Core of `npm run cms:mfa-reset` (the break-glass CLI), apart from argument
 * parsing so the self-test can drive it on its own PGlite (section 5c).
 * Dry run unless `apply`. Prints counts and the e-mail address only, never a
 * secret. Request-scope free: no cookies, no session for the operator; the
 * audit entry has no actor and says `via: 'cli'`.
 */
import type { CmsDatabase } from '@/db/cms';

export type MfaResetCounts = {
  authenticators: number;
  recoveryCodes: number;
  challenges: number;
  sessions: number;
};

export async function runMfaReset(input: {
  db: CmsDatabase;
  email: string;
  apply: boolean;
  /**
   * Optional new TEMPORARY password (`CMS_BREAK_GLASS_PASSWORD`, passed inline).
   * Recommended: then only the person it is handed to can enrol next, not
   * whoever else may know the old password. Never printed.
   */
  temporaryPassword?: string;
  log: (symbol: string, message: string) => void;
}): Promise<MfaResetCounts> {
  const { db, apply, log } = input;
  const email = input.email.trim().toLowerCase();
  const { and, eq, isNotNull, sql } = await import('drizzle-orm');
  const { cmsUsers, cmsSessions } = await import('@/db/cms-schema');
  const { cmsMfaChallenges, cmsMfaFactors, cmsMfaRecoveryCodes } =
    await import('@/db/cms-mfa-schema');
  const { clearMfaAttempts, removeAllFactors } = await import('@/lib/cms/mfa/repo');
  const { hashPassword, validatePasswordStrength } = await import('@/lib/cms/password');
  const { deleteUserMfaChallenges } = await import('@/lib/cms/mfa/challenge');
  const { revokeAllUserSessions } = await import('@/lib/cms/session');
  const { recordAudit } = await import('@/lib/cms/auth');

  const [user] = await db
    .select({ id: cmsUsers.id, email: cmsUsers.email, role: cmsUsers.role })
    .from(cmsUsers)
    .where(eq(cmsUsers.email, email))
    .limit(1);
  if (!user) throw new Error(`no CMS user with e-mail ${email}`);
  if (input.temporaryPassword !== undefined) {
    const weak = validatePasswordStrength(input.temporaryPassword);
    if (weak) throw new Error(`CMS_BREAK_GLASS_PASSWORD is too weak: ${weak}`);
  }

  const n = sql<number>`count(*)::int`;
  const first = (rows: Array<{ n: number }>) => Number(rows[0]?.n ?? 0);
  const counts: MfaResetCounts = {
    authenticators: first(
      await db
        .select({ n })
        .from(cmsMfaFactors)
        .where(and(eq(cmsMfaFactors.userId, user.id), isNotNull(cmsMfaFactors.confirmedAt))),
    ),
    recoveryCodes: first(
      await db
        .select({ n })
        .from(cmsMfaRecoveryCodes)
        .where(eq(cmsMfaRecoveryCodes.userId, user.id)),
    ),
    challenges: first(
      await db.select({ n }).from(cmsMfaChallenges).where(eq(cmsMfaChallenges.userId, user.id)),
    ),
    sessions: first(
      await db.select({ n }).from(cmsSessions).where(eq(cmsSessions.userId, user.id)),
    ),
  };
  log(
    '=',
    `${user.email} (${user.role}): ${counts.authenticators} authenticator(s), ` +
      `${counts.recoveryCodes} recovery code(s), ${counts.challenges} challenge(s), ` +
      `${counts.sessions} session(s)`,
  );
  if (!apply) {
    log('=', 'dry run: nothing changed. Add --apply (and --expect-host for Neon) to reset.');
    return counts;
  }

  // Password and sessions first, factors last (never factor-less with the old password).
  if (input.temporaryPassword !== undefined) {
    await db
      .update(cmsUsers)
      .set({
        passwordHash: await hashPassword(input.temporaryPassword),
        mustChangePassword: true,
        updatedAt: new Date(),
      })
      .where(eq(cmsUsers.id, user.id));
  }
  await revokeAllUserSessions(db, user.id);
  await deleteUserMfaChallenges(db, user.id);
  await removeAllFactors(db, user.id);
  await clearMfaAttempts(db, user.id);
  await recordAudit(db, null, {
    action: 'auth.mfa_break_glass',
    entityType: 'cms_user',
    entityId: user.id,
    summary: user.email,
    metadata: { via: 'cli', temporaryPassword: input.temporaryPassword !== undefined },
  });
  log('✓', `two-step verification removed and every session revoked for ${user.email}`);
  log(
    input.temporaryPassword !== undefined ? '✓' : '!',
    input.temporaryPassword !== undefined
      ? 'password replaced by the temporary one you passed (must be changed at sign-in)'
      : 'password NOT changed: whoever knows it can enrol next. Prefer CMS_BREAK_GLASS_PASSWORD.',
  );
  return counts;
}
