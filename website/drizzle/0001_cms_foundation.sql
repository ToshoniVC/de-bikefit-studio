-- CMS foundation — De Bikefit Studio public site + admin.
--
-- ADDITIVE ONLY. Creates two enum types and eleven new `cms_`-prefixed
-- tables plus their indexes/foreign keys. It contains no DROP and no ALTER
-- of any pre-existing webshop table (`users`, `products`, `orders`,
-- `order_items`) — those are never referenced here.
--
-- Every statement is idempotent (IF NOT EXISTS / duplicate_object guards) so
-- it is safe to run against a database that was previously `drizzle-kit push`ed.
DO $$ BEGIN
 CREATE TYPE "public"."cms_page_status" AS ENUM('draft', 'published');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."cms_role" AS ENUM('admin', 'editor');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cms_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"user_email" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"summary" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cms_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cms_login_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"ip_address" text DEFAULT 'unknown' NOT NULL,
	"successful" boolean DEFAULT false NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cms_media" (
	"id" text PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"alt" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"storage" text DEFAULT 'db' NOT NULL,
	"storage_key" text,
	"url" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cms_media_blobs" (
	"media_id" text PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cms_navigation" (
	"id" text PRIMARY KEY NOT NULL,
	"locale" text DEFAULT 'nl' NOT NULL,
	"menu_key" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cms_pages" (
	"id" text PRIMARY KEY NOT NULL,
	"locale" text DEFAULT 'nl' NOT NULL,
	"slug" text NOT NULL,
	"translation_group" text NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'default' NOT NULL,
	"status" "cms_page_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"published_snapshot" jsonb,
	"meta_title" text,
	"meta_description" text,
	"canonical_override" text,
	"og_title" text,
	"og_description" text,
	"og_image_media_id" text,
	"no_index" boolean DEFAULT false NOT NULL,
	"structured_data_type" text,
	"structured_data_overrides" jsonb,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cms_redirects" (
	"id" text PRIMARY KEY NOT NULL,
	"from_path" text NOT NULL,
	"to_path" text NOT NULL,
	"status_code" integer DEFAULT 301 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cms_redirects_from_path_unique" UNIQUE("from_path")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cms_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text,
	"ip_address" text,
	CONSTRAINT "cms_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cms_site_settings" (
	"locale" text DEFAULT 'nl' NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cms_site_settings_pkey" PRIMARY KEY("locale","key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cms_users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "cms_role" DEFAULT 'editor' NOT NULL,
	"password_hash" text NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "cms_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_audit_log" ADD CONSTRAINT "cms_audit_log_user_id_cms_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."cms_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_blocks" ADD CONSTRAINT "cms_blocks_page_id_cms_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."cms_pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_media" ADD CONSTRAINT "cms_media_created_by_cms_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."cms_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_media_blobs" ADD CONSTRAINT "cms_media_blobs_media_id_cms_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."cms_media"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_navigation" ADD CONSTRAINT "cms_navigation_updated_by_cms_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."cms_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_pages" ADD CONSTRAINT "cms_pages_og_image_media_id_cms_media_id_fk" FOREIGN KEY ("og_image_media_id") REFERENCES "public"."cms_media"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_pages" ADD CONSTRAINT "cms_pages_updated_by_cms_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."cms_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_sessions" ADD CONSTRAINT "cms_sessions_user_id_cms_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."cms_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_site_settings" ADD CONSTRAINT "cms_site_settings_updated_by_cms_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."cms_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_audit_log_created_at_idx" ON "cms_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_audit_log_entity_idx" ON "cms_audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_blocks_page_id_sort_order_idx" ON "cms_blocks" USING btree ("page_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_login_attempts_email_time_idx" ON "cms_login_attempts" USING btree ("email","attempted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_login_attempts_ip_time_idx" ON "cms_login_attempts" USING btree ("ip_address","attempted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_media_deleted_at_idx" ON "cms_media" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_media_created_at_idx" ON "cms_media" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cms_navigation_locale_menu_key_key" ON "cms_navigation" USING btree ("locale","menu_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cms_pages_locale_slug_key" ON "cms_pages" USING btree ("locale","slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cms_pages_locale_translation_group_key" ON "cms_pages" USING btree ("locale","translation_group");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_pages_status_idx" ON "cms_pages" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_pages_translation_group_idx" ON "cms_pages" USING btree ("translation_group");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_redirects_enabled_idx" ON "cms_redirects" USING btree ("is_enabled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_sessions_user_id_idx" ON "cms_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_sessions_expires_at_idx" ON "cms_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_users_role_idx" ON "cms_users" USING btree ("role");