/**
 * Retention purge for personal data (GDPR: storage limitation).
 *
 *   npm run cms:retention                 # DRY RUN (default): counts only
 *   npm run cms:retention -- --apply      # actually deletes
 *   npm run cms:retention -- --json       # machine-readable report
 *
 * Connects like every other script: PGlite in `website/.pglite/` locally,
 * Neon (neon-http) when `DATABASE_URL` is set. Run monthly by hand against
 * staging/production (see §11.3 "Retention (bewaartermijnen)" under §11 "GDPR en
 * bewaartermijnen" in docs/booking-runbook.md);
 * there is deliberately no Vercel cron.
 *
 * Policy (mirrors section 3 of the privacy statement, /privacy):
 *  - `cms_bookings`: a booking whose appointment ended more than 3 years ago
 *    (any status) is deleted, unless the same customer e-mail (case- and
 *    whitespace-insensitive) has a booking that ends less than 3 years ago or
 *    in the future. In other words: all bookings of a customer go together,
 *    three years after their last appointment.
 *  - `cms_booking_rate_limit`: attempts older than 24 hours are deleted (the
 *    public booking action also prunes these opportunistically).
 *  - Never touched: `cms_audit_log`, `cms_sessions`, `cms_login_attempts`,
 *    users, providers, services, locations and every content table.
 *
 * Exit code 0 on a successful dry run or apply, 1 on any error. Nothing is
 * deleted without `--apply`.
 */
import { config } from 'dotenv';
import { and, exists, gte, lt, not, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

// `quiet`: dotenv's banner goes to stdout and would corrupt `--json` output.
config({ path: '.env.local', quiet: true });

import { cmsDriver, getCmsDb } from '@/db/cms';
import { cmsBookingRateLimit, cmsBookings } from '@/db/cms-schema';

const BOOKING_RETENTION_YEARS = 3;
const RATE_LIMIT_RETENTION_HOURS = 24;
const KNOWN_STATUSES = ['confirmed', 'cancelled', 'completed', 'no_show'] as const;
const UNTOUCHED = [
  'cms_audit_log',
  'cms_sessions',
  'cms_login_attempts',
  'cms_users',
  'cms_providers',
  'cms_services',
  'cms_locations',
  'content (pages, blocks, media, navigation, settings, redirects)',
];

type Options = { apply: boolean; json: boolean };

function parseArgs(args: string[]): Options {
  const options: Options = { apply: false, json: false };
  for (const arg of args) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--json') options.json = true;
    else throw new Error(`unknown argument "${arg}" (allowed: --apply, --json)`);
  }
  return options;
}

type StatusCounts = Record<string, number>;

function formatCounts(counts: StatusCounts): string {
  const statuses = [
    ...KNOWN_STATUSES,
    ...Object.keys(counts).filter(
      (status) => !(KNOWN_STATUSES as readonly string[]).includes(status),
    ),
  ];
  return statuses.map((status) => `${status} ${counts[status] ?? 0}`).join(' · ');
}

