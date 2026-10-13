-- CMS administrator two-step verification (TOTP) — docs/cms-architecture.md §4.
--
-- ADDITIVE ONLY. Creates four new `cms_mfa_*` tables (factors, recovery-code
-- hashes, sign-in challenges, attempt log) with their indexes and foreign keys
-- to `cms_users`, and adds ONE nullable column, `cms_sessions.mfa_verified_at`.
-- No DROP, no data change, nothing touches a webshop table (`users`,
-- `products`, `orders`, `order_items`).
--
-- Every existing session gets `mfa_verified_at = NULL`. That is intended: the
-- auth guard then refuses existing ADMIN sessions until the admin signs in
-- again and enrols or verifies an authenticator; editor and provider sessions
-- keep working unchanged.
--
-- Every statement is idempotent (IF NOT EXISTS / duplicate_object guards) so
-- the file is safe to re-run.
CREATE TABLE IF NOT EXISTS "cms_mfa_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"ip_address" text DEFAULT 'unknown' NOT NULL,
	"successful" boolean DEFAULT false NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cms_mfa_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text,
	"ip_address" text,
	CONSTRAINT "cms_mfa_challenges_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cms_mfa_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text DEFAULT 'totp' NOT NULL,
	"secret_enc" text NOT NULL,
	"pending_context" text,
	"confirmed_at" timestamp with time zone,
	"last_used_step" integer,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cms_mfa_recovery_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cms_mfa_recovery_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "cms_sessions" ADD COLUMN IF NOT EXISTS "mfa_verified_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_mfa_attempts" ADD CONSTRAINT "cms_mfa_attempts_user_id_cms_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."cms_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_mfa_challenges" ADD CONSTRAINT "cms_mfa_challenges_user_id_cms_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."cms_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_mfa_factors" ADD CONSTRAINT "cms_mfa_factors_user_id_cms_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."cms_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_mfa_recovery_codes" ADD CONSTRAINT "cms_mfa_recovery_codes_user_id_cms_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."cms_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_mfa_attempts_user_time_idx" ON "cms_mfa_attempts" USING btree ("user_id","attempted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_mfa_attempts_ip_time_idx" ON "cms_mfa_attempts" USING btree ("ip_address","attempted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_mfa_challenges_user_id_idx" ON "cms_mfa_challenges" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_mfa_challenges_expires_at_idx" ON "cms_mfa_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_mfa_factors_user_id_idx" ON "cms_mfa_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_mfa_recovery_codes_user_id_idx" ON "cms_mfa_recovery_codes" USING btree ("user_id");