/**
 * Turns the offer pages of an EXISTING database into offerings (Beheer →
 * Aanbod owns the offer since 17 Oct 2026; migration 0011).
 *
 *   npm run cms:migrate-aanbod                          # dry run (default): plan only
 *   npm run cms:migrate-aanbod -- --apply --expect-host <host>
 *
 * Options
 *   --apply                  write: backup first, then the offerings, the
 *                            gift voucher's move and redirect, the voucher
 *                            card on /aanbod; the offer pages are deleted last
 *   --expect-host <host>     REQUIRED for --apply against Neon: must equal the
 *                            host in DATABASE_URL
 *   --backup-dir <dir>       where --apply writes its backup
 *                            (default: .rollout-backups/, gitignored)
 *
 * The dry run is read-only (no session, no audit entry, writes refused).
 * Idempotent: a second run finds nothing to do. Undo: restore the Neon
 * snapshot taken before the apply (the backup JSON holds the deleted pages
 * for reference). Needs migrations 0010 + 0011 and an active admin with their
 * own password and two-step verification (`scripts/lib/cms-actor.mts`).
 * Logic and guarantees: `scripts/lib/aanbod-migrate.mts`. Runbook:
 * `docs/staging-runbook.md` §19.
 */
import { config } from 'dotenv';
import { cookieJar, installRequestContextStubs } from './lib/request-context.mjs';
import { runAanbodMigration } from './lib/aanbod-migrate.mjs';
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
  rejectUnknownOptions(args, ['--apply', '--expect-host', '--backup-dir']);
  const apply = args.includes('--apply');
  const expectHost = valueOf(args, '--expect-host');
  const backupDir = valueOf(args, '--backup-dir') ?? '.rollout-backups';

  const { getCmsDb, cmsDriver } = await import('@/db/cms');
  const driver = cmsDriver();
  const host = databaseHost();
  log('→', `driver: ${driver}${host ? ` (${host})` : ''}`);
  log('→', apply ? 'mode: APPLY' : 'mode: dry run (nothing is written)');
  if (apply) assertWriteTarget(driver, host, expectHost);

  await runAanbodMigration({ apply, backupDir }, { db: await getCmsDb(), driver, cookieJar, log });
  if (apply) {
    console.log(
      '  Deployed sites pick this up within 5 minutes (cache fallback); see docs/staging-runbook.md §19.',
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('✗ aanbod migration failed');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
