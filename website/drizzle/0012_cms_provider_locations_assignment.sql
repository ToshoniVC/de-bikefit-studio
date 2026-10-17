-- Several locations per provider and "Iedereen" bookings assigned by the
-- beheerder (17 Oct 2026) — docs/booking-architecture.md §16.
--
-- ADDITIVE. Two things:
--  * `cms_business_hours.location_id`: where the provider is during that
--    range; null keeps the old meaning (the provider's default location, else
--    the studio default). Existing rows are untouched, so nothing changes for
--    a provider who never sets it.
--  * `cms_bookings.assignment` ('assigned' | 'pending') and `assigned_at`: a
--    booking made as "Iedereen" while several providers offer the service is
--    'pending' — its provider only holds the slot until a beheerder assigns it
--    (Afspraken → Toewijzen). Every existing booking gets 'assigned'.
-- No row is created, updated or removed; nothing touches cms_services,
-- cms_provider_services or a webshop table.
--
-- Every statement is guarded (IF NOT EXISTS / duplicate_object) so the file is
-- safe to re-run; on neon-http each statement commits on its own, and a run
-- that failed half-way is simply repeated.
--
-- Apply BEFORE deploying a build that contains it: the new build selects these
-- columns on every availability request and on every booking list.
ALTER TABLE "cms_bookings" ADD COLUMN IF NOT EXISTS "assignment" text DEFAULT 'assigned' NOT NULL;--> statement-breakpoint
ALTER TABLE "cms_bookings" ADD COLUMN IF NOT EXISTS "assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cms_business_hours" ADD COLUMN IF NOT EXISTS "location_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cms_business_hours" ADD CONSTRAINT "cms_business_hours_location_id_cms_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."cms_locations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
