/**
 * Saves the offering settings (Beheer → Aanbod, migration 0010) that the
 * published offer pages already imply, on an EXISTING database.
 *
 *   npm run cms:migrate-offerings                          # dry run (default): plan only
 *   npm run cms:migrate-offerings -- --apply --expect-host <host>
 *
 * Options
 *   --apply                  write the exact derivations through the repo
 *                            (audited as `offering.update`)
 *   --expect-host <host>     REQUIRED for --apply against Neon: must equal the
 *                            host in DATABASE_URL
 *
 * Optional: until it runs, every offer page derives the same settings at
 * render time. An offer whose settings are not an exact copy (a free-text
 * price label, an unknown service slug) is reported and left for an editor.
 * Needs migration 0010 and an active admin with their own password and
 * two-step verification (`scripts/lib/cms-actor.mts`). Logic and guarantees:
 * `scripts/lib/offerings-migrate.mts`. Runbook: `docs/staging-runbook.md` §17.
 */
import { config } from 'dotenv';
import { cookieJar, installRequestContextStubs } from './lib/request-context.mjs';
import { runOfferingMigration } from './lib/offerings-migrate.mjs';
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
  rejectUnknownOptions(args, ['--apply', '--expect-host']);
  const apply = args.includes('--apply');
  const expectHost = valueOf(args, '--expect-host');

  const { getCmsDb, cmsDriver } = await import('@/db/cms');
  const driver = cmsDriver();
  const host = databaseHost();
  log('→', `driver: ${driver}${host ? ` (${host})` : ''}`);
  log('→', apply ? 'mode: APPLY' : 'mode: dry run (nothing is written)');
  if (apply) assertWriteTarget(driver, host, expectHost);

  await runOfferingMigration({ apply }, { db: await getCmsDb(), driver, cookieJar, log });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('✗ offering migration failed');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
