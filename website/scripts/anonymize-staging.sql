-- Scrub customer PII in a staging copy of the production database.
-- Run AFTER resetting the staging branch from production. Idempotent.
--
--   psql "$STAGING_DATABASE_URL" -f scripts/anonymize-staging.sql
--
-- Keeps row counts, relationships and IDs intact so the app behaves realistically,
-- but replaces anything personally identifying with deterministic fakes.
--
-- Plain SQL in ONE transaction: if any statement fails, the COMMIT at the end
-- rolls everything back, so a half-scrubbed staging database cannot happen.
-- Check the psql output for errors and re-run after fixing the cause.
--
-- Not touched on purpose: cms_users (staff accounts, needed to sign in),
-- cms_audit_log (staff e-mails; booking entries hold service, slot and
-- provider only), content, services, locations and opening hours.

BEGIN;

-- ---------------------------------------------------------------------------
-- Webshop (legacy)
-- ---------------------------------------------------------------------------

-- Users: mask email + names (keep id so order.userId FKs still resolve).
UPDATE users
SET
  email = 'user+' || id || '@staging.example',
  first_name = 'Test',
  last_name = 'User-' || left(id, 8);

-- Orders: mask shipping addresses.
UPDATE orders
SET shipping_address = 'REDACTED — staging copy';

-- ---------------------------------------------------------------------------
-- Booking (src/db/cms-schema.ts: cmsBookings)
-- ---------------------------------------------------------------------------

-- Customers and guardians: names, e-mail, phone, home address and every
-- free-text field (bike details; notes can hold health data). NULLs stay NULL
-- so optional fields still look optional. The Google event link is cut too:
-- a staging cancellation must never touch a real calendar event.
UPDATE cms_bookings
SET
  customer_name = 'Klant ' || left(id, 8),
  customer_email = 'booking-' || id || '@example.invalid',
  customer_phone = CASE WHEN customer_phone IS NULL THEN NULL ELSE '+32 000 00 00 00' END,
  guardian_name = CASE WHEN guardian_name IS NULL THEN NULL ELSE 'Ouder ' || left(id, 8) END,
  guardian_email = CASE
    WHEN guardian_email IS NULL THEN NULL
    ELSE 'guardian-' || id || '@example.invalid'
  END,
  guardian_phone = CASE WHEN guardian_phone IS NULL THEN NULL ELSE '+32 000 00 00 00' END,
  customer_address = CASE
    WHEN customer_address IS NULL THEN NULL
    ELSE 'Adres verwijderd (staging)'
  END,
  bike_details = CASE WHEN bike_details IS NULL THEN NULL ELSE 'Verwijderd (staging)' END,
  notes = CASE WHEN notes IS NULL THEN NULL ELSE 'Verwijderd (staging)' END,
  google_event_id = NULL,
  google_sync_status = 'none',
  google_sync_error = NULL;

-- Short-lived security data: CMS sessions (production cookies must not work
-- here), login attempts and booking rate-limit rows (IP addresses, e-mails).
TRUNCATE TABLE cms_sessions, cms_login_attempts, cms_booking_rate_limit;

-- Providers: forget every Google connection, exactly like "Google loskoppelen"
-- in the admin (repo.disconnectGoogle). Staging uses its own OAuth client;
-- providers reconnect there if they need to.
UPDATE cms_providers
SET
  google_refresh_token_enc = NULL,
  google_access_token = NULL,
  google_access_expires_at = NULL,
  google_email = NULL,
  google_connected_at = NULL,
  google_calendar_id = NULL,
  google_sync_error = NULL;

COMMIT;
