-- Booking — new CMS role `provider` (Aanbieder).
--
-- ADDITIVE ONLY. Adds one value to the `cms_role` enum. No DROP, no ALTER of
-- any webshop table (`users`, `products`, `orders`, `order_items`).
--
-- Kept in a migration file of its own: Postgres cannot USE a freshly added enum
-- value inside the transaction that added it, so nothing in this file (or in
-- 0003_booking.sql) references 'provider'. Idempotent (IF NOT EXISTS).
ALTER TYPE "public"."cms_role" ADD VALUE IF NOT EXISTS 'provider';