function total(counts: StatusCounts): number {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const now = new Date();
  const bookingCutoff = new Date(now);
  bookingCutoff.setUTCFullYear(bookingCutoff.getUTCFullYear() - BOOKING_RETENTION_YEARS);
  const rateLimitCutoff = new Date(now.getTime() - RATE_LIMIT_RETENTION_HOURS * 60 * 60 * 1000);

  const out = (line = '') => {
    if (!options.json) console.log(line);
  };

  // --- Header: the policy, before anything touches the database ------------
  out(
    options.apply
      ? 'De Bikefit Studio — retention purge (APPLY: rows below WILL be deleted)'
      : 'De Bikefit Studio — retention purge (DRY RUN: nothing is deleted; add --apply)',
  );
  out('Policy');
  out(
    `  cms_bookings            appointment ended before ${bookingCutoff.toISOString()} (${BOOKING_RETENTION_YEARS} years), any status → delete,`,
  );
  out(
    `                          unless the same customer e-mail has a booking ending on/after that moment → keep`,
  );
  out(
    `  cms_booking_rate_limit  attempted before ${rateLimitCutoff.toISOString()} (${RATE_LIMIT_RETENTION_HOURS} hours) → delete`,
  );
  out(`  not touched             ${UNTOUCHED.join(', ')}`);
  out('');

  const driver = cmsDriver();
  out(`→ driver: ${driver}`);
  const db = await getCmsDb();

  // --- cms_bookings ----------------------------------------------------------
  // `later` is the same table under an alias; `cms_bookings` inside the
  // subquery therefore refers to the outer row (a correlated NOT EXISTS).
  const later = alias(cmsBookings, 'later');
  const sameCustomer = sql`lower(trim(${later.customerEmail})) = lower(trim(${cmsBookings.customerEmail}))`;
  const hasRecentBooking = exists(
    db
      .select({ one: sql`1` })
      .from(later)
      .where(and(sameCustomer, gte(later.endsAt, bookingCutoff))),
  );
  const endedBeforeCutoff = lt(cmsBookings.endsAt, bookingCutoff);
  const expired = and(endedBeforeCutoff, not(hasRecentBooking));
  const keptForLaterBooking = and(endedBeforeCutoff, hasRecentBooking);

  const candidateRows = await db
    .select({ status: cmsBookings.status, count: sql<number>`count(*)::int` })
    .from(cmsBookings)
    .where(expired)
    .groupBy(cmsBookings.status);
  const candidates: StatusCounts = Object.fromEntries(
    candidateRows.map((row) => [row.status, Number(row.count)]),
  );

  const [keptRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(cmsBookings)
    .where(keptForLaterBooking);
  const kept = Number(keptRow?.count ?? 0);

  // --- cms_booking_rate_limit -------------------------------------------------
  const staleAttempts = lt(cmsBookingRateLimit.attemptedAt, rateLimitCutoff);
  const [attemptRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(cmsBookingRateLimit)
    .where(staleAttempts);
  const attemptCandidates = Number(attemptRow?.count ?? 0);

  out('cms_bookings');
  out(`  to delete: ${total(candidates)}  (${formatCounts(candidates)})`);
  out(
    `  kept because the same e-mail has a booking within ${BOOKING_RETENTION_YEARS} years: ${kept}`,
  );
  out('cms_booking_rate_limit');
  out(`  to delete: ${attemptCandidates}`);

  // --- Apply -------------------------------------------------------------------
  let deletedBookings: StatusCounts | null = null;
  let deletedAttempts: number | null = null;

  if (options.apply) {
    const removed = await db
      .delete(cmsBookings)
      .where(expired)
      .returning({ status: cmsBookings.status });
    deletedBookings = {};
    for (const row of removed) {
      deletedBookings[row.status] = (deletedBookings[row.status] ?? 0) + 1;
    }

    const removedAttempts = await db
      .delete(cmsBookingRateLimit)
      .where(staleAttempts)
      .returning({ id: cmsBookingRateLimit.id });
    deletedAttempts = removedAttempts.length;

    out('');
    out(`deleted cms_bookings: ${total(deletedBookings)}  (${formatCounts(deletedBookings)})`);
    out(`deleted cms_booking_rate_limit: ${deletedAttempts}`);
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: options.apply ? 'apply' : 'dry-run',
          driver,
          now: now.toISOString(),
          policy: {
            bookings: {
              retentionYears: BOOKING_RETENTION_YEARS,
              cutoff: bookingCutoff.toISOString(),
              rule: 'ends_at < cutoff, any status, unless the same customer e-mail has a booking with ends_at >= cutoff',
            },
            rateLimit: {
              retentionHours: RATE_LIMIT_RETENTION_HOURS,
              cutoff: rateLimitCutoff.toISOString(),
            },
            untouched: UNTOUCHED,
          },
          bookings: {
            candidates: { total: total(candidates), byStatus: candidates },
            keptForLaterBooking: kept,
            deleted: deletedBookings
              ? { total: total(deletedBookings), byStatus: deletedBookings }
              : null,
          },
          rateLimit: { candidates: attemptCandidates, deleted: deletedAttempts },
        },
        null,
        2,
      ),
    );
  }

  out('');
  out(
    options.apply
      ? '✓ retention purge applied'
      : `✓ dry run complete — nothing deleted. Run with --apply to delete ${total(candidates)} booking(s) and ${attemptCandidates} rate-limit row(s).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('✗ retention failed');
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  });
