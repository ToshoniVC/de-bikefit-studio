/**
 * Break-glass: removes a CMS user's two-step verification when no other admin
 * can do it in the browser (Gebruikers → Tweestapsverificatie resetten), e.g.
 * the only admin lost both the authenticator and the recovery codes.
 *
 *   npm run cms:mfa-reset -- --email <address>                       # dry run: counts only
 *   npm run cms:mfa-reset -- --email <address> --apply --expect-host <host>
 *
 * With --apply it deletes the user's authenticators, recovery codes and
 * sign-in challenges, revokes every session, clears their code-check counters
 * (rate limits) and writes an audit entry (`auth.mfa_break_glass`, actor "cli"). It prints
 * no secret. Recommended: pass a new temporary password inline,
 *
 *   CMS_BREAK_GLASS_PASSWORD='…' npm run cms:mfa-reset -- --email <address> --apply …
 *
 * so only the person it is handed to can enrol next (must be changed at
 * sign-in). Without it the password stays as it was and whoever knows it can
 * enrol first: then run it only when that person is ready to sign in.
 *
 * Works for any role (admins, providers, an editor who kept an authenticator);
 * the dry run prints the role next to the address.
 *
 * The operator's database credentials are the authorisation, as for every
 * CMS CLI; --expect-host must equal the DATABASE_URL host for a Neon write.
 * Logic: `scripts/lib/mfa-reset.mts`. Runbook: docs/staging-runbook.md §14
 * (a provider: §17).
 */
import { config } from 'dotenv';
import {
  assertWriteTarget,
  databaseHost,
  rejectUnknownOptions,
  valueOf,
} from './lib/cli-options.mjs';
import { runMfaReset } from './lib/mfa-reset.mjs';

config({ path: '.env.local' });

function log(symbol: string, message: string) {
  console.log(`${symbol} ${message}`);
}

async function main() {
  const args = process.argv.slice(2);
  rejectUnknownOptions(args, ['--email', '--apply', '--expect-host']);
  const email = valueOf(args, '--email');
  const apply = args.includes('--apply');
  if (!email) throw new Error('--email is required');

  const { getCmsDb, cmsDriver } = await import('@/db/cms');
  const driver = cmsDriver();
  const host = databaseHost();
  log('→', `driver: ${driver}${host ? ` (${host})` : ''}`);
  log('→', apply ? 'mode: APPLY' : 'mode: dry run (nothing is written)');
  if (apply) assertWriteTarget(driver, host, valueOf(args, '--expect-host'));

  // Scripts-only variable, passed inline like CMS_BOOTSTRAP_PASSWORD; never stored.
  const temporaryPassword = process.env.CMS_BREAK_GLASS_PASSWORD || undefined;
  await runMfaReset({ db: await getCmsDb(), email, apply, temporaryPassword, log });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('✗ MFA reset failed');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
