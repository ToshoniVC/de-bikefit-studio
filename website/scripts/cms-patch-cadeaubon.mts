/**
 * The gift voucher of 13 Oct 2026 on an EXISTING database: the page
 * /aanbod/cadeaubon (order form) created and published, and "Overige" added
 * to the catalogue groups of /aanbod. Nothing else — no settings, menus,
 * redirects or booking data.
 *
 *   npm run cms:patch-cadeaubon                         # dry run (default): plan only
 *   npm run cms:patch-cadeaubon -- --apply --expect-host <host>
 *   npm run cms:patch-cadeaubon -- --restore <backup.json> --expect-host <host>
 *
 * Options
 *   --apply                  write: backup first, then the voucher page, then
 *                            /aanbod; refuses unpublished draft edits on
 *                            /aanbod, catalogue groups an editor changed, or
 *                            an existing /aanbod/cadeaubon with other content
 *   --restore <file>         put a backup written by --apply back
 *   --expect-host <host>     REQUIRED for --apply/--restore against Neon: must
 *                            equal the host in DATABASE_URL
 *   --backup-dir <dir>       where --apply writes its backup
 *                            (default: .rollout-backups/, gitignored)
 *
 * Idempotent: a second run finds nothing to do. Logic and guarantees:
 * `scripts/lib/cadeaubon-patch.mts`. Runbook: `docs/staging-runbook.md` §12.
 */
import { config } from 'dotenv';
import { cookieJar, installRequestContextStubs } from './lib/request-context.mjs';
import { runCadeaubonPatch } from './lib/cadeaubon-patch.mjs';
import {
  assertWriteTarget,
  databaseHost,
  rejectUnknownOptions,
  valueOf,
} from './lib/cli-options.mjs';

config({ path: '.env.local' });
installRequestContextStubs();

function log(symbol: string, message: string) {
  console.log(`${symbol} ${message}`);
}

async function main() {
  const args = process.argv.slice(2);
  rejectUnknownOptions(args, ['--apply', '--restore', '--expect-host', '--backup-dir']);
  const options = {
    apply: args.includes('--apply'),
    restore: valueOf(args, '--restore'),
    expectHost: valueOf(args, '--expect-host'),
    backupDir: valueOf(args, '--backup-dir') ?? '.rollout-backups',
  };
  if (options.apply && options.restore) throw new Error('--apply and --restore cannot be combined');
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

  await runCadeaubonPatch(options, { db: await getCmsDb(), driver, cookieJar, log });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('✗ cadeaubon patch failed');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
