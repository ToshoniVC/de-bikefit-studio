/**
 * Which admin the CMS CLIs (`cms:seed`, `cms:rollout-aanbod`,
 * `cms:patch-booking-cta`, `cms:patch-page-cleanup`, `cms:migrate-aanbod`)
 * act as when they write through the real repo with a short-lived session:
 * the oldest active admin who has chosen their own password AND enrolled
 * two-step verification.
 *
 * Those are the admins who could do the same in the browser. A user whose
 * password is still temporary (`must_change_password`, e.g. the admin
 * `cms:bootstrap` creates) or an admin without an authenticator cannot act
 * there, so the CLIs do not act as them either. When no admin qualifies this
 * throws and says what to do, instead of failing halfway through a run.
 *
 * The CLI session itself is created with `mfaVerified` (`withAdminSession`,
 * `cms-seed.mts`): the operator's database credentials are the
 * authentication, the second factor cannot be typed into a batch job.
 *
 * Returns `null` when there is no active admin at all; each CLI words that
 * case itself. Read-only, so it is safe in a dry run. Type-only imports at
 * the top (the MFA table is imported lazily, it has no request-scope
 * dependency), so it may be imported before the request-context stubs are
 * installed.
 */
import type { CmsDatabase } from '@/db/cms';

export type CmsActor = { id: string; email: string };

export async function findActingAdmin(deps: {
  db: CmsDatabase;
  orm: typeof import('drizzle-orm');
  schema: typeof import('@/db/cms-schema');
}): Promise<CmsActor | null> {
  const { db, orm, schema } = deps;
  const { cmsUsers } = schema;
  const activeAdmin = orm.and(orm.eq(cmsUsers.role, 'admin'), orm.eq(cmsUsers.isActive, true));

  const { cmsMfaFactors } = await import('@/db/cms-mfa-schema');
  const enrolled = orm.exists(
    db
      .select({ id: cmsMfaFactors.id })
      .from(cmsMfaFactors)
      .where(
        orm.and(
          orm.eq(cmsMfaFactors.userId, cmsUsers.id),
          orm.isNotNull(cmsMfaFactors.confirmedAt),
        ),
      ),
  );
  const ownPassword = orm.and(activeAdmin, orm.eq(cmsUsers.mustChangePassword, false));

  const [actor] = await db
    .select({ id: cmsUsers.id, email: cmsUsers.email })
    .from(cmsUsers)
    .where(orm.and(ownPassword, enrolled))
    .orderBy(orm.asc(cmsUsers.createdAt))
    .limit(1);
  if (actor) return actor;

  const [unenrolled] = await db
    .select({ email: cmsUsers.email })
    .from(cmsUsers)
    .where(ownPassword)
    .orderBy(orm.asc(cmsUsers.createdAt))
    .limit(1);
  if (unenrolled) {
    throw new Error(
      `no active admin has two-step verification yet (oldest: ${unenrolled.email}). ` +
        'Sign in at /admin, set up the authenticator, then run this again: an admin without ' +
        'it may do nothing else (docs/cms-architecture.md §4).',
    );
  }

  const [waiting] = await db
    .select({ email: cmsUsers.email })
    .from(cmsUsers)
    .where(activeAdmin)
    .orderBy(orm.asc(cmsUsers.createdAt))
    .limit(1);
  if (!waiting) return null;

  throw new Error(
    `every active admin still has a temporary password (oldest: ${waiting.email}). ` +
      'Sign in at /admin, choose a new password, then run this again: a session with a ' +
      'temporary password may do nothing else (docs/cms-architecture.md §4).',
  );
}
