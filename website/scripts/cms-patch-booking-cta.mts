/**
 * Points published "Boek je bikefit" buttons that still dial the phone (or
 * jump to #contact) at /afspraak, on an EXISTING database. Only those hrefs.
 *
 *   npm run cms:patch-booking-cta                         # dry run (default): plan only
 *   npm run cms:patch-booking-cta -- --apply --expect-host <host>
 *   npm run cms:patch-booking-cta -- --restore <backup.json> --expect-host <host>
 *
 * Options
 *   --apply                  write: backup first, then the blocks, then publish;
 *                            refuses a page with unpublished draft edits
 *   --restore <file>         put a backup written by --apply back
 *   --expect-host <host>     REQUIRED for --apply/--restore against Neon: must
 *                            equal the host in DATABASE_URL
 *   --backup-dir <dir>       where --apply writes its backup
 *                            (default: .rollout-backups/, gitignored)
 *
 * Idempotent: a second run finds nothing to do. Logic and guarantees:
 * `scripts/lib/booking-cta-patch.mts`. Runbook: `docs/staging-runbook.md` §10.
 */
import { config } from 'dotenv';
import { cookieJar, installRequestContextStubs } from './lib/request-context.mjs';
import { runBookingCtaPatch } from './lib/booking-cta-patch.mjs';
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

  await runBookingCtaPatch(options, { db: await getCmsDb(), driver, cookieJar, log });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('✗ booking CTA patch failed');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
