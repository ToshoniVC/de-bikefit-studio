-- Offering settings for Beheer → Aanbod — docs/cms-architecture.md §15 and
-- docs/booking-architecture.md §15.
--
-- ADDITIVE. Two new tables, nothing else:
--   cms_offerings          one row per offer page: shown on the website, one
--                          option or Volwassene/Jeugd variants, booked directly
--                          online or asked for through the enquiry form;
--   cms_offering_variants  per variant: the booking service it is booked as and
--                          its public price in cents (null = "Prijs op aanvraag").
-- No data change: no row is created here. Until an offering has a row the site
-- derives the same settings from the offer page's block as before this
-- migration (`deriveLegacyOffering()`), so applying it changes nothing a
-- visitor sees. `npm run cms:migrate-offerings -- --apply` writes the rows
-- afterwards (dry run by default). Nothing touches cms_services,
-- cms_provider_services, cms_bookings or a webshop table; existing bookings keep
-- their service id.
--
-- Every statement is guarded (IF NOT EXISTS / duplicate_object) so the file is
-- safe to re-run; on neon-http each statement commits on its own, and a run that
-- failed half-way is simply repeated.
--
-- Apply BEFORE deploying a build that contains it: the offer pages, the
-- overviews and the booking widget read these tables (a failed read falls back
-- to the page-derived settings and logs `[aanbod] offerings_unavailable`), and
-- Beheer → Aanbod cannot save without them.
CREATE TABLE IF NOT EXISTS "cms_offerings" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"is_listed" boolean DEFAULT true NOT NULL,
	"booking_mode" text DEFAULT 'enquiry' NOT NULL,
	"variant_mode" text DEFAULT 'single' NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cms_offering_variants" (
	"offering_id" text NOT NULL,
	"audience" text NOT NULL,
	"service_id" text,
	"price_cents" integer,
	CONSTRAINT "cms_offering_variants_offering_id_audience_pk" PRIMARY KEY("offering_id","audience")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_offering_variants" ADD CONSTRAINT "cms_offering_variants_offering_id_cms_offerings_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."cms_offerings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_offering_variants" ADD CONSTRAINT "cms_offering_variants_service_id_cms_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."cms_services"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_offerings" ADD CONSTRAINT "cms_offerings_page_id_cms_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."cms_pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_offerings" ADD CONSTRAINT "cms_offerings_updated_by_cms_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."cms_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_offering_variants_service_idx" ON "cms_offering_variants" USING btree ("service_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cms_offerings_page_id_key" ON "cms_offerings" USING btree ("page_id");
