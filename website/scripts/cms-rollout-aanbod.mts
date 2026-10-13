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
 * The dry run is read-only: no session, no audit entry, no write method
 * reachable (`scripts/lib/aanbod-rollout-run.mts`). `--apply`/`--restore`
 * write through `src/lib/cms/repo.ts` with a real, short-lived admin session
 * (same mechanism as `cms:seed`, see `scripts/lib/request-context.mts`).
 * It needs an existing active admin and never creates one. Booking data,
 * settings, users and every other page are left alone; the logic and its
 * guarantees are in `scripts/lib/aanbod-rollout.mts`. Runbook:
 * `docs/staging-runbook.md` §9.
 */
import { config } from 'dotenv';
import { cookieJar, installRequestContextStubs } from './lib/request-context.mjs';
import { runAanbodRollout } from './lib/aanbod-rollout-run.mjs';
import {
  assertWriteTarget,
  databaseHost,
  rejectUnknownOptions,
  valueOf,
} from './lib/cli-options.mjs';

config({ path: '.env.local' });
installRequestContextStubs();

type Options = {
  apply: boolean;
  restore: string | null;
  expectHost: string | null;
  backupDir: string;
  allowDraftOverwrite: boolean;
};

function parseOptions(args: string[]): Options {
  rejectUnknownOptions(args, [
    '--apply',
    '--restore',
    '--expect-host',
    '--backup-dir',
    '--allow-draft-overwrite',
  ]);
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

  if (writing) assertWriteTarget(driver, host, options.expectHost);

  await runAanbodRollout(options, { db: await getCmsDb(), driver, cookieJar, log });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('✗ rollout failed');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
