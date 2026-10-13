-- Integration settings — server-only configuration of outside services (today
-- only the e-mail service: sender, reply-to, voucher order inbox and the
-- AES-256-GCM sealed API key). See `src/lib/email/settings.ts`.
--
-- ADDITIVE ONLY. Creates one new `cms_`-prefixed table; no DROP and no ALTER of
-- any pre-existing table. Only references `cms_users` as a foreign-key target.
--
-- Every statement is idempotent (IF NOT EXISTS / duplicate_object guard) so it
-- is safe to re-run. Code that reads this table treats a missing table as
-- "nothing configured here", so deploying the code before migrating is safe.
CREATE TABLE IF NOT EXISTS "cms_integration_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_ciphertext" text,
	"secret_hint" text,
	"secret_updated_at" timestamp with time zone,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_integration_settings" ADD CONSTRAINT "cms_integration_settings_updated_by_cms_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."cms_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
