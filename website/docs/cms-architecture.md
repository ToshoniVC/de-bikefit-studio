# CMS architecture — De Bikefit Studio

Contract document for the Dutch public site + admin built inside the existing
Next.js 16 app. Originally written by Worker A (foundation) for Workers B
(admin UI) and C (public site + SEO + seed); kept current since. Online
booking, Google Calendar and e-mail are documented separately in
[`booking-architecture.md`](./booking-architecture.md); the rules here apply
to them too. Repository-wide conventions: [`../../CLAUDE.md`](../../CLAUDE.md).

**Status:** implemented — schema and migrations, dual-driver DB client,
auth/roles/sessions, block registry, read and write APIs, the admin UI at
`/admin`, the public Dutch site, booking, the consent-gated GA4 tag and the
admin analytics panel. Rollout per environment: `staging-runbook.md`.

**Hard rule that never changes:** the Qarakter webshop (`users`, `products`,
`orders`, `order_items`, `/shop`, `/checkout`, `/account`, Clerk, Stripe)
stays exactly as it is. Every CMS table is prefixed `cms_`, every CMS
migration is additive, and the CMS has its own auth that shares nothing with
Clerk.

---

## 1. Layout

File ownership during parallel work comes from the work-block file (see
`CLAUDE.md` §9), not from this document.

| Area | Paths |
| --- | --- |
| Data | `src/db/cms-schema.ts` (the `cms_*` tables of the CMS and booking), `src/db/cms-mfa-schema.ts` (the four `cms_mfa_*` tables), `src/db/cms.ts` (driver), `drizzle/**`, `drizzle.config.ts` |
| CMS core | `src/lib/cms/{auth,guard,session,password,permissions,blocks,block-primitives,blocks-aanbod,content,offers-content,repo,repo-admin}.ts` |
| Offer ("Aanbod") | `src/lib/offers/{catalogue,defaults}.ts` (plain), `src/lib/studio/seed-content/**` (seed + rollout content), `src/lib/studio/editorial-images.{ts,json}`, `scripts/cms-rollout-aanbod.mts`, `scripts/lib/aanbod-rollout{,-plan,-run}.mts` — see §14 |
| Admin | `src/app/admin/**`, `src/components/admin/**`, `src/lib/cms/actions/**` (server actions + `sanitize.ts`), `src/app/api/cms/media/**` |
| Public site | `src/app/(studio)/**`, `src/components/studio/**`, `src/lib/studio/**`, `src/app/sitemap.ts`, `src/app/robots.ts` |
| Booking | `src/lib/booking/**`, `src/lib/email/**`, `src/app/api/google/oauth/**` — see `booking-architecture.md` |
| Analytics | `src/lib/analytics/{consent,ga4-tag,page-view,ga4,ga4-errors}.ts(x)`, `src/components/studio/{analytics,consent-banner}.tsx`, `src/components/admin/analytics-panel.tsx` |
| Scripts | `scripts/{db-migrate,cms-bootstrap,cms-seed,cms-seed-booking,cms-rollout-aanbod,cms-patch-booking-cta,cms-patch-page-cleanup,cms-patch-cadeaubon,cms-mfa-reset,cms-selftest,cms-retention,import-editorial-image}.mts`, shared helpers in `scripts/lib/`, self-test sections 5b–5f and 15–19 in `scripts/selftest/` |
| Shared | `src/middleware.ts`, `src/lib/env.ts`, `.env.example`, `next.config.ts`, `package.json`, `src/app/layout.tsx` |

---

## 2. Database

### Drivers

`src/db/cms.ts` exposes one function:

```ts
import { getCmsDb, cmsDriver, type CmsDatabase } from '@/db/cms';

const db = await getCmsDb(); // Drizzle instance
cmsDriver();                 // 'neon-http' | 'pglite'
```

| Condition | Driver | Notes |
| --- | --- | --- |
| `DATABASE_URL` set | `neon-http` | Same driver the webshop uses. Staging/production. |
| `DATABASE_URL` unset, not production | `pglite` | Postgres/WASM persisted in `website/.pglite/` (gitignored). Auto-migrates on first use. |
| `DATABASE_URL` unset, production | throws | Production must have a real database. |

`getCmsDb()` is async because PGlite is loaded with a runtime `import()`.
`@electric-sql/pglite` is listed in `next.config.ts` `serverExternalPackages`,
which is what keeps the WASM out of every client/edge bundle.

**Never call `getCmsDb()` from middleware** — middleware runs on the edge
runtime. **Never call it from a client component.**

The webshop's own client (`src/db/index.ts`) and its sample-data fallback in
`src/db/queries.ts` are untouched and still work with no `DATABASE_URL`.

Verified: PGlite runs under `next dev` and under `next build` + `next start`
on Node 24.21.0. The supported minimum is Node 22.15 (`module.registerHooks()`
in the seed and self-test scripts).

### Transactions

`db.transaction()` is a real transaction on PGlite but **throws** on neon-http
(drizzle-orm 0.45: the HTTP driver cannot hold a session, so every statement is
its own READ COMMITTED transaction). **Do not call it in code that also runs on
Neon, and do not rely on rollback.** Order multi-statement writes so a partial
failure still leaves valid data (that is why `publishPage()` writes the snapshot
last), and make anything that must be atomic a single statement: the rate-limit
reservations (§4, Rate limiting) and the status-conditioned delete of
`deletePage()` (§7) are built that way.

### Schema

All tables in `src/db/cms-schema.ts` (the two-step verification tables in
`src/db/cms-mfa-schema.ts`, the public rate-limit counters in
`src/db/cms-rate-limit-schema.ts`), all prefixed `cms_`.

| Table | Purpose |
| --- | --- |
| `cms_users` | CMS operators. `email` lower-cased + unique, `role` (`admin`\|`editor`\|`provider`), scrypt `password_hash`, `must_change_password`, `is_active`, `last_login_at`. |
| `cms_sessions` | Opaque sessions. Stores only `token_hash`, plus `expires_at`, `user_agent`, `ip_address`, and (§4) `mfa_verified_at` (0005), `absolute_expires_at` and `reauthenticated_at` (0006). |
| `cms_login_attempts` | One row per login attempt; drives rate limiting. Pruned opportunistically (>1 day). |
| `cms_pages` | Page record + all SEO fields + `published_snapshot` jsonb. Unique `(locale, slug)` and `(locale, translation_group)`. |
| `cms_blocks` | **Draft** blocks, ordered by `sort_order`. Never read by the public site. |
| `cms_navigation` | One row per `(locale, menu_key)`; `items` is an ordered jsonb array. |
| `cms_media` | Metadata + per-locale `alt` jsonb + `storage` (`db`\|`blob`) + soft-delete `deleted_at`. |
| `cms_media_blobs` | Image bytes for `storage='db'`. **Never hard-deleted.** |
| `cms_redirects` | `from_path` unique → `to_path`, 301/302, `is_enabled`. |
| `cms_site_settings` | `(locale, key)` primary key → jsonb value. |
| `cms_audit_log` | Lightweight who/what/when. Denormalised `user_email` survives user deletion. |
| `cms_integration_settings` | Server-only configuration of an outside service, one row per `key` (today only `email`): `config` jsonb (addresses), `secret_ciphertext` (AES-256-GCM, never plain), `secret_hint` (last four characters). Never read by the public site; only through `src/lib/email/settings.ts` and the admin repo `src/lib/email/repo.ts`. |

Booking adds eight more tables — `cms_locations`, `cms_services`,
`cms_providers`, `cms_provider_services`, `cms_business_hours`,
`cms_availability_exceptions`, `cms_bookings`, `cms_booking_rate_limit` —
described in [`booking-architecture.md`](./booking-architecture.md) §2.
Two-step verification adds five — `cms_mfa_factors`, `cms_mfa_recovery_codes`,
`cms_mfa_challenges`, `cms_mfa_rate_limits` (0007) and `cms_mfa_attempts` (no
longer written since 0007, kept because migrations are additive) — described
in §4. Public rate limits add one, `cms_rate_limits` (0008: the race-free
booking limit; `cms_booking_rate_limit` stays for the gift voucher requests),
described in `booking-architecture.md` §2 and §9. That makes twenty-six
`cms_*` tables in total.

Only two real Postgres enums exist (`cms_role` = `admin`, `editor`,
`provider`; `cms_page_status`). Locale, menu key, block type, media storage and
structured-data type are plain `text` validated by zod, so adding a value later
never needs an `ALTER TYPE`.

### Multi-language

Dutch is the only locale published now, but nothing is hard-coded to it:

- every localisable row has `locale text NOT NULL DEFAULT 'nl'`;
- uniqueness is scoped by locale — `(locale, slug)`, `(locale, menu_key)`,
  `(locale, key)`;
- `cms_pages.translation_group` links the same page across locales. The Dutch
  home page and a future English home page share `translation_group = 'home'`
  but have different slugs.

`DEFAULT_LOCALE` is exported from `@/db/cms-schema`. Dutch is served without a
URL prefix (`publicPathFor()` in `repo.ts` encodes that rule).

### Migrations

| File | Contents |
| --- | --- |
| `drizzle/0000_webshop_baseline.sql` | The four existing webshop tables. Back-fills the migration history that `drizzle-kit push` never created. Fully idempotent (`CREATE TABLE IF NOT EXISTS` + `duplicate_object` guards), so it is a **no-op against the live Neon database** and creates the tables on a fresh one. |
| `drizzle/0001_cms_foundation.sql` | Two enum types + eleven `cms_*` tables + their indexes and foreign keys. **Additive only** — no `DROP`, no `TRUNCATE`, no `ALTER` of any webshop table. Also idempotent. |
| `drizzle/0002_role_provider.sql` | `ALTER TYPE cms_role ADD VALUE IF NOT EXISTS 'provider'`, nothing else. |
| `drizzle/0003_booking.sql` | The eight booking tables, FKs and indexes, all guarded. |
| `drizzle/0004_integration_settings.sql` | `cms_integration_settings` + its FK to `cms_users`, guarded. Code treats a missing table as "nothing stored", so deploying before migrating is safe. |
| `drizzle/0005_cms_admin_mfa.sql` | Two-step verification (§4, MFA): four `cms_mfa_*` tables and one nullable column `cms_sessions.mfa_verified_at`. Additive and guarded; existing sessions get `NULL`, which is what makes existing **admin** sessions sign in again. |
| `drizzle/0006_cms_session_limits.sql` | Admin session limits and step-up (§4, Sessions): two nullable columns, `cms_sessions.absolute_expires_at` and `cms_sessions.reauthenticated_at`. Additive and guarded (`ADD COLUMN IF NOT EXISTS`); existing rows get `NULL`, so an existing admin session ends at `created_at` + 8 h at the latest and has no recent step-up. |
| `drizzle/0007_cms_mfa_rate_limits.sql` | Race-free second-step limits (§4, Rate limiting): the `cms_mfa_rate_limits` table (FK to `cms_users`, two indexes) and a **unique** index `cms_mfa_challenges_user_id_unique_idx` (one challenge per user; the old non-unique index stays). Guarded and re-runnable. Its one data change: duplicate challenge rows of a user (ephemeral sign-in state, at most 10 minutes old) are deleted, the newest kept, in the same locked statement that builds the index. No DROP, no webshop table. |
| `drizzle/0008_cms_rate_limits.sql` | Race-free public booking limit (§4, Rate limiting; `booking-architecture.md` §9): the `cms_rate_limits` table (one row per key, no FK) and its index on `updated_at`, both `IF NOT EXISTS`. No data change, no DROP, no webshop table; `cms_booking_rate_limit` untouched. Migrate **before** deploying the build that uses it: without the table every public booking attempt fails closed (`error`, `[booking] create_failed`). |
| `drizzle/0009_cms_service_choice_label.sql` | `cms_services.choice_label` (text, not null, default `''`): a service's label under an offer with several services ("Volwassene", "Jeugd"; `booking-architecture.md` §14). One `ADD COLUMN IF NOT EXISTS`, no data change. Migrate **before** deploying the build that uses it: the app selects every `cms_services` column. |
| `drizzle/0010_cms_offerings.sql` | Beheer → Aanbod (§15): `cms_offerings` (one row per offer page: shown, variant mode, booking mode; FK to `cms_pages` cascade, unique `page_id`) and `cms_offering_variants` (per variant: booking service, FK set null, and price in cents; PK offering + audience). Guarded `CREATE TABLE`/`INDEX IF NOT EXISTS` and `duplicate_object` FK blocks; no data change, no webshop table, nothing on `cms_services`, `cms_provider_services` or `cms_bookings`. Migrate **before** deploying: without it pages derive their settings from their blocks, but Beheer → Aanbod cannot save and the booking actions fail closed. |

**Rollout order of 0004–0007.** The e-mail settings (from `staging`) and the
security release met in one merge: the MFA and session migrations were
renumbered from 0004/0005 to 0005/0006 with their journal timestamps kept, and
0007 follows them, so the order is 0004 → 0005 → 0006 → 0007 everywhere and
one `db:migrate` applies whichever of them a database still lacks. Set
`CMS_MFA_ENCRYPTION_KEY` first, migrate **before** deploying the security
build (it breaks `/admin/login` without 0005, `/admin` without 0006 and the
admin second step without 0007, whose table and unique index the code checks
against; 0004 is safe either way), then deploy, then let the first admin
enrol; step by step in `staging-runbook.md` §16.
Drizzle's migrator only applies journal entries newer than the last one a
database recorded, so a database that already ran the security migrations
under their old numbers never receives 0004 from `db:migrate`: apply
`drizzle/0004_integration_settings.sql` to it by hand (guarded, safe to
repeat) or, locally, delete `website/.pglite/`.

