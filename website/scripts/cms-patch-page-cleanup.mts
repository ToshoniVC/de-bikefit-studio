/**
 * Toshoni's site review of 13 Oct 2026 on an EXISTING database: the Ninove
 * kickers and double headings on /aanbod, /voor-wie and /ons-team, "jeugd" on
 * /voor-wie, /afspraak opening on "Kies je moment" with "Andere vraag?",
 * /contact → /afspraak (redirect, page unpublished, menu links), and the
 * confirmed public e-mail address in the settings. Nothing else.
 *
 *   npm run cms:patch-page-cleanup                         # dry run (default): plan only
 *   npm run cms:patch-page-cleanup -- --apply --expect-host <host>
 *   npm run cms:patch-page-cleanup -- --restore <backup.json> --expect-host <host>
 *
 * Options
 *   --apply                  write: backup first, then settings, blocks,
 *                            publish, redirect, unpublish, menus; refuses a
 *                            page with unpublished draft edits or a field an
 *                            editor changed since the rollout
 *   --restore <file>         put a backup written by --apply back
 *   --expect-host <host>     REQUIRED for --apply/--restore against Neon: must
 *                            equal the host in DATABASE_URL
 *   --backup-dir <dir>       where --apply writes its backup
 *                            (default: .rollout-backups/, gitignored)
 *
 * Idempotent: a second run finds nothing to do. Logic and guarantees:
 * `scripts/lib/page-cleanup-patch.mts`. Runbook: `docs/staging-runbook.md` §11.
 */
import { config } from 'dotenv';
import { cookieJar, installRequestContextStubs } from './lib/request-context.mjs';
import { runPageCleanupPatch } from './lib/page-cleanup-patch.mjs';
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

  await runPageCleanupPatch(options, { db: await getCmsDb(), driver, cookieJar, log });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('✗ page cleanup patch failed');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
