-- CMS two-step verification: race-free rate limits and one sign-in challenge
-- per user — docs/cms-architecture.md §4 (Rate limiting, Two-step verification).
--
-- ADDITIVE. Creates ONE new table, `cms_mfa_rate_limits` (one row per
-- rate-limit scope — user + IP, IP, user per day — holding the times of the
-- code checks still inside that scope's window), with its foreign key to
-- `cms_users` and two indexes, and adds ONE unique index,
-- `cms_mfa_challenges_user_id_unique_idx`, so a user has at most one sign-in
-- challenge. No DROP: the old non-unique index `cms_mfa_challenges_user_id_idx`
-- and the `cms_mfa_attempts` table stay (the code no longer uses the latter).
-- Nothing touches a webshop table (`users`, `products`, `orders`,
-- `order_items`).
--
-- The ONE data change: before the unique index is built, duplicate
-- `cms_mfa_challenges` rows of a user (possible until now when two password
-- sign-ins raced) are deleted, keeping the newest per user. Challenges are
-- ephemeral sign-in state that lives at most 10 minutes; losing an older
-- duplicate only means that browser enters the password again. The delete and
-- the index run in one statement (a DO block) under a table lock, so a sign-in
-- racing the migration cannot slip a new duplicate in between.
--
-- Every statement is guarded (IF NOT EXISTS / duplicate_object / to_regclass)
-- so the file is safe to re-run; on neon-http each statement commits on its
-- own, and a run that failed half-way is simply repeated.
CREATE TABLE IF NOT EXISTS "cms_mfa_rate_limits" (
	"scope" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"hits" timestamp with time zone[] DEFAULT '{}'::timestamptz[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_mfa_rate_limits" ADD CONSTRAINT "cms_mfa_rate_limits_user_id_cms_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."cms_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_mfa_rate_limits_user_id_idx" ON "cms_mfa_rate_limits" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_mfa_rate_limits_updated_at_idx" ON "cms_mfa_rate_limits" USING btree ("updated_at");--> statement-breakpoint
DO $$ BEGIN
 IF to_regclass('public.cms_mfa_challenges_user_id_unique_idx') IS NULL THEN
  LOCK TABLE "cms_mfa_challenges" IN SHARE ROW EXCLUSIVE MODE;
  DELETE FROM "cms_mfa_challenges" AS "older"
   USING "cms_mfa_challenges" AS "newer"
   WHERE "older"."user_id" = "newer"."user_id"
    AND ("older"."created_at", "older"."id") < ("newer"."created_at", "newer"."id");
  CREATE UNIQUE INDEX IF NOT EXISTS "cms_mfa_challenges_user_id_unique_idx" ON "cms_mfa_challenges" USING btree ("user_id");
 END IF;
END $$;