`drizzle.config.ts` lists the schema files (`schema.ts`, `cms-schema.ts`,
`cms-mfa-schema.ts`, `cms-rate-limit-schema.ts`, `cms-offering-schema.ts`) and falls back to a placeholder URL
so `npm run db:generate` works without `DATABASE_URL`.

Every schema change ships as a named migration, guarded so it can run twice:

```bash
npm run db:generate -- --name=<snake_name>   # commit drizzle/*.sql + drizzle/meta/*
npm run db:migrate                           # PGlite locally, Neon when DATABASE_URL is set
```

**`db:push` is for a throwaway local database only, never for Neon** — it
diffs the live schema and can propose destructive changes.

---

## 3. Draft / publish model

```
cms_blocks  (draft)  --- publishPage() --->  cms_pages.published_snapshot (frozen JSON)
                                                          |
                                                          v
                                            the public site renders ONLY this
```

- Editors change `cms_blocks`. Nothing a visitor sees changes.
- `publishPage()` (admin only) validates **every** block against the registry.
  If any block fails, nothing is written and the issues come back in the error
  message.
- The snapshot freezes blocks **and** SEO **and** title/kind, so a page keeps
  rendering exactly as published even if a block schema later gains a field.
- `unpublishPage()` flips the status back to `draft` but **keeps** the
  snapshot, so re-publishing without edits restores exactly what was live.
- `deletePage()` is a **hard** delete: the row, its draft blocks and the
  snapshot are gone (no trash; only a database backup brings them back). On a
  published page that is at least an unpublish, so it needs `page.unpublish`
  as well (admin only): editors delete drafts, never a live page (§4).
- Snapshot shape: `publishedSnapshotSchema` in `blocks.ts` (`version: 1`).
  Read it back with `parsePublishedSnapshot(value)`, which returns `null` if it
  no longer validates — treat that as "not published".

---

## 4. Auth

`src/lib/cms/{password,session,auth,users,guard,permissions}.ts` and
`src/lib/cms/mfa/*`. Entirely separate from Clerk: Clerk guards the webshop's
`/account` and `/checkout`; this guards `/admin`. Admins and providers sign in
with a password **and** a TOTP code (see "Two-step verification" below;
providers since 16 Oct 2026); editors with a password only, unless they kept
an authenticator. The policy per role is one table there.

### Passwords

Node's built-in `crypto.scrypt` — no native dependency. Stored as a
self-describing envelope so parameters can be raised later without a
migration:

```
scrypt$131072$8$1$<salt-base64>$<hash-base64>
```

New hashes use N = 2^17, r = 8, p = 1 (raised on 13 Oct 2026 from N = 2^15).
scrypt needs about 128 · N · r bytes: **~128 MiB per hash** (the old
parameters were ~32 MiB). Legacy `scrypt$32768$8$1$…` hashes still verify;
`verifyPassword()` refuses parameters outside N ∈ [2^14, 2^17] (power of two)
or above the current memory and CPU cost before running scrypt, so a corrupted
row cannot make it allocate more. After a **successful** sign-in or
re-authentication a legacy hash is replaced by a new one
(`src/lib/cms/password-upgrade.ts`, conditional `UPDATE … WHERE password_hash
= <old>` so a concurrent password change is never overwritten; a failed
upgrade never fails the sign-in). An admin's hash is upgraded at the password
step, before the second step.

Memory and concurrency are bounded per server instance: every scrypt call
(hash and verify) goes through an in-process limiter
(`src/lib/cms/concurrency.ts`) of two at a time (≈ 256 MiB peak) with a short
bounded queue; beyond it sign-in answers "even te druk" instead of piling up
work. With the database-backed login and code rate limits that keeps one
attacker's cost to us small. Details and the numbers in the comment at the top
of `password.ts`.

Verification is constant-time and returns `false` (never throws) on a
malformed hash. An unknown email is still verified against a dummy hash with
the current parameters, so login timing does not reveal which accounts exist.
Residual: until an account signs in once after this change, its legacy hash
answers a wrong password faster (~60 ms against ~250 ms), which tells a
patient guesser, within the rate limits, that the account exists.

Minimum 12 chars, needs lower + upper + digit (`validatePasswordStrength`).

### Sessions

- 32 random bytes, base64url, in the `cms_session` cookie.
- The database stores only `HMAC-SHA256(token, CMS_SESSION_SECRET)`.
  Rotating the secret signs everyone out; a leaked DB dump is not replayable.
- Cookie: `httpOnly`, `sameSite=lax`, `path=/`, `secure` in production.
- Lifetime by role, decided on every request from the user's **current** role
  by the pure `src/lib/cms/session-policy.ts` (unit-tested), applied in
  `resolveSession()`. The class per role is its own table,
  `ROLE_SESSION_POLICY`, deliberately **not** derived from the MFA rule since
  16 Oct 2026 (providers need MFA but keep the standard class; see
  "Session class and MFA are decided separately" below):
  - **Admins** (and, failing closed, any role not in the table): the session
    ends after **15 minutes without a request** and **8 hours after sign-in**
    at the latest, however active the admin is. Each request moves
    `expires_at` to now + 15 min, but never past `absolute_expires_at`
    (stored at sign-in; capped at `created_at` + 8 h, which also covers rows
    from before 0006). The cookie expires at the absolute end, so the browser
    never keeps it longer than the server would accept it; the idle limit is
    enforced on the server (a cookie cannot be refreshed during a plain page
    render). An expired row is deleted on the spot.
  - **Editors and providers**: unchanged, 14 days with sliding renewal (past
    the halfway point a request pushes the expiry back to 14 days). Whether
    they get limits too is a separate decision for the owner (Max); nothing
    changes for them silently, also not now that providers need MFA.
- `last_used_at` is written at most every 30 seconds, with a conditional
  `UPDATE` that only moves it forward and never touches an expired row, so
  parallel requests cannot rewind it or revive a dead session. Consequence:
  the idle limit can end a session up to 30 s early.
- A session that **replaces** another (password change, new authenticator,
  removed factor) inherits its absolute end and its step-up time: replacing a
  session never extends either.
- `mfa_verified_at` is set when the session was created after a successful
  second step. A session is never upgraded in place: the MFA flow creates a new
  one. The guard refuses an admin or provider session without it.
- `reauthenticated_at` is the last **full** authentication on the session:
  the sign-in itself (password and code for admins, providers and editors with
  an authenticator; password for other editors) or a step-up (below). It never
  comes from a password alone for an admin or provider.
- Password change, deactivation and every second-factor change revoke every
  session for that user (`changePassword()` re-issues this browser's session
  with the same MFA state it had).
- UX consequence: an admin who types in an editor for more than 15 minutes
  without saving loses the session; saving then says "Je sessie is verlopen".

### Step-up for sensitive changes ("Bevestig je identiteit")

