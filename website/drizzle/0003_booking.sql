-- Booking — locations, services, providers, hours, exceptions, bookings.
--
-- ADDITIVE ONLY. Creates eight new `cms_`-prefixed tables plus their
-- indexes/foreign keys. It contains no DROP and no ALTER of any pre-existing
-- table — webshop (`users`, `products`, `orders`, `order_items`) or CMS — and
-- only references `cms_users` as a foreign-key target.
--
-- Every statement is idempotent (IF NOT EXISTS / duplicate_object guards) so
-- it is safe to re-run. Nothing here uses the `provider` enum value added by
-- 0002_role_provider.sql (see the note there).
CREATE TABLE IF NOT EXISTS "cms_availability_exceptions" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"start_minute" integer,
	"end_minute" integer,
	"note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cms_booking_rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"ip_address" text DEFAULT 'unknown' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cms_bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"location_id" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone" text DEFAULT 'Europe/Brussels' NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_phone" text,
	"customer_age" integer,
	"guardian_name" text,
	"guardian_email" text,
	"guardian_phone" text,
	"bike_details" text,
	"notes" text,
	"customer_address" text,
	"cancel_token_hash" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"google_event_id" text,
	"google_sync_status" text DEFAULT 'pending' NOT NULL,
	"google_sync_error" text,
	"source" text DEFAULT 'web' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cms_bookings_cancel_token_hash_unique" UNIQUE("cancel_token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cms_business_hours" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"weekday" integer NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cms_locations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'studio' NOT NULL,
	"address_lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"postal_code" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"country" text DEFAULT 'BE' NOT NULL,
	"notes" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cms_provider_services" (
	"provider_id" text NOT NULL,
	"service_id" text NOT NULL,
	"location_id" text,
	CONSTRAINT "cms_provider_services_pkey" PRIMARY KEY("provider_id","service_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cms_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"phone" text,
	"email" text,
	"timezone" text DEFAULT 'Europe/Brussels' NOT NULL,
	"default_location_id" text,
	"google_calendar_id" text,
	"google_refresh_token_enc" text,
	"google_access_token" text,
	"google_access_expires_at" timestamp with time zone,
	"google_email" text,
	"google_connected_at" timestamp with time zone,
	"google_sync_error" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cms_providers_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cms_services" (
	"id" text PRIMARY KEY NOT NULL,
	"locale" text DEFAULT 'nl' NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"duration_minutes" integer NOT NULL,
	"buffer_after_minutes" integer DEFAULT 15,
	"price_cents" integer,
	"show_price" boolean DEFAULT false NOT NULL,
	"location_id" text,
	"requires_guardian" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"color" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_availability_exceptions" ADD CONSTRAINT "cms_availability_exceptions_provider_id_cms_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."cms_providers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_bookings" ADD CONSTRAINT "cms_bookings_service_id_cms_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."cms_services"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_bookings" ADD CONSTRAINT "cms_bookings_provider_id_cms_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."cms_providers"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_bookings" ADD CONSTRAINT "cms_bookings_location_id_cms_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."cms_locations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_business_hours" ADD CONSTRAINT "cms_business_hours_provider_id_cms_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."cms_providers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_provider_services" ADD CONSTRAINT "cms_provider_services_provider_id_cms_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."cms_providers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_provider_services" ADD CONSTRAINT "cms_provider_services_service_id_cms_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."cms_services"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_provider_services" ADD CONSTRAINT "cms_provider_services_location_id_cms_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."cms_locations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_providers" ADD CONSTRAINT "cms_providers_user_id_cms_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."cms_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_providers" ADD CONSTRAINT "cms_providers_default_location_id_cms_locations_id_fk" FOREIGN KEY ("default_location_id") REFERENCES "public"."cms_locations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_services" ADD CONSTRAINT "cms_services_location_id_cms_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."cms_locations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_services" ADD CONSTRAINT "cms_services_created_by_cms_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."cms_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cms_availability_exceptions_key" ON "cms_availability_exceptions" USING btree ("provider_id","date","kind","start_minute");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_booking_rate_limit_email_time_idx" ON "cms_booking_rate_limit" USING btree ("email","attempted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_booking_rate_limit_ip_time_idx" ON "cms_booking_rate_limit" USING btree ("ip_address","attempted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_bookings_provider_starts_idx" ON "cms_bookings" USING btree ("provider_id","starts_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_bookings_starts_idx" ON "cms_bookings" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_bookings_customer_email_idx" ON "cms_bookings" USING btree ("customer_email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cms_bookings_provider_start_confirmed_key" ON "cms_bookings" USING btree ("provider_id","starts_at") WHERE status = 'confirmed';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_business_hours_provider_idx" ON "cms_business_hours" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_locations_active_sort_idx" ON "cms_locations" USING btree ("is_active","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_provider_services_service_idx" ON "cms_provider_services" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_providers_active_sort_idx" ON "cms_providers" USING btree ("is_active","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cms_services_locale_slug_key" ON "cms_services" USING btree ("locale","slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_services_active_sort_idx" ON "cms_services" USING btree ("is_active","sort_order");
