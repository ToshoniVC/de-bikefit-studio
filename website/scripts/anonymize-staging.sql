-- Scrub customer PII in a staging copy of the production database.
-- Run AFTER resetting the staging branch from production. Idempotent.
--
--   psql "$STAGING_DATABASE_URL" -f scripts/anonymize-staging.sql
--
-- Keeps row counts, relationships and IDs intact so the app behaves realistically,
-- but replaces anything personally identifying with deterministic fakes.

BEGIN;

-- Users: mask email + names (keep id so order.userId FKs still resolve).
UPDATE users
SET
  email = 'user+' || id || '@staging.example',
  first_name = 'Test',
  last_name = 'User-' || left(id, 8);

-- Orders: mask shipping addresses.
UPDATE orders
SET shipping_address = 'REDACTED — staging copy';

COMMIT;