Some changes need a **recent full authentication on this session**,
within the last **5 minutes** (`REAUTH_WINDOW_MS` in `guard.ts`): creating a
user, changing a role, (de)activating an account, resetting a password, an
admin's or provider's own password change (every role that requires MFA; an
editor's needs only the current password), and changing the e-mail service settings on
`/admin/email` (storing or removing the API key; sender, reply-to and gift
voucher order inbox; reading the status and sending the test message need no
step-up). They call
`requireCmsUser('admin', { recentReauthentication: true })` inside the
library function (`users.ts`; `changePassword()` in `auth.ts` asks for
`recentReauthentication` whenever `roleRequiresMfa()` holds for the user; the e-mail
service writes in `src/lib/email/repo.ts` call
`requirePermission('email.manage', { recentReauthentication: true })`), so a
forged or replayed server-action POST gets exactly the same check as the form;
the guard answers `reauth_required` after the MFA, temporary-password and role
checks (an editor still gets `forbidden`). A stamp in the future (beyond 30 s
of clock skew) or of the wrong type counts as none.

Signing in opens the window. After that, *Bevestig je identiteit* on
*Gebruikers*, *Aanbieders*, *E-mail*, *Mijn account* and `/admin/password`
(`StepUpPanel`, `confirmIdentity()` in `src/lib/cms/mfa/reauth.ts`) asks for
the current password **and** a code or recovery code (admins, providers and
anyone with an authenticator; password only otherwise), checked in that order, rate limited
with the sign-in codes and audited (`auth.step_up`, failures as
`auth.mfa_reauth_failed`), and stamps **this session only**: another browser
of the same user is not unlocked. A step-up changes neither the idle nor the
absolute end.

The MFA management actions (replace the authenticator, new recovery codes,
remove a factor) and the break-glass reset keep their **inline**
re-authentication: password and code in the same request as the change,
stricter than the window. There are no administrative personal-data exports
in the CMS today; any that is added must use `recentReauthentication`.

### Cookies

Every cookie the CMS and the studio site set. None is used for tracking; GA4's
own `_ga*` cookies appear only after consent (§12.7).

| Cookie | Set by | Contents | Flags / lifetime |
| --- | --- | --- | --- |
| `cms_session` | login (`session.ts`); for admins, providers and editors with an authenticator only after the second step | random session token; the DB stores only its HMAC | `httpOnly`, `sameSite=lax`, `path=/`, `secure` in production. Admins: expires at the absolute end (sign-in + 8 h; the 15-minute idle limit is enforced server-side). Editors and providers: 14 days, sliding |
| `cms_mfa` | password sign-in of an admin, a provider or an editor with an authenticator (`src/lib/cms/mfa/challenge.ts`) | random challenge token for the second step; the DB stores only its HMAC. Not a session: no guard reads it | `httpOnly`, `sameSite=lax`, `path=/admin`, `secure` in production; 10 minutes, never extended; one per user (a new password sign-in replaces it); deleted on success, cancel, logout, 5 wrong codes, a password change or an admin's password or MFA reset |
| `cms_google_oauth` | `GET /api/google/oauth/start` (`src/app/api/google/oauth/state.ts`) | provider id, CMS user id, nonce, return target, expiry; HMAC-SHA256 signed with `CMS_SESSION_SECRET` (domain-separated). The callback accepts only a valid signature, an unexpired state, a nonce equal to Google's `state` (constant-time) and the same signed-in user | `httpOnly`, `sameSite=lax`, `path=/api/google/oauth`, `secure` in production; 10 minutes |
| `cms_consent` | the consent banner, client-side (`src/lib/analytics/consent.ts`) | `granted` or `denied` | `SameSite=Lax`, `path=/`, `Secure` on https; 365 days. Not `httpOnly`: the banner and the GA4 loader read it in the browser |

### Rate limiting

Password: 10 failed attempts per 15 minutes, counted per **email OR IP**
(`LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_MS` in `auth.ts`). Exceeding it returns
`error: 'rate_limited'`.

Second step (sign-in, enrolment and replacement codes, recovery codes and
re-authentication alike; policy in `src/lib/cms/mfa/rate-limit-policy.ts`,
enforcement in `rate-limit.ts`): at most 5 counted checks (failed or still
running; a success does not count) for a user **from one IP** or 10 from one
IP for anyone in 15 minutes, or 50 for a user from anywhere in 24 hours
(backstop against guessing from many addresses); while blocked even a correct
code is refused. Each challenge also allows 5 checks
(codes, or the password at the challenge's password step), then the password
must be entered again. Keying the short window on user + IP means someone who
has the password cannot lock the owner out from elsewhere for long; a new
password (`changePassword`, the challenge step, an admin's password or MFA
reset, the break-glass CLI) clears the user's counters (`clearMfaAttempts`;
the IP-wide counter has no owner and runs out after 15 minutes). A new
password **sign-in** resets nothing but the challenge's own 5 slots: the
user/IP and daily counters stay, so signing in again buys no extra codes. An
unknown client IP is not one shared bucket: the user gets one `ip:unknown`
bucket (5 per 15 minutes) and the daily backstop, no IP rule. An unreadable
factor (key rotated) is not counted, so the recovery codes stay usable.

**Reserve, then check.** Every check first reserves one hit in each of its
scopes (`user:<id>|ip:<ip>`, then `ip:<ip>`, then `user:<id>|day`) and, inside
a challenge, one of the challenge's slots; only then is the code or password
looked at. A failure keeps what it reserved; a success, an unreadable factor,
a missing encryption key, a busy password hasher or a step that never checked
anything gives it back. So however many requests run in parallel, at most 5
checks per user + IP (10 per IP, 50 per user per day, 5 per challenge) are in
flight or failed in the window, and successes never count. The consequence for
honest users: a sixth request sent while five are still being checked is
refused (`rate_limited`) even if those five will succeed. Self-test 5f fires
20 parallel wrong codes at sign-in, enrolment, replacement and
re-authentication and parallel password sign-ins, and counts the TOTP checks
that actually ran: 5 each (the earlier count-then-check let all 20 through on
each of the four).

**One statement per reservation (neon-http).** The production driver has no
interactive transactions: every statement is its own READ COMMITTED
transaction (§2, Transactions). A count-then-act check cannot be made safe that
way, not even inside one statement: a `count(*)` over a log table in an
`INSERT … SELECT` or `UPDATE … WHERE` reads a snapshot that misses rows other
requests insert at the same moment (Postgres re-checks only the target row).
So each scope is one row of `cms_mfa_rate_limits` (`scope` primary key,
`hits` an array of timestamps, an exact sliding window), and a reservation is
the single statement

```sql
INSERT INTO cms_mfa_rate_limits (scope, user_id, hits, updated_at) VALUES ($scope, $user, ARRAY[$at], $at)
ON CONFLICT (scope) DO UPDATE
  SET hits = array_append(ARRAY(SELECT h FROM unnest(hits) h WHERE h > $at - $window ORDER BY h), $at)
  WHERE (SELECT count(*) FROM unnest(hits) h WHERE h > $at - $window) < $limit
RETURNING scope   -- no row: limited
```

Postgres locks the conflicting row and evaluates the `WHERE` and `SET` on its
latest committed version, so concurrent reservations of one scope queue on
that row and each sees the hits of those before it. When a later scope is
full, the earlier ones are released. A release removes exactly one occurrence
of its own timestamp (`hits[:pos-1] || hits[pos+1:]`), so equal timestamps of
parallel requests stay correct. A challenge slot is the single
`UPDATE cms_mfa_challenges SET failed_attempts = failed_attempts + 1 WHERE id = $id
AND failed_attempts < 5 AND expires_at > now() RETURNING` (the column now
counts reserved checks; a check that did not count decrements it), and the
failure in the last slot deletes the challenge. Counter rows no reservation
touched for a day are pruned on the way. `cms_mfa_attempts`, the log the old
count-then-act check used, is no longer written (the audit log has every
failure and success) and its remaining rows are pruned after a day as well.

**Public booking (0008).** The anonymous booking form uses the same
reservation, through the shared helper `src/lib/rate-limit.ts` on its own table
`cms_rate_limits` (no user column; the keys are `booking:ip:<ip>` and
`booking:email:<SHA-256 hex>`): 5 attempts per 15 minutes per valid IP and per
e-mail address (customer or guardian), each key on its own, reserved before the
slot is looked at; an attempt that passes keeps its hits. Policy and details in
`booking-architecture.md` §9 (step 3); self-test 14b fires bursts of 20 parallel
attempts and lets exactly 5 through (the earlier count-then-insert let 20 of 20
through). The second-step limiter keeps its own copy of the statements for now;
moving it onto the shared helper is a follow-up.

### API

```ts
import {
  login, logout, changePassword,
  getCurrentCmsUser, getCurrentCmsSession, requireCmsUser, requirePermission,
  CmsAuthError, verifyCredentials, requiresSecondStep,
} from '@/lib/cms/auth';
import { createUser, listCmsUsers, setUserRole, setUserActive, resetUserPassword } from '@/lib/cms/users';

type AuthResult<T> = { ok: true; data: T } | { ok: false; error: AuthError; message: string };

login(input: { email: string; password: string; context?: { userAgent?, ipAddress? } })
  : Promise<AuthResult<{ user: CmsUserPublic; secondStep: boolean }>>
  // secondStep true (admins, providers, editors with an authenticator): only the cms_mfa challenge cookie, NO session
  // secondStep false (editors without an authenticator): the cms_session cookie, as before
logout(): Promise<void>                           // session + challenge; always succeeds
getCurrentCmsUser(): Promise<CmsSessionUser | null> // CmsUserPublic & { mfaVerified, reauthenticatedAt }; React.cache'd
requireCmsUser(role?: CmsRole, options?: {
  allowMustChangePassword?: boolean;
  recentReauthentication?: boolean;               // sensitive change: step-up within 5 min
}): Promise<CmsSessionUser>                       // throws CmsAuthError
requirePermission(permission: CmsPermission, options?: {
  recentReauthentication?: boolean;               // e.g. the e-mail service writes
}): Promise<CmsSessionUser>
changePassword(input: { currentPassword: string; newPassword: string }): Promise<AuthResult<true>>
createUser(input: { email; name; role; password? }): Promise<AuthResult<{ user; temporaryPassword: string | null }>>
```

`CmsAuthError.code` is `'unauthenticated' | 'mfa_required' |
'password_change_required' | 'forbidden' | 'reauth_required'`. The dashboard layout
`src/app/admin/(dashboard)/layout.tsx` calls `requireCmsUser()` and redirects
`password_change_required` to `/admin/password`, `mfa_required` to
`/admin/login?mfa=1` and every other `CmsAuthError` to `/admin/login`; each
page then checks its own permission. `runAction()` turns each code into a
short Dutch form message. Any other failure gets the generic *Er ging iets
mis. Probeer het opnieuw.* and one server line, `[cms] action_failed`, with
nothing of the error: a failed query's message and `params` carry every bound
value (page content, e-mail addresses, password hashes, sealed secrets). User
management moved from `auth.ts` to `users.ts` (file-size rule); `repo.ts` still
re-exports it.

`getCurrentCmsUser()` never returns `passwordHash` (the type is
`CmsUserPublic`). It only says who is signed in; anything that returns CMS
data or writes goes through `requireCmsUser()` / `requirePermission()`. All
messages are Dutch and safe to show to the user.

**Temporary passwords are enforced server-side.** New users, reset passwords,
new providers and the bootstrap admin start with `mustChangePassword = true`.
The guard decision (`cmsAccessDenial()` / `assertCmsAccess()` in
`src/lib/cms/guard.ts`, pure and unit-tested) makes `requireCmsUser()` and
`requirePermission()` throw `password_change_required` for such a session, so
every page, server action and repo call refuses it, including a POST that
never renders the layout. Order: unauthenticated → admin or provider without
MFA → temporary password → role/permission → recent re-authentication (only where
asked). The only ways through are
`requireCmsUser(role, { allowMustChangePassword: true })`, used solely by
`changePassword()` and the `/admin/password` page (it grants no role or
permission), and `login()` / `logout()`, which use no guard. The GA4 panel and
`canPreview()` apply
`cmsAccessDenial()` without throwing; both Google OAuth routes refuse such a
session (and a pre-MFA admin or provider session). The CMS CLIs write through a session, so
they act as the oldest active admin who has chosen their own password **and
enrolled two-step verification** (`scripts/lib/cms-actor.mts`) and stop with an
explanation when there is none: after `cms:bootstrap`, sign in once, replace
the password and set up the authenticator before `cms:seed`. Their session is
created with `mfaVerified`: the operator's database credentials are the
authentication. Self-test sections 5b–5g run the flows on PGlite.

### Two-step verification (MFA) for admins and providers

Mandatory for the `admin` role (since 0005, 13 Oct 2026) and the `provider`
role ("Aanbieder", since 16 Oct 2026, no migration). The rule is one table,
`ROLE_MFA_POLICY` in `guard.ts` (`admin` and `provider`: `required`; `editor`:
`optional`), read through `roleRequiresMfa()`; any role that is not explicitly
`optional` (an unknown or misspelt one included) counts as requiring it, and
the table is a `Record` over `CmsRole`, so a new role cannot be added without
a decision. **Editors are deliberately unchanged** (identified, not changed):
no second step unless they still have an authenticator (e.g. a former admin
or provider), which is then asked at sign-in too; they cannot enrol one
themselves. TOTP only: no SMS, no e-mail codes, no Google or Microsoft
dependency.

**Policy per role** (each row is a use of `roleRequiresMfa()` unless noted):

| | Admin (Beheerder) | Provider (Aanbieder) | Editor (Redacteur) |
| --- | --- | --- | --- |
| Second step at password sign-in (`requiresSecondStep()`, `auth.ts`) | always: challenge, no session | always: challenge, no session | only with an authenticator |
| First sign-in without an authenticator | temporary password replaced in the challenge, then enrolment (QR, ten recovery codes) | same | session with the password alone |
| Session without the second step (guard, `cmsAccessDenial()`) | refused: `mfa_required` | refused: `mfa_required` | accepted |
| Switch MFA off yourself (`removeOwnFactor()`, `manage.ts`) | no, only replace it | no, only replace it | yes, if they have one |
| Step-up "Bevestig je identiteit" (`stepUpNeedsCode()`, `reauth.ts`) | password + code | password + code | password (+ code if they have one) |
| Own password change (`changePassword()`) | needs a recent step-up | needs a recent step-up | current password only |
| *Mijn account* status (`getOwnMfaStatus().required`) | required: no switch-off shown | required | optional |
| *Gebruikers*: "Geen authenticator: moet tweestapsverificatie instellen" | yes | yes | no |
| Reset someone else's MFA (`adminResetUserMfa()`, role rank) | yes, other users, with password + code | no: `forbidden` | no: `forbidden` |
| Session class (`ROLE_SESSION_POLICY`, **not** the MFA rule) | admin: 15 min idle, 8 h absolute | standard: 14 days, sliding (open decision) | standard |

**Session class and MFA are decided separately.** Until 16 Oct 2026 the
session class followed `roleRequiresMfa()`, so making providers require MFA
would have put them on the admin limits as a side effect. `sessionPolicyFor()`
now reads its own table, `ROLE_SESSION_POLICY` in `session-policy.ts`
(`admin: 'admin'`, `editor` and `provider: 'standard'`, any other role
`'admin'`, failing closed). A provider's session after the second step is a
14-day sliding one, exactly as before. Max accepted this for the staging-only
MFA test, not for production. Whether providers (or editors) should get a
shorter lifetime before production is the product owner's decision (below),
made by changing that one entry.

**Role changes** take effect on the next request, because the guard and the
session class read the user's current role: an editor promoted to provider (or
admin) is refused with `mfa_required` at once, keeps the standard session
class as a provider, and enrols at the next sign-in, which also revokes the old
session of that browser. A provider demoted to editor keeps the authenticator
and the MFA session goes on as an editor session; the authenticator is still
asked at sign-in, and the editor may switch it off (*Mijn account*, password +
code). A provider promoted to admin with an MFA session continues as an admin
session at once, held to the admin limits from its sign-in time (a session
older than 8 hours ends). Admins are unchanged. Self-test 5g covers each case.

**Open decisions for the product owner (Max)**, except the stated staging-only
session trade-off, all left as they are:

1. **Provider session lifetime before production.** Standard (14 days,
   sliding) is accepted for the protected staging MFA test only. Providers
   handle customers' names, e-mail addresses, phone numbers and notes in
   *Mijn agenda*, and their Google connection. The admin limits (15 minutes
   idle, 8 hours absolute) could interrupt an appointment; choose a
   provider-specific policy before production. Staging acceptance is not
   production security approval.
2. **No grace period.** From the deploy every provider session is refused
   and each provider enrols at the next sign-in; nobody can postpone it, and
   an admin can no longer create a provider account that signs in with a
   password alone. Is that acceptable for every provider, or is a short,
   explicit grace period (per user, audited) wanted?
3. **Lost device.** A provider who loses the phone signs in with a recovery
   code and replaces the authenticator; with the codes also lost, an admin
   resets it (*Gebruikers*) and hands over the temporary password. Who may ask
   for that, and how is the person verified before the admin acts (call back
   on a known number, in person)?
4. **Editors** stay MFA-optional. Should they follow later?

**The rule, server-side.** The guard order is unauthenticated →
`mfa_required` (an admin or provider session without `mfa_verified_at`; there
is no opt-out) → temporary password → role/permission. A password sign-in of an
admin or provider creates **no session**, only a challenge, so every page,
server action and repo call refuses that state as `unauthenticated`; an old
admin session from before 0005, and a provider session from before 16 Oct 2026,
is refused as `mfa_required`: the dashboard layout, every server action and
repo call (`getOwnProvider()`, bookings, hours, services), both Google OAuth
routes (`cmsAccessDenial()`) and the draft preview. Self-tests 5c (admins) and
5g (providers) call the repos directly with both and check nothing is written.

**Sign-in** (`/admin/login` → `/admin/mfa`, `src/lib/cms/mfa/flow.ts`):

1. Password correct → `cms_mfa_challenges` row + `cms_mfa` cookie (10 min).
   Any session cookie this browser still had is revoked. **One challenge per
   user** (unique index on `user_id`, 0007): a new password sign-in replaces
   the row in one upsert with a new id, token and expiry, so two sign-ins at
   once leave one row, the previous cookie stops working, and an enrolment
   bound to the old challenge id cannot be confirmed through the new one. The
   replacement restarts only the challenge's 5 slots, never the user/IP and
   daily counters (Rate limiting, above).
2. `/admin/mfa` (outside the dashboard group, exempt from the middleware's
   cookie check) shows the next step for that challenge's user only:
   - **no authenticator, temporary password** → choose a password first
     (inside the challenge; still no session);
   - **no authenticator** → enrol: a fresh 160-bit secret, shown once as a QR
     code drawn locally (`uqr` → one SVG path, `qr.ts`) plus the base32 key
     and the `otpauth://` text for 1Password; the first code confirms it,
     creates the session and shows **ten recovery codes once**;
   - **authenticator** → a six-digit code or a recovery code. A challenge
     can never enrol a second authenticator: someone with only the password
     cannot replace the factor.
   Success consumes the challenge (single `DELETE … RETURNING`, so two
   parallel completions cannot both get a session) and creates the session
   with `mfa_verified_at`.
