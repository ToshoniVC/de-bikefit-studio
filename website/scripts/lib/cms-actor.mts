/**
 * Which admin the CMS CLIs (`cms:seed`, `cms:rollout-aanbod`,
 * `cms:patch-booking-cta`) act as when they write through the real repo with a
 * short-lived session: the oldest active admin who has chosen their own
 * password.
 *
 * A user whose password is still temporary (`must_change_password`, e.g. the
 * admin `cms:bootstrap` creates) cannot act: the auth guard refuses such a
 * session everywhere except the password change itself
 * (`src/lib/cms/guard.ts`). When every active admin is in that state this
 * throws and says what to do, instead of failing halfway through a run.
 *
 * Returns `null` when there is no active admin at all; each CLI words that
 * case itself. Read-only, so it is safe in a dry run. Type-only imports, so
 * it may be imported before the request-context stubs are installed.
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

  const [actor] = await db
    .select({ id: cmsUsers.id, email: cmsUsers.email })
    .from(cmsUsers)
    .where(orm.and(activeAdmin, orm.eq(cmsUsers.mustChangePassword, false)))
    .orderBy(orm.asc(cmsUsers.createdAt))
    .limit(1);
  if (actor) return actor;

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
