/**
 * Staging rollout of the 13 Oct 2026 redesign (Aanbod, Voor wie, Bikefit,
 * Ons team, menus, /over-ons → /ons-team) onto an EXISTING database.
 *
 *   npm run cms:rollout-aanbod                         # dry run (default): plan only
 *   npm run cms:rollout-aanbod -- --apply --expect-host <host>
 *   npm run cms:rollout-aanbod -- --restore <backup.json> --expect-host <host>
 *
 * Options
 *   --apply                  write: backup first, then pages, menus, redirect,
 *                            unpublish /over-ons; refuses on a conflict
 *   --restore <file>         put a backup written by --apply back
 *   --expect-host <host>     REQUIRED for --apply/--restore against Neon: must
 *                            equal the host in DATABASE_URL (guards against
 *                            pointing at the wrong branch, e.g. production)
 *   --backup-dir <dir>       where --apply writes its backup
 *                            (default: .rollout-backups/, gitignored)
 *   --allow-draft-overwrite  replace pages that have unpublished draft edits
 *                            (their drafts are in the backup either way)
 *
 * Writes go through `src/lib/cms/repo.ts` with a real, short-lived admin
 * session (same mechanism as `cms:seed`, see `scripts/lib/request-context.mts`).
 * It needs an existing active admin and never creates one. Booking data,
 * settings, users and every other page are left alone; the logic and its
 * guarantees are in `scripts/lib/aanbod-rollout.mts`. Runbook:
 * `docs/staging-runbook.md` §9.
 */
import { config } from 'dotenv';
import { cookieJar, installRequestContextStubs } from './lib/request-context.mjs';
import {
  applyAanbodRollout,
  planAanbodRollout,
  planBlockers,
  planHasChanges,
  printPlan,
  readBackup,
  restoreAanbodRollout,
  type RolloutDeps,
} from './lib/aanbod-rollout.mjs';

config({ path: '.env.local' });
installRequestContextStubs();

type Options = {
  apply: boolean;
  restore: string | null;
  expectHost: string | null;
  backupDir: string;
  allowDraftOverwrite: boolean;
};

function valueOf(args: string[], flag: string): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === flag) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
      return value;
    }
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return null;
}

function parseOptions(args: string[]): Options {
  const known = new Set([
    '--apply',
    '--restore',
    '--expect-host',
    '--backup-dir',
    '--allow-draft-overwrite',
  ]);
  for (const arg of args) {
    const flag = arg.split('=')[0];
    if (arg.startsWith('--') && !known.has(flag)) throw new Error(`unknown option ${arg}`);
  }
  const options: Options = {
    apply: args.includes('--apply'),
    restore: valueOf(args, '--restore'),
    expectHost: valueOf(args, '--expect-host'),
    backupDir: valueOf(args, '--backup-dir') ?? '.rollout-backups',
    allowDraftOverwrite: args.includes('--allow-draft-overwrite'),
  };
  if (options.apply && options.restore) throw new Error('--apply and --restore cannot be combined');
  return options;
}

function log(symbol: string, message: string) {
  console.log(`${symbol} ${message}`);
}

/** Host part of DATABASE_URL — never the credentials. */
function databaseHost(): string | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return 'unparseable';
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const writing = options.apply || options.restore !== null;

  const { getCmsDb, cmsDriver } = await import('@/db/cms');
  const driver = cmsDriver();
  const host = databaseHost();
  log('→', `driver: ${driver}${host ? ` (${host})` : ''}`);
  log(
    '→',
    options.restore
      ? `mode: restore ${options.restore}`
      : options.apply
        ? 'mode: APPLY'
        : 'mode: dry run (nothing is written)',
  );

  if (writing && driver === 'neon-http') {
    if (!options.expectHost) {
      throw new Error(
        `--expect-host is required to write to Neon; this DATABASE_URL points at ${host}`,
      );
    }
    if (options.expectHost !== host) {
      throw new Error(
        `--expect-host ${options.expectHost} does not match DATABASE_URL host ${host}`,
      );
    }
  }

  const db = await getCmsDb();
  const orm = await import('drizzle-orm');
  const schema = await import('@/db/cms-schema');
  const blocks = await import('@/lib/cms/blocks');
  const { createSession, revokeSession } = await import('@/lib/cms/session');

  const [actor] = await db
    .select({ id: schema.cmsUsers.id, email: schema.cmsUsers.email })
    .from(schema.cmsUsers)
    .where(orm.and(orm.eq(schema.cmsUsers.role, 'admin'), orm.eq(schema.cmsUsers.isActive, true)))
    .orderBy(orm.asc(schema.cmsUsers.createdAt))
    .limit(1);
  if (!actor) throw new Error('no active admin in this database; run cms:bootstrap first');
  log('=', `acting as ${actor.email}`);

  const session = await createSession(db, actor.id, { userAgent: 'cms-rollout-aanbod' });
  cookieJar.set('cms_session', session.token);

  try {
    const deps: RolloutDeps = {
      db,
      orm,
      schema,
      blocks,
      repo: await import('@/lib/cms/repo'),
      auth: await import('@/lib/cms/auth'),
      actor,
      locale: schema.DEFAULT_LOCALE,
      log,
    };

    if (options.restore) {
      const backup = await readBackup(options.restore);
      await restoreAanbodRollout(deps, backup);
      log('✓', 'restore complete');
      return;
    }

    const plan = await planAanbodRollout(deps);
    printPlan(plan, log);
    const blockers = planBlockers(plan, options);
    for (const blocker of blockers) log('!', blocker);

    if (!options.apply) {
      console.log('');
      log(
        planHasChanges(plan) ? '→' : '=',
        planHasChanges(plan)
          ? `dry run: ${blockers.length > 0 ? 'blocked — fix the items marked ! first' : 'run again with --apply to write'}`
          : 'dry run: nothing to do',
      );
      return;
    }

    console.log('');
    const result = await applyAanbodRollout(deps, {
      backupDir: options.backupDir,
      driver,
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
  } finally {
    await revokeSession(db, session.token);
    cookieJar.clear();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('✗ rollout failed');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