3. A temporary password on an admin or provider who already has an
   authenticator (after an admin's password reset) is changed after the code,
   on `/admin/password`, inside the full session.

A challenge belongs to the password that opened it: a password change
(`changePassword`) and an admin's password reset (`resetUserPassword`) delete
the user's challenges, as the MFA reset and the break-glass CLI already did,
so a browser that got past the old password cannot finish its second step
afterwards (self-test 5f).

**Input bounds.** The server actions (`src/lib/cms/actions/mfa.ts`) check the
shape of every field first, with zod (`actions/mfa-input.ts`, unit-tested):
a code field is trimmed and at most 64 characters (a recovery code typed with
dashes and spaces fits easily), a password field at most
`PASSWORD_MAX_LENGTH` (200, the longest password `validatePasswordStrength()`
lets anyone set; never trimmed), the break-glass target user id at most 64; a
file or any other non-text value fails. Oversized or invalid input gets the
form's usual Dutch message ("Die code klopt niet …", "Je wachtwoord of je code
klopt niet.", …) without any database work and without counting an attempt.

**TOTP** (`totp.ts`, RFC 6238 test vectors in `totp.test.ts`): HMAC-SHA1, 6
digits, 30 s, ±1 step (a code lives at most 90 s). `cms_mfa_factors.
last_used_step` only moves forward through a conditional `UPDATE … WHERE
last_used_step < $step RETURNING`: a replayed code, a code for an earlier step
and the loser of two concurrent uses are all refused (`replayed`).

**Secret at rest** (`crypto.ts`): AES-256-GCM (`src/lib/sealed-box.ts`, shared
with the Google tokens) under the dedicated `CMS_MFA_ENCRYPTION_KEY`, with the
user id as additional authenticated data. Required on every deployment; when
it is missing or malformed there, enrolment and verification fail closed
("niet geconfigureerd") and nothing else is affected. Only local development
and the self-test derive a key from the dev pepper. The secret leaves the
server once, in the enrolment action's response; it is never logged, never in
a URL, never in the database in plain text.

**Recovery codes** (`recovery-codes.ts`): 10 × 16 Crockford-base32 symbols
(80 bits), shown once, stored as `SHA-256("cms-mfa-recovery:v1:<userId>:<code>")`
— sound for random 80-bit inputs, and deliberately independent of every key,
so they still work after `CMS_MFA_ENCRYPTION_KEY` is rotated or lost. One use
each (atomic `UPDATE … WHERE used_at IS NULL`); case, dashes and O/I/L
look-alikes are forgiven. Signing in with one leads to *Mijn account*, which
shows how many are left.

*Why SHA-256 here and not scrypt (a justified exception to "scrypt via
`password.ts`, no other hashing").* The rule is about passwords. A recovery
code is a server-generated random secret of 80 bits (16 symbols × 5 bits, from
`crypto.randomBytes`), not a user-chosen password: brute force against a
leaked hash needs on the order of 2^76 (any of a user's ten) to 2^79 (one
given code) SHA-256 evaluations, so a slow KDF adds cost without adding
security. The stored value is a plain SHA-256 (no key, no
HMAC; the domain prefix and the user id make it unique per user) and is looked
up by equality on the unique `code_hash` column, which a salted KDF would make
impossible. `password.ts` (scrypt) remains the only password hashing anywhere:
a search of the repository for `scrypt`, `bcrypt`, `argon2`, `pbkdf2`,
`createHash` and `createHmac` (13 Oct 2026) finds scrypt only in `password.ts`
(plus the self-test's legacy-hash fixture), no other KDF, and hashes only of
random tokens or non-secret data: session and challenge tokens (HMAC-SHA256,
`session.ts`), booking cancel tokens (SHA-256), the OAuth state and booking
confirmation references (HMAC signatures), TOTP itself (HMAC-SHA1, RFC 6238),
key derivation from `CMS_SESSION_SECRET` (HKDF, `secrets.ts`), the gift
voucher rate-limit key (SHA-256 of an e-mail address), the booking rate-limit
keys (SHA-256 of the customer's and guardian's e-mail address,
`src/lib/booking/rate-limit-policy.ts`, 14 Oct 2026) and content fingerprints
in two CMS scripts.

**Signed-in management** (`manage.ts`, *Mijn account → Tweestapsverificatie*):
replacing the authenticator and making new recovery codes both need the
current password **and** a current code or recovery code in the same request
(password checked first, so a typo never burns a recovery code). A
replacement is bound to the session that started it and confirmed by the new
app's first code; it then deletes the old factor and codes, revokes **every**
session and re-issues this browser's. New recovery codes revoke every other
session. Admins and providers cannot switch MFA off, only replace it; an editor
who kept an authenticator (a former admin or provider) can, with the same
re-authentication.

**Break-glass.** Another admin, re-authenticated with their own password and
code, resets a colleague of any role (a provider included) under *Gebruikers →
Tweestapsverificatie resetten*; providers and editors cannot (`forbidden`, the
function asks for the admin role before anything else):
factors, recovery codes, challenges and sessions are deleted and the password
becomes a temporary one shown once, so whoever enrols next must hold that
password (`user.mfa_reset`). Password and sessions are replaced first, the
factors removed last, so a crash in between never leaves the old password
without a second factor. Not for yourself. With no admin left (or for any
user, a provider included), an operator
with database access runs `npm run cms:mfa-reset -- --email <address>` (dry
run; `--apply --expect-host <host>` to write; `staging-runbook.md` §14, for a
provider §17): same
deletion and revocation, nothing secret printed, audited as
`auth.mfa_break_glass` without an actor. Pass a new temporary password inline
as `CMS_BREAK_GLASS_PASSWORD` (recommended); without it the password is left
alone and whoever knows it can enrol first.

**Audit events:** `auth.login` (password step), `auth.mfa_failed` (with
stage and reason), `auth.mfa_enrol`, `auth.mfa_verify` (method `totp` or
`recovery`, codes left), `auth.mfa_reauth_failed`, `auth.mfa_replace`,
`auth.mfa_recovery_regenerate`, `auth.mfa_remove`, `user.mfa_reset`,
`auth.mfa_break_glass`, `auth.password_change` (also during the challenge),
`auth.step_up`.

**Existing admins (upgrade).** After 0005 and the deploy, an admin's old
session is refused; the dashboard sends them to sign in again, which leads to
the enrolment step with only their password: no lockout, nothing to prepare.
Staging/production need `CMS_MFA_ENCRYPTION_KEY` set *before* that first
sign-in (`staging-runbook.md` §14, combined order §16); while it is missing or
malformed the login page itself says so ("niet geconfigureerd"), before anyone
types a password.

**Existing providers (16 Oct 2026).** No migration: the role, the `cms_mfa_*`
tables and `cms_sessions.mfa_verified_at` exist since 0002/0005. From the
deploy every provider session is refused (`mfa_required`, the dashboard sends
it to `/admin/login?mfa=1`); the next sign-in leads to the enrolment, after
the temporary password is replaced if the provider still has one (the staging
provider has never signed in). Rollout, break-glass and rollback:
`staging-runbook.md` §17.

**Known residual risks** (independent review, 13 Oct 2026; providers added 16 Oct 2026):
- *First come, first enrolled.* An admin or provider without an authenticator
  enrols with the password alone. Between the deploy and that user's first
  sign-in, and after a break-glass reset without a new temporary password,
  whoever holds the password can enrol first. For a provider who never signed
  in that is whoever holds the temporary password printed by
  `cms:seed-booking` or shown when the account was made. Mitigation: the first
  sign-in right after the deploy, temporary passwords on every reset (reset a
  provider's password just before handing it over if the old one may have
  travelled), and `auth.mfa_enrol` in the audit log as the line to watch.
- `auth.login` and *Laatst aangemeld* record the **password** step, so a
  password-only attempt by someone else is visible there; a burst of
  `auth.mfa_failed` after `auth.login` means the password is known to someone
  else: change it.
- A challenge that expires, or is replaced by a new password sign-in, between
  the code check and its consumption costs that code (a TOTP step or one
  recovery code) or, during enrolment, the display of the recovery codes; sign
  in again (and make new codes).
- Re-authentication checks the password before the code, so its timing tells
  a holder of a stolen session cookie which one was wrong; every attempt counts
  against the limits above.
- The limits count checks in flight as well as failures (Rate limiting,
  above): an honest double submit can be answered `rate_limited` while the
  first request is still being checked. The atomicity of a reservation rests
  on Postgres's documented `ON CONFLICT DO UPDATE` row locking; the self-test
  proves the logic on PGlite, which runs one statement at a time, not two
  database sessions racing.
- IPv6: someone rotating addresses (one /64 holds plenty) gets a fresh user +
  IP and IP bucket per address; the daily backstop of 50 checks per user is
  the bound that holds then.
- *Long provider sessions.* A provider's session after the second step keeps
  the standard 14 days, sliding (staging-only decision 1 above): a stolen provider
  session cookie keeps working that long, where an admin's ends after 15 idle
  minutes. Its password and authenticator stay protected (step-up with the
  code; the factor cannot be removed); its own bookings and agenda do not.

### Permission matrix

`src/lib/cms/permissions.ts` is the single source of truth. Use
`can(user.role, permission)` for UI visibility and `requirePermission()` in
every server action. **Hiding a button is not enforcement.**

Three roles (Dutch labels in `ROLE_LABELS`): `admin` (Beheerder) has every
permission; `editor` (Redacteur) does content work and may read booking data;
`provider` (Aanbieder) is a bookable person who sees only their own bookings,
profile, hours and Google connection and has **no access to pages, media,
navigation, redirects or settings**.

| Capability | Permission | Provider | Editor | Admin |
| --- | --- | :-: | :-: | :-: |
| View pages | `page.read` | ❌ | ✅ | ✅ |
| Create page | `page.create` | ❌ | ✅ | ✅ |
| Edit page + SEO | `page.update` | ❌ | ✅ | ✅ |
| Delete page (a published one also needs `page.unpublish`, below) | `page.delete` | ❌ | ✅ | ✅ |
| **Publish page** | `page.publish` | ❌ | ❌ | ✅ |
| **Unpublish page** | `page.unpublish` | ❌ | ❌ | ✅ |
| Edit / add / delete blocks | `block.update` | ❌ | ✅ | ✅ |
| Reorder blocks | `block.reorder` | ❌ | ✅ | ✅ |
| Browse media | `media.read` | ❌ | ✅ | ✅ |
| Upload media | `media.create` | ❌ | ✅ | ✅ |
| Edit alt text | `media.update` | ❌ | ✅ | ✅ |
| Delete media (soft) | `media.delete` | ❌ | ✅ | ✅ |
| View navigation | `navigation.read` | ❌ | ✅ | ✅ |
| Edit navigation | `navigation.update` | ❌ | ✅ | ✅ |
| View redirects | `redirect.read` | ❌ | ✅ | ✅ |
| **Manage redirects** | `redirect.manage` | ❌ | ❌ | ✅ |
| View site settings | `settings.read` | ❌ | ✅ | ✅ |
| **Change site settings** | `settings.update` | ❌ | ❌ | ✅ |
| **Manage users** | `user.read`, `user.manage` | ❌ | ❌ | ✅ |
| **Read audit log** | `audit.read` | ❌ | ❌ | ✅ |
| **E-mail service** (`/admin/email`: key, sender, reply-to, order inbox, test mail) | `email.manage` | ❌ | ❌ | ✅ |
| Beheer → Aanbod: shown, variants, prices, direct booking or enquiry (§15) | `offering.manage` | ❌ | ✅ | ✅ |
| All bookings | `booking.read` | ❌ | ✅ | ✅ |
| Own bookings | `booking.read.own` | ✅ | ❌ | ✅ |
| Cancel / complete any booking | `booking.manage` | ❌ | ❌ | ✅ |
| Cancel / complete own bookings | `booking.manage.own` | ✅ | ❌ | ✅ |
| List services | `service.read` | ✅ | ✅ | ✅ |
| Create a service | `service.create` (repo: `service.manage`) | ❌ | ❌ | ✅ |
| Create, edit, price, deactivate any service | `service.manage` | ❌ | ❌ | ✅ |
| Subscribe own profile to active services | `service.subscribe.own` | ✅ | ❌ | ✅ |
| View locations | `location.read` | ✅ | ✅ | ✅ |
| Manage locations | `location.manage` | ❌ | ❌ | ✅ |
| View all providers | `provider.read` | ❌ | ✅ | ✅ |
| Manage providers | `provider.manage` | ❌ | ❌ | ✅ |
| Own profile, hours, exceptions, Google | `provider.self` | ✅ | ❌ | ✅ |
| GA4 dashboard panel | `analytics.read` | ❌ | ❌ | ✅ |

The provider set is exactly `booking.read.own`, `booking.manage.own`,
`service.read`, `service.subscribe.own`, `location.read`, `provider.self` (the
self-test checks this). `*.own` is resolved server-side from the signed-in
user's `cms_providers` row. Since 16 Oct 2026 the service catalogue is
admin-only: a provider no longer has `service.create`, and a service they
created earlier (`created_by`) gives them no right to edit, price or deactivate
it; they only subscribe their own profile to active services. The *Diensten*
menu item is hidden for providers (`notFor` in `shell.tsx`). Details:
[`booking-architecture.md`](./booking-architecture.md) §3 and §14.

`ROLE_RANK = { provider: 0, editor: 1, admin: 2 }`, so
`requireCmsUser('editor')` keeps providers out of the content screens. Gate
booking screens on permissions, not on rank. The admin sidebar
(`src/components/admin/shell.tsx`) shows each entry only with its permission.

Admins cannot deactivate themselves or drop their own admin role.

Changing the **slug of an already-published page** additionally requires
`page.publish`. Renaming a live page takes its old URL offline immediately and
moves the content elsewhere, which is a publishing act — without this rule an
editor could pull a page off the public site without the publish permission,
contradicting §3's "editors change nothing a visitor sees". Renaming a *draft*
page stays an ordinary `page.update`. Enforced in `updatePageMeta()`
(`repo-admin.ts`).

Deleting a **published page** likewise requires `page.unpublish` on top of
`page.delete` (AZ-1, 14 Oct 2026). A delete is hard (row, draft blocks and
snapshot; no trash), so on a live page it takes the page off the public site at
once — visitors get a 404, the home page included — which is at least an
unpublish. Editors keep `page.delete` for drafts, including a page an admin
took offline (its kept snapshot is not live); any status other than `draft`
counts as live, so a future status fails closed. The rule is
`pageDeleteDenial(role, status)` in `page-policy.ts` (pure, unit-tested):
`deletePage()` checks it after loading the page and refuses with "Een
gepubliceerde pagina verwijderen mag alleen een beheerder. Vraag een beheerder
om de pagina eerst offline te halen." before anything is deleted, audited or
revalidated; the page editor shows the same sentence in place of the delete
form. The check and the delete are two statements (no transaction on
neon-http), so for roles without `page.unpublish` (`mayDeleteOnlyDrafts()`) the
delete statement itself is conditioned on `status = 'draft'`
(`deletePageRow()` in `page-delete.ts`): a page published between the check and
the delete is not removed, and the editor gets the same refusal. Self-test
section 8b runs it through the real `deletePage()` and the statement alone.

### Middleware

`src/middleware.ts` does two independent things and **no database work**:

1. Clerk pass-through for the webshop, unchanged (`/account`, `/checkout`).
2. If the path is under `/admin` and is not `/admin/login` or `/admin/mfa`
   (the second sign-in step, which has no session yet and checks its own
   challenge), and the `cms_session` cookie is absent → redirect to
   `/admin/login?next=<original path>`.

That cookie check is a convenience redirect, **not** the security boundary.
The real check is `requireCmsUser()` / `requirePermission()`, which hit the
database: in the `/admin` layout and again in every page, server action and
repo call. A forged cookie gets past middleware and is rejected there.

---

## 5. Block registry

`src/lib/cms/blocks.ts`. Sixteen block types: eleven derived from the real
prototype (`prototype/index.html`, `prototype/bikefit.html`) and copy decks
(`content/index.html`, `content/about.html`, `content/booking.html`),
`booking` for the online booking widget, and `offer`, `offerCatalogue`,
`giftVoucher` and `team` for the 13 Oct 2026 redesign (defined in `blocks-aanbod.ts` and spread
into the registry; shared field schemas such as `imageRefSchema` live in
`block-primitives.ts` and are re-exported from `blocks.ts`).

```ts
import { blockRegistry, BLOCK_TYPES, defaultDataFor, validateBlock, validateBlocks } from '@/lib/cms/blocks';

blockRegistry.hero.label        // 'Hero'
blockRegistry.hero.description  // Dutch, for the block picker
blockRegistry.hero.schema       // zod schema
blockRegistry.hero.defaultData  // real Dutch copy, ready to insert
defaultDataFor('hero')          // deep clone of the above
```

| Type | Label | Source section |
| --- | --- | --- |
| `hero` | Hero | `.hero` (home) and `.page-head` (subpages) via `variant: 'full' \| 'pageHead'`. `titleEmphasis` reproduces the `<em>` in "Fiets met *comfort.*" |
| `richText` | Tekst | free prose; `html` passes the allowlist sanitiser on every write (see *Rich-text sanitiser* below) |
| `services` | Diensten | "Vier dingen, één positie" and "Vier manieren om te boeken" |
| `process` | Werkwijze | "Hoe verloopt een bikefit?", 4 numbered steps |
| `audience` | Voor wie | "Voor wie is dit?", 5 personas, `featured` for jeugd |
| `faq` | Veelgestelde vragen | 8 Q&A; `emitStructuredData` drives FAQPage JSON-LD |
| `cta` | Oproep | the accent callout, "Comfort is een keuze. Maak ze." |
| `imageText` | Beeld + tekst | `#verhaal`, `#waarom`, `#aan-huis`, `#jeugd` — `imagePosition`, `variant`, optional `quote`/`bullets`/`facts` |
| `pricing` | Prijzen | **no amounts exist anywhere in the source material** — see below |
| `contact` | Contact | phone, city, "Op afspraak" — no street address or e-mail is known |
| `testimonial` | Ervaringen | 4 reviews from the copy deck, all marked placeholder |
| `offer` | Dienst (aanbod) | one offer on `/aanbod/<slug>`: title, intro, the booking button "Boek een afspraak voor deze dienst" (→ `/afspraak?dienst=<slug>#boeken`), Doel, Inhoud, Duur, Kostprijs, Mogelijke extra's. `category` (`bikefit`\|`begeleiding`), `sortOrder`, `summary` (overview card), `bookingServiceSlugs` (see §14). For an unlinked offer, editorial `priceCents`/`priceLabel` and `duration` supply the public text (fallback "Prijs op aanvraag" / "Duur in overleg"). For a linked offer, public duration names each bookable CMS service variant; independent editorial price is ignored in page, card and JSON-LD until approved service-level variant pricing is implemented. The page path is the offer's identity. The editor hint points at `content-placeholders.md`. |
| `offerCatalogue` | Aanbod (overzicht) | grouped overview (Bikefit, Begeleiding, Overige); owns only its title and per-group title/lede — the cards are read from the published offer pages at render time (`listPublishedOffers`), so nothing is duplicated |
| `giftVoucher` | Cadeaubon (bestelformulier) | the gift voucher page `/aanbod/cadeaubon`: page head (owns the `<h1>`) + the order form (amount of choice, personal message, contact details, button "Bestel nu"). Owns only copy (`eyebrow`, `title`, `intro`, `summary` for the card, `formTitle`, `sentTitle`, `sentText`, `sortOrder`); fields, rules and sending are code in `src/lib/gift-voucher/` (server action → `sendEmail` to the order inbox from `/admin/email` / env `GIFT_VOUCHER_RECIPIENT`, never `contact.email`; success only when Resend accepted it). Its page becomes a card in category `overige` ("Bedrag naar keuze") and is never a booking target. Ops: `booking-runbook.md` §12 |
| `team` | Team | profiles: name, role, bio paragraphs (verified text only), image; without an image the initials are drawn. `internalNote` is never rendered and names the person's open register rows; interim profiles end with "Een uitgebreid profiel volgt binnenkort." |
| `booking` | Afspraak boeken | the booking widget on `/afspraak` (service → provider → day → slot → details → confirmation). Carries copy and a filter only: `serviceIds` (empty = every active service), `showProviderChoice` (AND-ed with the `booking.showProviderChoice` setting), `successTitle`, `successText` (empty → `booking.confirmationText`). Services, providers and live availability are read at render time through `@/lib/booking/content`, so nothing in the block goes stale. |

Most blocks share `variant: 'default' | 'gray' | 'dark'`, matching the
prototype's white / `--gray` / `--dark` section backgrounds.

**Two blocks ship with `isPlaceholder: true` and are not rendered publicly
while that flag is set:**

- `pricing` — the prototype and copy decks contain **no prices at all**. Only
  durations are known (90 min adult, ~60 min youth, up to two hours for
  complex fits). `content/booking.html` explicitly records "prijzen tonen?" as
  an open question. Default plans carry `priceCents: null`.
- `testimonial` — the four reviews are illustrative copy from
  `content/index.html`, explicitly flagged to be replaced before launch.

A published snapshot that contains a block type the running code does not
know fails `parsePublishedSnapshot()` and the page is treated as unpublished.
Deploy code that adds a block type **before** publishing pages that use it
(this is why `/afspraak` is refreshed after the booking deploy, see the
staging runbook).

### Rich-text sanitiser

`src/lib/cms/actions/sanitize.ts` is the one place that decides which markup
may reach `dangerouslySetInnerHTML` on the public site (besides code-generated
JSON-LD and gtag). `repo.updateBlock()` runs `sanitizeBlockData()` on every
block write before validation, so the admin action and `scripts/cms-seed.mts`
(which writes through the repo) store exactly the same thing;
`rich-text.tsx` renders the stored HTML as-is.

`sanitizeRichTextHtml()` is an **allowlist** built on `sanitize-html`, applied
to every `html` field:

- Tags: `p`, `br`, `h2`, `h3`, `h4`, `ul`, `ol`, `li`, `a`, `strong`, `b`,
  `em`, `i`, `blockquote`. Any other element is unwrapped (its text kept);
  `script`, `style`, `iframe`, `svg`, `template` and similar are removed
  together with their content.
- Attributes: only `href`, `title`, `rel`, `target` on `a`; none elsewhere, no
  classes, no styles. `href` must be relative, an anchor, or `http`, `https`,
  `mailto`, `tel` (protocol-relative `//…` is refused).
  `target="_blank"` always gets `rel="noopener noreferrer"`; any other
  `target` is dropped.
- Empty `p` and `h2`–`h4` are dropped. The function is idempotent.

Link-ish fields in any block (`href`, `url`, `mapEmbedUrl`, `phoneHref`,
`website`, `canonicalOverride`) are rejected with a Dutch message when they use
`javascript:`, `data:`, `vbscript:` or `file:`.

The admin's rich-text field has two modes, both storing HTML: **Tekst** (a
plain textarea; `plainTextToHtml` in `src/lib/cms/rich-text-plain.ts` turns
blank-line separated text into escaped `<p>` paragraphs) and **HTML** (the
source itself, for pages that need headings, lists and links, such as the
privacy statement and the terms). A block whose stored HTML already uses more
than `<p>`/`<br>` opens in HTML mode, so saving it never flattens it; switching
it to Tekst asks for confirmation because that conversion is lossy. The
client-side helpers never import `sanitize-html`; the allowlist runs on the
server only. Change the allowlist only together with a test in
`sanitize.test.ts`.

### Validation

```ts
validateBlock(type: string, data: unknown): { ok: true; data } | { ok: false; message }
validateBlocks(blocks: { id?; type; data }[])
  : { ok: true; blocks: BlockInstance[] } | { ok: false; issues: BlockValidationIssue[] }
```

`validateBlocks` applies zod defaults, so the normalised output is what gets
frozen into a snapshot. `publishPage()` calls it; nothing can be published
without passing.

### Navigation shape

`cms_navigation.items` is an ordered jsonb array — chosen over normalised rows
because menus are small, always read and written whole, and drag-to-reorder
becomes a single `UPDATE`.

```jsonc
[
  { "label": "Bikefit", "href": "/bikefit", "external": false, "group": "",
    "children": [{ "label": "Jeugdfit", "href": "/bikefit#jeugd", "external": false }] }
]
```

`group` exists for the footer's labelled columns (Studio / Bikefits / Contact
in the prototype). Validate with `validateNavigationItems(items)`.

### Site settings keys

`cms_site_settings` values are validated per key by `siteSettingSchemas`:

| Key | Contents |
| --- | --- |
| `site` | `name`, `tagline`, `strapline`, `mission`, `logoMediaId` |
| `contact` | `phoneLabel`, `phoneHref`, `email`, `addressLines`, `postalCode`, `city`, `country`, `hours`, `website` |
| `seo` | `defaultMetaTitle`, `titleTemplate`, `defaultMetaDescription`, `defaultOgImageMediaId`, `allowIndexing` |
| `organization` | `type`, `legalName`, `vatNumber`, `sameAs`, `priceRange`, `areaServed`, `latitude`, `longitude` — the Organization / LocalBusiness JSON-LD source |
| `analytics` | `ga4MeasurementId` (reference only; the tag reads `NEXT_PUBLIC_GA4_MEASUREMENT_ID`), `ga4PropertyId` (numeric GA4 property for the admin panel; env `GA4_PROPERTY_ID` wins), `enabled` (default **false**; the tag and banner load only when true) |
| `booking` | `slotStepMinutes` (30), `minNoticeHours` (24), `horizonDays` (56), `defaultBufferAfterMinutes` (15), `cancelUntilHours` (48), `timezone` (`Europe/Brussels`), `introTitle`, `introText`, `confirmationText`, `showProviderChoice` (true) — the booking rules, see `booking-architecture.md` §4 |

Admin → Instellingen has one form per key: Site, Contact, SEO, Organisatie
(JSON-LD), Afspraken, Analytics.

The e-mail service is deliberately **not** a site setting (site settings are per locale and
read by the public site): it lives in `cms_integration_settings` and on its own admin page,
**Beheer → E-mail** (`/admin/email`, permission `email.manage`, admins only). The table
comes with migration 0004; until it is applied the page shows a notice and refuses to save,
and sending uses the env variables alone.

- **Status:** API key (source: env / admin / none; the admin sees only the last four
  characters, or "kan niet meer ontsleuteld worden" after a `CMS_SESSION_SECRET` rotation),
  sender, reply-to and the gift voucher order inbox, each with its source.
- **API-sleutel:** write-only password field. The key is sealed with AES-256-GCM
  (`seal()` in `src/lib/sealed-box.ts`, the helper the Google tokens and TOTP secrets use)
  under HKDF-SHA256(`CMS_SESSION_SECRET`, info `email-service-credential`) (`derivedSecret()`
  in `src/lib/secrets.ts`) and never returned to any client, not even masked; "Opgeslagen
  sleutel verwijderen" clears it. Rotating `CMS_SESSION_SECRET` makes a stored key
  unreadable: nothing is sent with it until an admin pastes it again.
- **Step-up:** storing or removing the key and saving sender, reply-to or order inbox are
  sensitive changes (they could swap the sending account or divert visitors' orders): they
  need a full re-authentication on this session within the last 5 minutes (*Bevestig je
  identiteit* on the page, §4). Reading the status and the test message need none.
- **Afzender en ontvangers:** sender (`naam@domein` or `Naam <naam@domein>`, no quotes or
  control characters), optional reply-to, *Ontvanger bestellingen en aanvragen* (one address;
  never a fallback to `contact.email`, see `src/lib/gift-voucher/recipient.ts`).
- **Testbericht:** sends one real message on an explicit click (with a confirm).
- Per field an env variable (`RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`,
  `GIFT_VOUCHER_RECIPIENT`) wins over the admin value; the page says so.
- Audit actions `email.settings.update` (metadata: names of the changed fields),
  `email.key.set`, `email.key.clear` (no metadata) and `email.test` (masked address,
  `sent`, a reason code). No value, key, ciphertext or hint is ever audited or logged: a
  failed key write logs `[email] api_key_store_failed`, an unreadable settings row
  `[email] stored_settings_unreadable` (usually migration 0004 not applied; the environment
  variables still apply), both without anything of the error.

`getSiteSettings()` always returns every key with schema defaults filled in, so
it never throws and never returns `undefined` fields.

**`seo.allowIndexing` defaults to `false`.** Worker C: `robots.ts` must emit
`Disallow: /` while it is false. Staging must not be indexed.

---

## 6. Content read API (Worker C)

`src/lib/cms/content.ts` — `server-only`. Together with its booking
counterpart `src/lib/booking/content.ts` (services, providers, live
availability; `booking-architecture.md` §5), this is the **only** way the
public site reaches the database. Do not import `@/db/cms` directly.

```ts
import {
  getPublishedPage, listPublishedPages, getNavigation, getSiteSettings,
  findRedirect, listRedirects, getMedia, getMediaBytes,
  mediaUrl, mediaAlt, normalizeSlug, normalizeRedirectPath, CMS_TAGS,
} from '@/lib/cms/content';

getPublishedPage(locale: string, slug: string): Promise<PublishedPage | null>
listPublishedPages(locale?: string): Promise<PublishedPageSummary[]>   // for sitemap.ts
getNavigation(locale: string, key: 'main' | 'footer'): Promise<NavigationItem[]>
getSiteSettings(locale?: string): Promise<SiteSettings>
findRedirect(path: string): Promise<{ toPath: string; statusCode: number } | null>
getMedia(id: string): Promise<CmsMediaItem | null>
getMediaBytes(id: string): Promise<{ data: Buffer; mimeType: string; filename: string } | null>
// src/lib/cms/offers-content.ts — composed from the two cached page readers above
listPublishedOffers(locale): Promise<CatalogueOffer[]>   // every published `aanbod/*` page with an `offer` block, sorted
mediaUrl(media): string   // '/api/cms/media/<id>' for db-stored, the CDN URL for blob
mediaAlt(media, locale): string
```

Home page slug is the empty string; `normalizeSlug()` strips leading/trailing
slashes, so `'/'`, `''` and `'/bikefit/'` all behave.

### Caching

Every reader is wrapped in `unstable_cache` with tags from `CMS_TAGS` and a
300-second fallback revalidation. `cacheComponents` / `use cache` is **not**
enabled in this app, so `unstable_cache` is the supported API here (see
`node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`).

Values crossing that boundary are serialised, so **every date in these return
types is an ISO string, not a `Date`**.

`findRedirect()` is for a `not-found` boundary or a route handler — **not**
middleware, which must stay database-free.

---

## 7. Write API (Worker B)

`src/lib/cms/repo.ts` (plus `repo-admin.ts`) — `server-only`. Wrap these in
`'use server'` actions under `src/lib/cms/actions/**`. Do not call
`getCmsDb()` from an action directly; going through the repo is what
guarantees the permission check, the audit entry and the cache bust all
happen. Booking writes go through `src/lib/booking/repo.ts` the same way
(`booking-architecture.md` §5).

```ts
type RepoResult<T> = { ok: true; data: T } | { ok: false; message: string };  // message is Dutch

// Pages
listPages(locale?): Promise<PageListItem[]>
getPageForEdit(pageId): Promise<{ page: CmsPage; blocks: CmsBlock[] } | null>   // DRAFT blocks
createPage({ locale?, slug, title, kind?, translationGroup? }): Promise<RepoResult<CmsPage>>
updatePage(pageId, { slug?, title?, kind?, translationGroup?, ...PageSeo }): Promise<RepoResult<CmsPage>>
deletePage(pageId): Promise<RepoResult<true>>   // HARD delete; a published page also needs page.unpublish

// Blocks (draft)
addBlock(pageId, type: BlockType, position?): Promise<RepoResult<CmsBlock>>
updateBlock(blockId, data: unknown): Promise<RepoResult<CmsBlock>>   // validated against the registry
deleteBlock(blockId): Promise<RepoResult<true>>
reorderBlocks(pageId, orderedBlockIds: string[]): Promise<RepoResult<true>>

// Publishing (admin only)
publishPage(pageId): Promise<RepoResult<CmsPage>>     // freezes the snapshot
unpublishPage(pageId): Promise<RepoResult<CmsPage>>   // keeps the snapshot

// Navigation
updateNavigation(locale, menuKey, items: unknown): Promise<RepoResult<true>>

// Media
createMedia({ filename, mimeType, data, width?, height?, alt?, storage?, storageKey?, url? })
listMedia(includeDeleted?): Promise<CmsMedia[]>
updateMediaAlt(mediaId, alt: Record<string, string>): Promise<RepoResult<true>>
deleteMedia(mediaId): Promise<RepoResult<true>>   // SOFT delete only
restoreMedia(mediaId): Promise<RepoResult<true>>

// Redirects / settings / audit (admin only)
listAllRedirects(): Promise<CmsRedirect[]>
createRedirect({ fromPath, toPath, statusCode?, isEnabled?, notes? })
updateRedirect(redirectId, partial)
deleteRedirect(redirectId)
updateSiteSetting(locale, key: SiteSettingKey, value: unknown)
listAuditLog(limit?): Promise<CmsAuditLogEntry[]>
getAdminStats(): Promise<{ pages; published; media; redirects }>

// Users (re-exported from auth.ts)
createUser, listCmsUsers, setUserRole, setUserActive, resetUserPassword

// Cache
revalidateContent({ tags?: string[]; paths?: string[] }): void
publicPathFor(locale, slug): string
```

Media limits enforced in `createMedia`: 8 MB, and
`image/jpeg|png|webp|avif|svg+xml` only.

**Media deletion is always soft.** `cms_media_blobs` rows are never removed, so
an image still referenced by an older published snapshot can always be
recovered.

**Page deletion is hard.** `deletePage()` removes the row, its draft blocks (by
cascade) and the published snapshot; there is no trash. It needs `page.delete`,
and for a page that is not a draft also `page.unpublish` (§4,
`pageDeleteDenial()` in `page-policy.ts`). An editor deleting a published page
gets `{ ok: false, message }` with the Dutch reason, checked after the page is
loaded and before anything is deleted, audited or revalidated. The delete
statement (`deletePageRow()`, `page-delete.ts`) repeats the rule: for roles
without `page.unpublish` it is `DELETE … WHERE id = $id AND status = 'draft'
RETURNING id`, so a page published between the check and the delete is not
removed. No row back means the same refusal while the page still exists, or
"Pagina niet gevonden." once it is gone, again without an audit entry or a
cache bust. Allowed deletes are unchanged: one `page.delete` audit entry, then
the page's cache tags and public path are busted.

### `revalidateContent()` and the Next 16 cache API

Two things changed in Next 16 that will bite you:

- `revalidateTag(tag)` with **one** argument is deprecated and fails
  typechecking. The signature is `revalidateTag(tag, profile)`, e.g.
  `revalidateTag('cms:pages', 'max')`.
- `updateTag(tag)` is the server-action-only variant that gives
  read-your-own-writes — the editor sees the published page immediately.

`revalidateContent()` already handles both: it tries `updateTag` and falls back
to `revalidateTag(tag, 'max')` outside a server action. Use it rather than
calling the Next APIs yourself.

---

## 8. Media storage: Postgres now, Vercel Blob later

Default is `storage: 'db'` — bytes in `cms_media_blobs.data` (`bytea`). That
works on staging with no Vercel Blob credentials, which is the whole point.

Serve them from a route handler (**Worker B owns this file**):

```ts
// src/app/api/cms/media/[id]/route.ts
import { getMediaBytes } from '@/lib/cms/content';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;                     // Next 16: params is a Promise
  const media = await getMediaBytes(id);
  if (!media) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(media.data), {
    headers: {
      'Content-Type': media.mimeType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
```

Driver gotcha: PGlite returns `bytea` as a `Uint8Array`, neon-http returns the
hex-escape string `\x89504e47…`. `toBuffer()` in `content.ts` normalises both —
always go through `getMediaBytes()`.

**Switching to Vercel Blob later** (no migration needed):

1. `npm i @vercel/blob`, set `BLOB_READ_WRITE_TOKEN` in Vercel.
2. In the upload action, `put()` the file, then call `createMedia({ …,
   storage: 'blob', storageKey: <pathname>, url: <blob url> })` and skip the
   `cms_media_blobs` insert.
3. `mediaUrl()` already returns `media.url` for `storage: 'blob'`, so nothing
   else changes.
4. Existing `db` rows keep working — the two backends coexist per row.

---

## 9. Environment variables

The full contract (every variable, per environment, secret or not) is in
[`../DEPLOYMENT.md`](../DEPLOYMENT.md) §5. The ones the CMS itself reads:

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | deployed envs | Neon pooled URL. Unset locally → PGlite. |
| `CMS_SESSION_SECRET` | deployed envs | Pepper for session-token hashing; also signs the `cms_google_oauth` cookie and the booking confirmation link, and is the key source for the e-mail API key stored in `/admin/email` (§5). `openssl rand -base64 48`. Rotating it signs everyone out and makes that stored key unreadable (paste it again). |
| `CMS_MFA_ENCRYPTION_KEY` | deployed envs | base64 of 32 bytes (`openssl rand -base64 32`), own value per environment. Encrypts the TOTP secrets of admins and providers (and of editors who chose one). Missing on a deployment → admins and providers cannot finish signing in (fail closed). Rotating it makes stored authenticators unreadable: they sign in with a recovery code and replace the authenticator. Local development falls back to a derived key. |
| `CMS_BOOTSTRAP_PASSWORD` | bootstrap only | Pass inline to `npm run cms:bootstrap`. Never store it in `.env.local` or in Vercel. |
| `NEXT_PUBLIC_SITE_URL` | deployed envs | Canonical origin for canonicals, sitemap, OG, e-mail links and the Google OAuth redirect URI. `siteUrl()` in `src/lib/env.ts` falls back to `NEXT_PUBLIC_APP_URL`, then `VERCEL_URL`, then localhost; the Google OAuth redirect URI does not use those fallbacks outside development (`booking-architecture.md` §7). |
| `NEXT_PUBLIC_GA4_MEASUREMENT_ID` | no | GA4 tag id. Loaded only when valid, `analytics.enabled` is true and the visitor consented (§12.7). Build-time. |
| `GA4_PROPERTY_ID`, `GA4_SERVICE_ACCOUNT_JSON` | no | Admin analytics panel (GA4 Data API). |
| `CMS_PGLITE_DIR` | no | Override the local PGlite directory. |
| `CMS_PGLITE_AUTO_MIGRATE` | no | `"false"` disables auto-migration on first PGlite use. |

Booking variables (Google OAuth, token encryption key, Resend): see
`booking-architecture.md` §10. New code reads variables through
`src/lib/env.ts` only (`CLAUDE.md` §3). `.env.example` has a placeholder and a
one-line comment for every variable and is tracked (`!.env.example` in
`.gitignore`) while real `.env*` files are not.

---

## 10. Running it

### Local (PGlite, zero credentials)

```bash
cd website
npm ci
npm run db:migrate                                      # creates website/.pglite/
CMS_BOOTSTRAP_PASSWORD='<strong password>' npm run cms:bootstrap
npm run dev            # sign in at /admin/login, choose a new password, set up the authenticator, stop the server
npm run cms:seed                                        # Dutch pages, menus, redirect
npm run cms:seed-booking                                # first provider (temp password printed once)
npm run dev
```

`cms:bootstrap` is idempotent — it creates the admin `contact@toshoni.be`
(role `admin`, `must_change_password = true`), the six default `nl` site
settings (`site`, `contact`, `seo`, `organization`, `analytics`, `booking`),
empty `main` + `footer` menus, the two locations and the five services.
Running it twice changes nothing.

`cms:seed` writes as an admin who has chosen their own password and enrolled
two-step verification (§4), so the bootstrap password is replaced and the
authenticator set up first; until then it stops with an explanation.
Stop the dev server before running a script: both would open the same
`.pglite/` directory. `cms:seed-booking` writes directly and needs no sign-in.

Reset the local database by deleting `website/.pglite/` and re-running the
commands.

Checks (all six are the Definition of Done in `CLAUDE.md` §2):

```bash
npm run typecheck && npm run lint && npm run format:check
npm test               # vitest unit tests
npm run cms:selftest   # sections 1–19 + 5b–5f: migrations … forced password change, MFA, session limits, MFA under concurrency … full booking flow, rollouts and patches, e-mail service, on a throwaway PGlite
npm run build
```

### Staging and production (Neon + Vercel)

Environments, the Hobby-plan staging setup (previews of the `staging` branch
with branch-scoped variables) and the env var contract are in
[`../DEPLOYMENT.md`](../DEPLOYMENT.md). The step-by-step procedure — migrate,
bootstrap, seed, env vars, deploy, first login, rollback and the production
checklist — is [`staging-runbook.md`](./staging-runbook.md). Deployments are
executed by the DevOps agent Arend; production needs an explicit go.

Keep `seo.allowIndexing = false` on staging.

### Rollback

Baseline tag: **`webshop-baseline-2026-09-23`**
(`a793d1e8105bf125087fd3e78660eb5010726b8d`), plus a full-history bundle at
`.winston/repos/de-bikefit-studio/baselines/webshop-baseline-2026-09-23.bundle`.

```bash
# revert the app code only
git checkout webshop-baseline-2026-09-23 -- website

# or restore the whole repository from the bundle
git clone .winston/repos/de-bikefit-studio/baselines/webshop-baseline-2026-09-23.bundle restored
```

Database rollback: nothing needs undoing. All migrations (0000–0009) are
additive, so the webshop tables and data are byte-identical before and after.
If you want the CMS gone from a database, drop the twenty-six `cms_*` tables
and the two `cms_*` enum types — no webshop object references them.

---

## 11. Next 16 notes that will trip you up

1. **`middleware.ts` is deprecated** in favour of `proxy.ts`; every build prints
   a warning. We keep `middleware.ts` because Clerk's `clerkMiddleware`
   expects that filename. Do not rename it. (The build output labels it
   `ƒ Proxy (Middleware)`.)
2. **`revalidateTag(tag)` needs a second argument** — see §7.
3. **`cookies()`, `headers()` and route `params` are async.** `await cookies()`,
   `const { id } = await params`.
4. Cookie writes are only legal in a server action or route handler. The
   sliding-session cookie refresh in `getCurrentCmsUser()` (editors and
   providers) is wrapped in try/catch for exactly that reason — during a plain
   render the session is still extended in the database, just not in the
   cookie. Admin cookies need no refresh: they expire at the absolute end.
5. **Turbopack is the default builder.** `serverExternalPackages` is what keeps
   `@electric-sql/pglite` out of the bundles.
6. Folders starting with `_` are private and are **not** routed.
7. `React.cache` is used for per-request dedupe (`getCurrentCmsUser`);
   `unstable_cache` for cross-request caching. They are not interchangeable.

---

## 12. The public site (Worker C)

Added with the Dutch public site. Nothing in `src/lib/cms/*` changed.

### 12.1 Routing

| URL | File | Notes |
| --- | --- | --- |
| `/` | `src/app/(studio)/page.tsx` | Dutch home page, slug `''` |
| `/<anything>` | `src/app/(studio)/[...slug]/page.tsx` | published page → redirect → 404, in that order. Includes the seeded `/afspraak` (booking block), `/privacy` and `/algemene-voorwaarden`, and nested slugs such as `/aanbod/voetanalyse` (`cms_pages.slug = 'aanbod/voetanalyse'`; the breadcrumb shows published ancestors and is visible only on such nested pages — top-level pages keep just the `BreadcrumbList` JSON-LD). Reads `?dienst=` (validated by `parseServiceParam`) for the booking block only |
| `/afspraak/bevestigd` | `src/app/(studio)/afspraak/bevestigd/page.tsx` | booking confirmation; `?ref=` is an HMAC-signed summary without personal data; `noindex` |
| `/afspraak/annuleren/[token]` | `src/app/(studio)/afspraak/annuleren/[token]/page.tsx` | customer cancellation by e-mailed token; `noindex` |
| `/og` | `src/app/(studio)/og/route.tsx` | generated 1200×630 share card |
| `/sitemap.xml`, `/robots.txt` | `src/app/{sitemap,robots}.ts` | from the CMS |
| `/api/cms/media/[id]` | `src/app/api/cms/media/[id]/route.ts` | media bytes stored in Postgres |
| `/api/google/oauth/start`, `/api/google/oauth/callback` | `src/app/api/google/oauth/*/route.ts` | Google Calendar connect flow for providers (`booking-architecture.md` §7) |
| `/webshop` | `src/app/(webshop)/webshop/page.tsx` | the old Qarakter home page, moved verbatim |

Dutch is served from the root with no locale prefix. Nothing hard-codes `'nl'`:
`locale` is an explicit argument everywhere and the routes pass
`defaultLocale` from `src/lib/studio/locale.ts`, which also owns `localePath()`,
`localeTag()` (`nl-BE`) and `ogLocale()` (`nl_BE`). Adding `/en` later means
adding a locale to `LOCALES` and a `[locale]` segment — not a rewrite.

A catch-all is the lowest-priority match in Next's routing table, so every
webshop and admin route still wins: `/shop`, `/checkout`, `/account`, `/blog`,
`/policies/*`, `/sign-in`, `/sign-up`, `/webshop`, `/admin/*`, `/api/*`.

Redirects are resolved in the catch-all (301 → `permanentRedirect` → HTTP 308,
302 → `redirect` → HTTP 307), **not** in middleware, which must stay
database-free. The request's query string is carried over
(`src/lib/cms/redirect-target.ts`; parameters in the stored target win), so
`/contact?dienst=coaching` lands on `/afspraak?dienst=coaching`.

### 12.2 Layout split

`src/app/layout.tsx` is now a bare document shell (`<html lang="nl">`, both
fonts, `ClerkProvider` when Clerk is configured, `metadataBase`). The two sites
bring their own chrome:

- Studio → `src/app/(studio)/layout.tsx` + `src/components/studio/*`
- Webshop → `src/components/shell/webshop-chrome.tsx`, mounted by a `layout.tsx`
  in `(shop)`, `(auth)`, `(content)`, `(webshop)` and `/account`, which also
  re-declare the `%s · Qarakter` title template.

### 12.3 Design system

`prototype/design-system/*` is ported into `src/app/globals.css`, additively:
raw values as `--color-ds-*` in `@theme`, the semantic tier as `--ds-*` on
`.studio-root`, and every component rule prefixed `studio-` and scoped under
`.studio-root`. The webshop's own tokens and classes are untouched.

### 12.4 Rendering and caching

Every CMS-backed route is `export const dynamic = 'force-dynamic'`. The data
reads are still tag-cached by `content.ts`, so a page render is a thin shell
around a cached read, but publishing goes live immediately instead of at the
next deploy. It also keeps `next build` free of any database requirement, which
matters because `src/db/cms.ts` refuses PGlite when `NODE_ENV=production`.

**What a failed read logs.** The booking section and the offer catalogue never
break the page when their reads fail (the section falls back to "bel ons", the
catalogue renders nothing). Each logs a fixed code only,
`[booking] widget_data_unavailable`, `[booking] offer_catalogue_unavailable` or
`[aanbod] catalogue_unavailable`, never the error: a failed query's message
holds the SQL and its bound values. A failure in a page's other reads
(`getSiteSettings()`, the page itself) is not caught and is printed by Next in
full (§13).

### 12.5 Structured data

`src/lib/studio/jsonld.ts` builds one `@graph` per page. The layout emits
`LocalBusiness` (type from `organization.type`) + `WebSite`; each page emits
`WebPage`/`AboutPage`/`ContactPage`, `BreadcrumbList` (non-home), `FAQPage`
when a `faq` block has `emitStructuredData`, and `Service` nodes for bookable
fits. Empty values are dropped rather than guessed, so no street address,
e-mail, VAT number, price or rating is ever emitted.

A `services` block counts as bookable when at least one of its cards has a
`duration` — that is what separates "Vier manieren om te boeken" from "Vier
dingen, één positie" without adding a field. An offer page emits one
`Service` node (`offerServiceJsonLd`) with `serviceType` = the category; an
`Offer` with a price only once `priceCents` holds a confirmed amount.

`pricing` and `testimonial` blocks with `isPlaceholder: true` render nothing and
appear in no structured data.

### 12.6 Seeding

`npm run cms:seed` creates, fills and **publishes** the seventeen Dutch pages
(`/`, `/aanbod`, seven `/aanbod/<slug>`, `/aanbod/cadeaubon`, `/voor-wie`,
`/bikefit`, `/ons-team`, `/veelgestelde-vragen`, `/afspraak`, `/privacy`,
`/algemene-voorwaarden`), both menus and the redirects `/bikefit.html →
/bikefit`, `/over-ons → /ons-team` and `/contact → /afspraak`, through `repo.ts`, so the snapshots,
audit entries and permission checks are the real ones. It does that by giving
the write API the request context it expects (`scripts/lib/request-context.mts`):
`module.registerHooks()` stubs for `server-only`, `next/headers` and
`next/cache`, plus a genuine `cms_sessions` row (revoked again on exit) for the
oldest active admin who has chosen their own password and enrolled two-step
verification (`scripts/lib/cms-actor.mts`; it never creates one). The redesign's pages and menus are defined once in
`src/lib/studio/seed-content/aanbod.ts`; **existing databases get them through
`npm run cms:rollout-aanbod`, never a full `cms:seed`** (§14).

- `--only-missing` leaves every page and menu that already exists alone.
- `--refresh-slug <slug>` (also `--refresh-slug=<slug>`; `/` or `home` for the
  home page) replaces one page's draft blocks with the seed definition and
  republishes it; its title/SEO fields, all other pages, menus, settings and
  redirects stay as they are. A missing page is created in full. Used to roll
  out the `booking` block on `/afspraak` and the legal texts on `/privacy` and
  `/algemene-voorwaarden` to an existing database. Cannot be combined with
  `--only-missing`.

The legal texts (`PRIVACY_HTML` / `TERMS_HTML` in `scripts/cms-seed.mts`) take
their e-mail address from *Instellingen → Contact → e-mail* at seed time;
see `booking-runbook.md` §11.2.

### 12.7 Analytics — consent-gated GA4 tag and admin panel

**Public tag.** `src/components/studio/analytics.tsx` (`StudioAnalytics`,
mounted once by the studio layout) renders nothing unless **both**
`NEXT_PUBLIC_GA4_MEASUREMENT_ID` is set and well-formed **and**
`cms_site_settings.analytics.enabled` is `true` (`resolveMeasurementId()` in
`src/lib/analytics/consent.ts`). When both hold it mounts two client
components:

- `ConsentBanner` (`src/components/studio/consent-banner.tsx`) asks once and
  stores the choice in the `cms_consent` cookie (`granted` | `denied`, 365
  days; §4 *Cookies*). *Weigeren* is as prominent as *Accepteren* and also
  removes any `_ga*` cookies left from an earlier acceptance. The footer link
  *Cookies* reopens the banner; the banner links to `/privacy` once published.
- `Ga4Tag` (`src/lib/analytics/ga4-tag.tsx`) loads `gtag/js` only after
  `granted` and sends a `page_view` on every route change. The page fields
  come from `analyticsPageView()` (`src/lib/analytics/page-view.ts`), never
  from `location.href`: `page_path` is the path, `page_location` the origin
  plus the path with only the five `utm_*` query keys (campaign attribution;
  no `?ref=`, no `?dienst=`, no fragment), and the cancel link
  `/afspraak/annuleren/<token>` is reported as `/afspraak/annuleren/[token]`
  without any query. The same fields go on every `gtag('config')`, the first
  one included, so GA's own later hits (`user_engagement`, `scroll`) should
  use them too; decided in `page-view.test.ts`, checked in the browser as in
  `booking-runbook.md` §9.5.

Before consent there is no analytics script, no request to Google and no
analytics cookie. When the guard fails there is no banner either and no
footer *Cookies* link (there is no choice to make).

**Admin panel.** `src/components/admin/analytics-panel.tsx` on the dashboard,
visible only with `analytics.read` (admins). It reads the GA4 Data API through
`src/lib/analytics/ga4.ts` with a service account (`GA4_SERVICE_ACCOUNT_JSON`;
property id from `GA4_PROPERTY_ID` or the `analytics.ga4PropertyId` setting),
cached for one hour, and shows setup steps when not connected.

**What a failed read shows and logs** (14 Oct 2026). Only fixed Dutch text from
`src/lib/analytics/ga4-errors.ts` (`toGa4ReadError()`), never Google's message,
the service-account e-mail or the key id. An error's message is only
pattern-matched to pick a sentence; the property id appears only when it is
the numeric one:

| Failure | Admin text |
| --- | --- |
| Data API 403 / `PERMISSION_DENIED`, Google says the API is disabled | *De Google Analytics Data API staat niet aan in het Google Cloud-project van het serviceaccount. …* |
| Data API 403 / `PERMISSION_DENIED`, otherwise | *Het serviceaccount heeft geen toegang tot property `<id>`. Voeg het in GA4 toe als Kijker (Viewer).* |
| Data API 400 or 404 | *Google Analytics kent property `<id>` niet. Controleer de property-ID …* |
| Data API 401 | *Google weigerde het toegangstoken van het serviceaccount. Maak een nieuwe sleutel aan …* |
| another Data API error status (integer, 400–599) | *Google Analytics gaf een fout (HTTP 503). Probeer het later opnieuw.* |
| a Data API error without such a status | *Google Analytics gaf een fout. Probeer het later opnieuw.* |
| the token endpoint refused the key (`invalid_grant`, `invalid_client`, no key) | *De sleutel van het serviceaccount werd geweigerd (verwijderd of verlopen?). …* |
| a timeout (`TimeoutError`, `AbortError`) | *Google Analytics antwoordde niet op tijd. Probeer het later opnieuw.* |
| anything else | *Google Analytics kon niet worden gelezen. Probeer het later opnieuw.* |

The server log gets `[analytics] ga4_request_failed` and, for a Data API error,
that same integer status; nothing else. The loader inside `unstable_cache`
throws only a `Ga4ReadError` (message `ga4_request_failed`, no `cause`) and the
cache key holds a SHA-256 fingerprint of the service-account e-mail instead of
the e-mail, because Next prints a failed background refresh with the thrown
error and the cache key in full. Decided in `ga4-errors.test.ts` with dummy
service-account values.

Setup of the GA4 property, stream and service account:
`booking-runbook.md` §5. GDPR rules for the banner: `booking-runbook.md` §11.1.

### 12.8 Security headers

`next.config.ts` `headers()` sets `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin` and
`Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()` on
every route, and `X-Frame-Options: DENY` on `/admin` and below. `/admin` and
below also get a per-request nonce Content-Security-Policy from the middleware,
in report-only mode until it is validated in a browser on staging
([`admin-csp.md`](./admin-csp.md)); the whole admin subtree renders
dynamically (`src/app/admin/layout.tsx`) so every load gets its own nonce. The
public pages have no CSP (GA4 and static rendering; see §13). How to verify
after a deploy: `booking-runbook.md` §11.4.

---

## 13. Known gaps and open questions

Every temporary or unconfirmed piece of public content (prices, durations,
extras, team bios and photos, AI images, booking links, contact details) is
tracked in [`content-placeholders.md`](./content-placeholders.md), one row per
field with a unique ID. `src/lib/studio/seed-content/placeholders.test.ts`
fails when an offer, team member or editorial image in the seed has no row
there. Block types can carry an `editorHint` (registry) that the admin shows
above the fields; `offer` and `team` use it to point editors at the register.

- **Booking** is built: schema, availability, admin screens, the public widget
  on `/afspraak`, Google Calendar sync and e-mail. It is documented in
  [`booking-architecture.md`](./booking-architecture.md) (design) and
  [`booking-runbook.md`](./booking-runbook.md) (setup, GDPR, retention).
- **No prices exist.** Nothing in `prototype/`, `content/` or `brand/` names an
  amount. The `pricing` block is placeholder-flagged and hidden; services carry
  `price_cents = null` and `show_price = false`.
- **Studio contact details are incomplete.** The legal identity (company,
  registered office, enterprise/VAT number) is fixed in
  `src/lib/studio/legal.ts` for the footer and the transactional e-mails, but
  `cms_site_settings.contact` (street, e-mail) and `organization.vatNumber`
  are still empty, so the `LocalBusiness` JSON-LD stays incomplete until they
  are filled in. The public contact e-mail is also what the legal texts use.
- **Testimonials are illustrative copy** from the copy deck, not real reviews.
- **The legal texts are templates** until a lawyer has reviewed them
  (`booking-runbook.md` §11.5).
- **No Content-Security-Policy on the public site.** The admin has one
  (report-only until staging validation, [`admin-csp.md`](./admin-csp.md)); the
  public pages would need GA4's hosts and nonces on statically rendered pages,
  a separate piece of work.
- **Editor and provider sessions** still last 14 days with sliding renewal;
  only admin sessions have the 15-minute idle and 8-hour absolute limits (§4).
  Providers need two-step verification since 16 Oct 2026, but their session
  class was deliberately left alone (`ROLE_SESSION_POLICY`) for the staging
  MFA test. The provider production policy is still an owner decision, listed
  with the other open MFA decisions in §4.
- **Draft preview gate is wider than `page.read`.** `canPreview()`
  (`src/lib/cms/actions/preview.ts`) lets any signed-in user who passes the
  guard read drafts, a provider included, although providers have no
  `page.read`. No route uses it today; whoever wires it up should ask for
  `page.read` (`cmsAccessDenial(user, { permission: 'page.read' })`).
- Session rows are only pruned opportunistically. If volume ever matters, add a
  scheduled `pruneExpiredSessions()` call.
- **Uncaught errors are printed by Next in full.** Every explicit catch (server
  actions through `runAction()`, the OAuth callback, the booking and voucher
  flows, the public blocks, the e-mail store, the GA4 reader) logs a fixed
  `[area] <event>` code and nothing of the error (14 Oct 2026). An error nobody
  catches (a page's own read, `getSiteSettings()` in a block,
  `getCurrentCmsUser()` in a route handler) still reaches Next's own logging
  with its message, and a Drizzle query error's message holds the SQL and every
  bound value. Closing that needs a change at the query layer (strip `params`
  from what it throws), not more catch blocks.

---

## 14. Offer ("Aanbod"), audiences and team — 13 Oct 2026

**Pages.** `/aanbod` (intro + `offerCatalogue`), one page per offer at
`/aanbod/<slug>` (a single `offer` block, which also owns the page's `<h1>`),
`/voor-wie`, `/ons-team` (replaces `/over-ons`, which is unpublished — row and
snapshot kept — and redirected 301), plus a new home page whose first section
after the hero is the grouped offer, and `/bikefit` with the 3D-analysis
section and the Bikefit offers instead of the old "Vier manieren om te
boeken". Main menu: Aanbod, Voor wie, Bikefit, Ons team, Contact (the logo is
the way home; the header CTA stays "Afspraak maken"). FAQ, booking and the
legal pages are in the footer. Every "Boek je bikefit" button books like that CTA
(`/afspraak`); only visible phone numbers use `tel:` (`cms:patch-booking-cta` fixes
older content, `staging-runbook.md` §10).

**Site review (13 Oct 2026).** `/afspraak` is the one place to book or ask: it
opens on "Kies je moment" (the booking section owns the `<h1>`; widget headings
follow one level below), then "Voor je komt" with "Andere vraag?" (mail and
phone). `/contact` is retired like `/over-ons` (unpublished, 301 to
`/afspraak`) and the "Contact" menu items point at `/afspraak`. No "Ninove"
kicker and no second heading on `/aanbod`, `/voor-wie`, `/ons-team`; the
footer shows the public e-mail (settings `contact.email`) and no longer the
company identity line, which stays on the legal pages. The edits for existing
databases are pure data in `src/lib/studio/seed-content/page-cleanup.ts`,
applied by `cms:patch-page-cleanup` (`staging-runbook.md` §11).

**One source per offer.** (Since 16 Oct 2026 the settings — shown, variants,
prices, direct booking or enquiry — are in Beheer → Aanbod, §15; this paragraph
describes the copy and the derivation without saved settings.) Title and summary live on the offer page's `offer`
block. For an unlinked enquiry offer, so do editorial price and duration; for
a linked booking offer, duration comes from the active, offered `cms_services`
rows and independent offer price is withheld pending approved variant display.
Overviews derive their cards from the published pages
(`listPublishedOffers`, tags `cms` + `cms:pages`), so publishing an offer page
updates the home page, `/aanbod` and `/bikefit` at once. Category order is
fixed (Bikefit, Begeleiding); inside a category `sortOrder`, then title.

**Prices only under `/aanbod` (13 Oct 2026, Toshoni).** An `offerCatalogue`
card shows its price line only when "Prijzen tonen" is on *and* the page is
`/aanbod` or an offer page (`showsOfferPrices`, `src/lib/offers/catalogue.ts`).
The home page and `/bikefit` therefore never show prices, also for content
published before the rule (no data patch needed); their seeds set the switch
off. A filled-in `pricing` block (placeholder off) follows the same rule: it
renders only on `/aanbod` and offer pages and is left out entirely elsewhere.
The offer page itself always shows Kostprijs. Booking, checkout and the
admin are not affected. The site header is the logo, menu and "Afspraak maken"
only: the prototype's utility bar (city, phone, hours) is gone; the footer
keeps those contact details.

**Booking link.** Every offer page links to `/afspraak?dienst=<offer slug>#boeken`.
The booking block resolves it on the server (`resolveBookingSelection`,
`src/lib/offers/catalogue.ts`); the reconciliation with the booking catalogue is
in `booking-architecture.md` §14.

**Images.** Three temporary AI images (generic people) in
`public/images/editorial/`, written into blocks via `editorialImage()`;
provenance in [`editorial-images.md`](./editorial-images.md). Team members never
get a generated image: the `team` block draws initials.

**Staging rollout.** The real site is database-backed, so a deploy alone
changes nothing. `npm run cms:rollout-aanbod` (dry run by default; the dry run is strictly
read-only: no session row, no audit entry, writes refused by a read-only db
handle) applies
exactly these pages, both menus, the `/over-ons` retirement and its redirect to
an existing database — backup first, through the repo, booking tables verified
untouched, idempotent, reversible with `--restore`. Procedure:
[`staging-runbook.md`](./staging-runbook.md) §9. No migration is needed: the
new block types are zod-validated `text` in `cms_blocks`, as every block type.

**Compatibility.** The new code renders old content unchanged (the old blocks
are all still valid). Old code reading a page that uses `offer`,
`offerCatalogue` or `team` treats it as unpublished (404) — so deploy the code
before running the rollout.

---

## 15. Offering management: Beheer → Aanbod — 16 Oct 2026

Toshoni's brief: one place in Beheer where an editor or admin decides, per offer, whether it is
shown on the website, whether it has separate **Volwassene** and **Jeugd** variants or one option,
the price (per variant where they differ), and whether it is **booked directly online** or
**asked for** through a form; providers choose themselves what they offer. Booking details:
`booking-architecture.md` §15.

**One place per decision, no parallel controls.**

| Decision | Where | Who |
| --- | --- | --- |
| Copy, image, category, order; Duur of an offer that is asked for | the offer page (`offer` block) in Pagina's; publish as before | editor, admin publishes |
| Shown on the website; one option or Volwassene/Jeugd; price per variant; direct booking (as which service per variant) or enquiry | **Beheer → Aanbod** (`/admin/aanbod`), tables `cms_offerings` + `cms_offering_variants` (migration 0010, `src/db/cms-offering-schema.ts`). Takes effect at once (no publish step) | `offering.manage`: editor, admin |
| Duration, buffer, location, guardian rule, active (the bookable unit) | Beheer → Diensten (`cms_services`); a service that is a variant of a saved offering shows "prijs en label via Aanbod" instead of its own price and label fields (stored values kept as hidden fields) | `service.manage`: admin |
| Who offers a variant | *Mijn agenda → Mijn aanbod* (the provider for their own profile), grouped per offering; an admin can do it in Aanbieders | `service.subscribe.own` / `provider.manage` |

The `offer` block keeps `bookingServiceSlugs`, `priceCents` and `priceLabel` in its schema (old
content stays valid) but the block editor no longer shows them (`managedFields` in the registry,
`field-spec.ts`); the editor keeps their stored values. They are read only to **derive** the
settings of an offer page without a `cms_offerings` row (`deriveLegacyOffering()`,
`src/lib/offers/offering-legacy.ts`): no linked service → asked for, one option, its editorial
cents; one service → direct, one option; Volwassenenfit + Jeugdfit (one with the guardian rule) →
direct, Volwassene/Jeugd; never a price copied from a service. So the site behaves the same before
and after migration 0010 and before and after `cms:migrate-offerings` (staging-runbook §18), which
saves exactly those derivations; anything not exact (a free-text price label, an unknown slug, a
service that shows its own widget price) is reported and left for an editor.

**Modules.** `src/lib/offers/offering.ts` (pure: modes, validation, `settingsFromRows`,
`resolveOffering`, price/duration labels, `offeringBookingSlugs`, `withheldServiceIds`),
`offering-legacy.ts` (pure derivation), `offer-catalogue.ts` (pure: pages + settings + who offers
what → cards, `hiddenPageIds`, `withheldServiceIds`, `variantDisplay`), `offering-store.ts`
(server-only cached read, tags `cms` + `cms:offerings` + `booking`; a failed read derives every
page and logs `[aanbod] offerings_unavailable`), `repo.ts` (admin read/write, `offering.manage`,
audit `offering.update`, bust `cms:offerings` + `booking`), `src/lib/cms/offers-content.ts`
(`loadOfferCatalogue`, `React.cache` per request; `listPublishedOffers` unchanged in contract;
`isServiceBookableOnline` for the booking actions), `src/lib/cms/actions/offerings.ts`,
`src/app/admin/(dashboard)/aanbod/page.tsx` + `src/components/admin/offerings-manager.tsx`.

**Public behaviour.**

- *Shown* off → the offer leaves every overview (`/aanbod`, home, `/bikefit`), its page answers
  404 (`getStudioPage`) and is left out of the sitemap; its text stays in Pagina's.
- Status per offer: **Online te boeken** (direct, ≥ 1 active provider with an active account on
  ≥ 1 variant's active service), **Tijdelijk niet online te boeken** (direct, nobody offers it:
  card greyed — dashed edge and muted title, contrast kept — and the detail page's button
  disabled, no availability shown or suggested, the phone number as the way to ask), **Op
  aanvraag** (enquiry, on purpose: the button scrolls to the form on the page). Cards on every
  overview name the status; prices stay `/aanbod`-only (§14).
- Kostprijs: "Prijs op aanvraag" until a variant has a price; one amount for one option;
  "Volwassene € 150,00 · Jeugd op aanvraag" per variant. Never € 0, never invented. JSON-LD
  `offers` mirror it (one `Offer` per priced variant, named when there are two) and never use the
  block's editorial fields once an offering is resolved.
- Duur: direct → from the variants' active services ("Volwassene: 1 u 30 min · Jeugd: 1 uur");
  enquiry → the page's Duur text.

**Enquiry form** (`src/lib/offer-enquiry/`, `src/components/studio/offer-enquiry-form.tsx`).
Name, e-mail, optional phone (normalised to one `+32`), "Voor wie?" when the offering has
Volwassene/Jeugd, the question; honeypot; privacy link; nothing stored. The server action
re-checks that the offer is shown and set to enquiry (`findEnquiryOffer`), so the form cannot
mail about another page. Rate limit on `cms_rate_limits` with the shared race-free reservation
(`aanvraag:ip:<ip>`, `aanvraag:email:<sha256>`, 5 per 15 min per key; duplicate marker
`aanvraag-sent:<request id>` for a day). The mail goes to the existing order inbox (env
`GIFT_VOUCHER_RECIPIENT`, else Beheer → E-mail → *Ontvanger bestellingen en aanvragen*), never
`contact.email` and never a hardcoded address, through `sendEmail()` with the visitor as Reply-To;
the subject carries the offer and a reference, no personal data. Success only when the provider
accepted the mail; otherwise "niet verstuurd" with the input kept. Logs: `[aanvraag] niet
verstuurd (<code>)`, `[aanvraag] enquiry_action_failed`.

**Tests.** `offering.test.ts`, `offer-catalogue.test.ts`, `offer-enquiry/{input,delivery}.test.ts`,
`actions/offerings.test.ts` (provider refused, editor/admin save, validation), the booking-action
gate in `public-actions.test.ts`, JSON-LD in `jsonld.test.ts`; on PGlite self-test section 14d
(`scripts/selftest/offerings.mts`).

**Decisions to confirm (Toshoni).** Editors get `offering.manage`, as asked: their Aanbod changes
(including prices and hiding an offer) go live without the admin's publish step — one line in
`permissions.ts` makes it admin-only. The env name `GIFT_VOUCHER_RECIPIENT` is kept for
compatibility although the inbox now also receives enquiries.
