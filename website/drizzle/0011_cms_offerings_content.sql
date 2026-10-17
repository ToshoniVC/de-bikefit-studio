-- The offering IS the offer (Beheer → Aanbod, 17 Oct 2026) —
-- docs/cms-architecture.md §14 and docs/booking-architecture.md §14.
--
-- ADDITIVE. Widens `cms_offerings` so one row holds an offer's copy (slug,
-- category, order, title, summary, intro, Doel, Inhoud, extra's, Duur, button
-- label, image, meta description) next to the settings it already held
-- (shown, variants, direct booking or enquiry). `page_id` becomes nullable:
-- the offer pages under /aanbod/ are retired by `npm run cms:migrate-aanbod`,
-- which copies each page's text into its offering row and then deletes the
-- page. No data change here: no row is created, updated or removed. Nothing
-- touches cms_services, cms_provider_services, cms_bookings or a webshop table;
-- existing bookings keep their service id.
--
-- Every statement is guarded (IF NOT EXISTS / DROP NOT NULL is idempotent) so
-- the file is safe to re-run; on neon-http each statement commits on its own,
-- and a run that failed half-way is simply repeated.
--
-- Apply BEFORE deploying a build that contains it: the new build selects these
-- columns on every public page that lists the offer and in Beheer → Aanbod.
-- Until `cms:migrate-aanbod` has run on a database that still has offer
-- pages, the offer lists are empty on the new build (the pages themselves are
-- no longer served); run the two together (staging-runbook.md §19).
ALTER TABLE "cms_offerings" ALTER COLUMN "page_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_offerings" ADD COLUMN IF NOT EXISTS "locale" text DEFAULT 'nl' NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_offerings" ADD COLUMN IF NOT EXISTS "slug" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_offerings" ADD COLUMN IF NOT EXISTS "category" text DEFAULT 'bikefit' NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_offerings" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_offerings" ADD COLUMN IF NOT EXISTS "title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_offerings" ADD COLUMN IF NOT EXISTS "summary" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_offerings" ADD COLUMN IF NOT EXISTS "intro" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_offerings" ADD COLUMN IF NOT EXISTS "goal" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_offerings" ADD COLUMN IF NOT EXISTS "contents" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_offerings" ADD COLUMN IF NOT EXISTS "extras" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_offerings" ADD COLUMN IF NOT EXISTS "extras_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_offerings" ADD COLUMN IF NOT EXISTS "duration" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_offerings" ADD COLUMN IF NOT EXISTS "cta_label" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_offerings" ADD COLUMN IF NOT EXISTS "image" jsonb;--> statement-breakpoint
ALTER TABLE "cms_offerings" ADD COLUMN IF NOT EXISTS "meta_description" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cms_offerings_locale_slug_key" ON "cms_offerings" USING btree ("locale","slug");
