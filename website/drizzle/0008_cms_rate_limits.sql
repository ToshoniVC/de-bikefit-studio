-- Race-free rate limits for public writes, first the online booking —
-- docs/booking-architecture.md §9 (step 3), docs/cms-architecture.md §4
-- (Rate limiting).
--
-- ADDITIVE. Creates ONE new table, `cms_rate_limits` (one row per rate-limit
-- scope — `booking:ip:<ip>`, `booking:email:<SHA-256 hex>` — holding the times
-- of the attempts still inside that scope's window), and its index on
-- `updated_at`. No foreign key, no data change, no DROP. The old attempt log
-- `cms_booking_rate_limit` stays exactly as it is: the gift voucher requests
-- still use it, bookings no longer write to it. Nothing touches a webshop
-- table (`users`, `products`, `orders`, `order_items`).
--
-- Every statement is guarded (IF NOT EXISTS) so the file is safe to re-run; on
-- neon-http each statement commits on its own, and a run that failed half-way
-- is simply repeated.
--
-- Apply BEFORE deploying a build that contains it: until the table exists,
-- every public booking attempt fails closed ("Er ging iets mis", logged as
-- `[booking] create_failed`).
CREATE TABLE IF NOT EXISTS "cms_rate_limits" (
	"scope" text PRIMARY KEY NOT NULL,
	"hits" timestamp with time zone[] DEFAULT '{}'::timestamptz[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_rate_limits_updated_at_idx" ON "cms_rate_limits" USING btree ("updated_at");