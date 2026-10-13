-- CMS admin session limits and step-up re-authentication — docs/cms-architecture.md §4.
--
-- ADDITIVE ONLY. Adds two nullable columns to `cms_sessions`:
--   absolute_expires_at  hard end of an admin session (sign-in + 8 h), never moved;
--   reauthenticated_at   last full authentication on the session (sign-in or step-up).
-- No DROP, no data change, nothing touches a webshop table.
--
-- Existing rows get NULL in both. That is intended: an existing admin session
-- then ends at `created_at` + 8 h at the latest (or after 15 minutes without a
-- request, whichever comes first), and has no recent re-authentication, so
-- sensitive changes ask for "Bevestig je identiteit" first. Editor and
-- provider sessions are unaffected.
--
-- Both statements are idempotent (IF NOT EXISTS) so the file is safe to re-run.
ALTER TABLE "cms_sessions" ADD COLUMN IF NOT EXISTS "absolute_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cms_sessions" ADD COLUMN IF NOT EXISTS "reauthenticated_at" timestamp with time zone;
