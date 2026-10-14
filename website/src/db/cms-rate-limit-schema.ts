/**
 * Rate-limit counters for public (anonymous) writes, created by
 * `drizzle/0008_cms_rate_limits.sql`. Kept apart from `./cms-schema.ts`, which
 * is already past the file-size limit; the same `cms_` prefix and conventions
 * apply, and `drizzle.config.ts` and `./cms.ts` list this file too.
 * Architecture: docs/booking-architecture.md §9 (step 3) and
 * docs/cms-architecture.md §4 (Rate limiting).
 */
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * One row per rate-limit scope. The key is a namespaced string the caller's
 * policy builds (`src/lib/booking/rate-limit-policy.ts`: `booking:ip:<ip>` and
 * `booking:email:<SHA-256 hex of the address>`). `hits` holds the times of the
 * reserved attempts still inside the scope's window; a hit is reserved and the
 * window pruned in ONE conditional upsert, so parallel requests cannot
 * overshoot the limit (`src/lib/rate-limit.ts`). Rows not updated for a day
 * are pruned on the way.
 *
 * The same shape as `cms_mfa_rate_limits` (`./cms-mfa-schema.ts`) without its
 * `user_id`: these scopes belong to anonymous visitors, and keeping the two
 * tables apart means the MFA remedies (`clearMfaAttempts`) and the public
 * limits never touch each other's rows.
 */
export const cmsRateLimits = pgTable(
  'cms_rate_limits',
  {
    scope: text('scope').primaryKey(),
    hits: timestamp('hits', { withTimezone: true })
      .array()
      .default(sql`'{}'::timestamptz[]`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('cms_rate_limits_updated_at_idx').on(t.updatedAt)],
);
