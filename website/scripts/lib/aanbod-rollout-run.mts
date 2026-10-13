/**
 * Mode dispatch of `npm run cms:rollout-aanbod`, split from the CLI so the
 * self-test drives exactly the same path (section 15).
 *
 * The dry run is read-only by construction, not by convention:
 *   - it never imports the write API (`repo`, `auth`) and never creates a
 *     `cms_sessions` row or sets a session cookie;
 *   - it plans against {@link readOnlyDb}, which throws on any write method,
 *     so a future write slipped into the plan fails loudly instead of
 *     touching Staging.
 * Only `--apply` and `--restore` open a short-lived admin session (revoked in
 * `finally`) and hand the real database to the writing half.
 *
 * Call after the request-context stubs are installed (the CLI and the
 * self-test both do that); the CMS modules are imported dynamically here.
 */
import type { CmsDatabase } from '@/db/cms';
import {
  applyAanbodRollout,
  planAanbodRollout,
  planBlockers,
  planHasChanges,
  printPlan,
  readBackup,
  restoreAanbodRollout,
  type PlanDeps,
  type RolloutDeps,
} from './aanbod-rollout.mjs';
import { findActingAdmin } from './cms-actor.mjs';

export type RolloutRunOptions = {
  apply: boolean;
  restore: string | null;
  backupDir: string;
  allowDraftOverwrite: boolean;
};

export type RolloutRunContext = {
  db: CmsDatabase;
  driver: string;
  /** The cookie store the stubbed `next/headers` reads (writing modes only). */
  cookieJar: Map<string, string>;
  log: PlanDeps['log'];
};

const WRITE_METHODS = new Set([
  'insert',
  'update',
  'delete',
  'execute',
  'transaction',
  'batch',
  'refreshMaterializedView',
]);

/**
 * The same database handle with every write entry point replaced by a
 * function that throws. Drizzle queries all start from one of these methods,
 * so `select()` keeps working and nothing else can run.
 */
export function readOnlyDb(db: CmsDatabase): CmsDatabase {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (typeof property === 'string' && WRITE_METHODS.has(property)) {
        return () => {
          throw new Error(`dry run is read-only: db.${property}() is not allowed`);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * The oldest active admin who has chosen their own password and set up
 * two-step verification (`./cms-actor.mts` explains why); the CLIs act as
 * this user (never create one).
 */
export async function findActor(deps: Pick<PlanDeps, 'db' | 'orm' | 'schema'>) {
  const actor = await findActingAdmin(deps);
  if (!actor) throw new Error('no active admin in this database; run cms:bootstrap first');
  return actor;
}

export async function runAanbodRollout(
  options: RolloutRunOptions,
  context: RolloutRunContext,
): Promise<void> {
  const { log } = context;
  const writing = options.apply || options.restore !== null;
  const schema = await import('@/db/cms-schema');
  const planDeps: PlanDeps = {
    db: writing ? context.db : readOnlyDb(context.db),
    orm: await import('drizzle-orm'),
    schema,
    blocks: await import('@/lib/cms/blocks'),
    locale: schema.DEFAULT_LOCALE,
    log,
  };

  const actor = await findActor(planDeps);

  if (!writing) {
    log('=', `would act as ${actor.email} (no session is created in a dry run)`);
    const plan = await planAanbodRollout(planDeps);
    printPlan(plan, log);
    const blockers = planBlockers(plan, options);
    for (const blocker of blockers) log('!', blocker);
    console.log('');
    log(
      planHasChanges(plan) ? '→' : '=',
      planHasChanges(plan)
        ? `dry run: ${blockers.length > 0 ? 'blocked — fix the items marked ! first' : 'run again with --apply to write'}`
        : 'dry run: nothing to do',
    );
    return;
  }

  log('=', `acting as ${actor.email}`);
  await withAdminSession(context, actor.id, 'cms-rollout-aanbod', async () => {
    const deps: RolloutDeps = {
      ...planDeps,
      repo: await import('@/lib/cms/repo'),
      auth: await import('@/lib/cms/auth'),
      actor,
    };

    if (options.restore) {
      const backup = await readBackup(options.restore);
      await restoreAanbodRollout(deps, backup);
      log('✓', 'restore complete');
      return;
    }

    const plan = await planAanbodRollout(deps);
    printPlan(plan, log);
    for (const blocker of planBlockers(plan, options)) log('!', blocker);
    console.log('');
    const result = await applyAanbodRollout(deps, {
      backupDir: options.backupDir,
      driver: context.driver,
      allowDraftOverwrite: options.allowDraftOverwrite,
    });
    log(
      '✓',
      result.changed
        ? `rollout complete; backup: ${result.backupPath}`
        : 'rollout complete; nothing changed',
    );
    console.log(
      '  Deployed sites pick this up within 5 minutes (cache fallback); see docs/staging-runbook.md §9.',
    );
  });
}

/**
 * Runs `work` with a real, short-lived admin session in the cookie store the
 * stubbed `next/headers` reads (so the repo's permission checks apply), and
 * always revokes it and restores the previous cookie afterwards.
 */
export async function withAdminSession<T>(
  context: Pick<RolloutRunContext, 'db' | 'cookieJar'>,
  actorId: string,
  userAgent: string,
  work: () => Promise<T>,
): Promise<T> {
  const { createSession, revokeSession } = await import('@/lib/cms/session');
  // The operator's database access is the authentication (scripts/lib/cms-actor.mts).
  const session = await createSession(context.db, actorId, { userAgent }, { mfaVerified: true });
  const previousCookie = context.cookieJar.get('cms_session');
  context.cookieJar.set('cms_session', session.token);
  try {
    return await work();
  } finally {
    await revokeSession(context.db, session.token);
    if (previousCookie === undefined) context.cookieJar.delete('cms_session');
    else context.cookieJar.set('cms_session', previousCookie);
  }
}
