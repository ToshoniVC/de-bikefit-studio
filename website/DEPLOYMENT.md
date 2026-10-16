# Deployment — environments and env var contract

One repository, **one** Vercel project and **one** Neon project. Only **data** is ever copied
from production to staging; secrets are always per environment.

**No secrets in this file or anywhere in the repository.** No keys, passwords or connection
strings in docs, commits, chat or screenshots. 1Password is the source of truth; Vercel and
the OpenClaw secret store hold runtime copies.

## 1. Environments

The Vercel team `toshoni` is on the **Hobby plan, which has no custom environments**. Staging
is therefore not a separate Vercel environment: it is the **preview deployments of the
`staging` branch**, with environment variables scoped to that branch.

| | Local | Feature preview | Staging | Production |
| --- | --- | --- | --- | --- |
| Git branch | any | `feat/*` (any branch except `staging`/`main`) | `staging` | `main` |
| Vercel | — | Preview deployment | Preview deployment of `staging` | Production deployment |
| Vercel env scope | `.env.local` | Preview (all branches) | Preview, branch `staging` | Production |
| URL | `http://localhost:3000` | per-deployment `*.vercel.app` | `https://de-bikefit-studio-git-staging-toshoni.vercel.app` (stable alias) | `https://de-bikefit-studio.vercel.app` until a domain is chosen |
| Database | PGlite `website/.pglite/` | **currently the same Neon `Staging` branch** (isolation pending; see booking runbook §7.3) | Neon `Qarakter` → branch `Staging` | Neon `Qarakter` → branch `production` |
| Indexing | — | off | off (`seo.allowIndexing = false`) | on only after the §8 checklist in the staging runbook |

Branch flow: `feat/<topic>` → pull request → `staging` → `main`. A push to `staging` deploys
staging; a merge to `main` deploys production (Vercel Git integration).

Branch-scoped Preview variables override the generic Preview ones for that branch, so staging
and feature previews can have different values (e.g. their own `CMS_SESSION_SECRET`). Feature
previews currently use the staging alias as `NEXT_PUBLIC_SITE_URL`, so their canonicals,
e-mail links and Google connect flow point at staging: where the Google variables are set,
`/api/google/oauth/start` hops to the `NEXT_PUBLIC_SITE_URL` host first and the connection
completes on the staging deployment. The Google variables belong to Preview with branch
`staging` only (`docs/booking-runbook.md` §7.3), so a feature preview's Google card says the
connection is not set up there: connect on staging.

As of 16 Oct 2026, generic Preview and Preview/`staging` have different
`CMS_SESSION_SECRET` values but the **same Neon Staging database**. Scoping the
Google secret and token key to `staging` protects token confidentiality; it does
not prevent generic feature-preview code from writing shared booking or Google
status rows. Before the first provider connects Google, isolate generic Preview
onto its own Neon branch and address old immutable previews, which retain the
environment values from when they were deployed (`docs/booking-runbook.md` §7.3).

## 2. Who deploys

Deployments are executed by the DevOps agent **Arend** (OpenClaw), following
[`docs/staging-runbook.md`](docs/staging-runbook.md):

- **Previews and staging:** automatic, after the release gate (the Definition-of-Done checks
  green for that commit, see `../CLAUDE.md` §2). Arend then runs `site-health` against the
  deployment.
- **Production, the production database (migrations, seeds, `cms:retention -- --apply`) and
  DNS:** only after an explicit go from Toshoni.

People with Vercel and Neon access can follow the same runbooks; the gates are the same.
Database scripts run from a shell with the target's URL injected for that one command (Arend:
inside `with-db-url.sh`), never from the Vercel build.

## 3. Neon (database)

- Project **`Qarakter`**. Branch **`production`** is the default/primary branch; branch
  **`Staging`** is a copy-on-write child of it.
- Each branch's **pooled** connection string (host contains `-pooler`) is that environment's
  `DATABASE_URL`. It lives in 1Password and Vercel only.

Schema changes always go through a named migration:

```bash
# on a feature branch: generate from src/db/*.ts, commit drizzle/*.sql and drizzle/meta/*
npm run db:generate -- --name=<snake_name>

# apply, staging first, production only after a go
DATABASE_URL='<pooled url of the target branch>' npm run db:migrate
```

Migrations are additive and guarded so they can run twice. Apply them before the deploy whose
code needs them; the previous build keeps working against the extended schema.
**Never run `db:push` against Neon**: it diffs the live schema and can propose destructive
changes. It is for a throwaway local database only.

After migrating a fresh branch, run the idempotent scripts in this order: `cms:bootstrap` →
sign in as the bootstrap admin, set a permanent password and set up two-step verification →
`cms:seed` → `cms:seed-booking` (details in the staging runbook §3). The write scripts act as
the oldest active admin with a permanent password and an authenticator, and refuse to run
while no admin qualifies. Rolling admin MFA out on an existing database: staging runbook §14;
together with the e-mail settings, the admin session limits and the second-step rate limits
(migrations 0004 → 0005 → 0006 → 0007, key before deploy, migrate before deploy): staging
runbook §16.

## 4. Vercel (one project)

- Project **`de-bikefit-studio`**, team `toshoni`, **Root Directory `website`**, production
  branch `main`, Git integration with GitHub.
- Set variables per scope: **Production**, **Preview with git branch `staging`**, and
  **Preview (all branches)** for feature previews. Mark secrets as *Sensitive*.
- `npm run build` needs no variables and no database (every CMS-backed route is
  `force-dynamic`), so a build never touches Neon.
- A variable change takes effect only after a **redeploy**. `NEXT_PUBLIC_*` values are
  inlined at build time.

## 5. Environment variables

Read only through `src/lib/env.ts` (zod-validated; `features` flags) and listed with a
one-line comment in `.env.example`. Every integration is optional and degrades gracefully when
its variables are missing. Names and purpose only; values never appear here.

| Variable | Purpose | Secret | Needed |
| --- | --- | :-: | --- |
| `DATABASE_URL` | Neon pooled URL for this environment's branch. Unset → PGlite, which is refused in production. | yes | every deployed env |
| `CMS_SESSION_SECRET` | Pepper for CMS session-token hashes; also signs the Google OAuth state cookie and the booking confirmation link, is the fallback source for the token key below and the key source for an e-mail API key stored in `/admin/email`. Rotating it signs every CMS user out and makes that stored key unreadable (an admin pastes it again). Different per environment. | yes | every deployed env |
| `CMS_MFA_ENCRYPTION_KEY` | base64 of 32 bytes; AES-256-GCM key for the TOTP secrets of admins and providers (two-step verification). **Required:** without it admins and providers cannot finish signing in (fail closed; the rest of the site is unaffected). Set it before deploying the build that needs it (staging runbook §16). Different per environment, never derived from another secret. Rotating it makes stored authenticators unreadable: admins and providers sign in with a recovery code and replace the authenticator. | yes | every deployed env (Production and Preview) |
| `CMS_BOOTSTRAP_PASSWORD` | One-shot password for the first admin, passed inline to `cms:bootstrap`. | yes | **never** in Vercel or `.env.local` |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin: canonicals, sitemap, OG images, e-mail cancel links, Google OAuth redirect URI (`<origin>/api/google/oauth/callback`). On a deployment (`NODE_ENV=production`) the redirect URI comes from this variable only and must be https: without it, or with `http://`, connecting Google is refused (never a fallback to `VERCEL_URL`). | no | every deployed env |
| `NEXT_PUBLIC_GA4_MEASUREMENT_ID` | GA4 measurement id (`G-…`). The tag loads only when this is valid, *Analytics ingeschakeld* is on in the admin, and the visitor accepts cookies. Build-time. | no | production (staging only to test the banner) |
| `GA4_PROPERTY_ID` | Numeric GA4 property id for the admin analytics panel; overrides the `analytics.ga4PropertyId` setting. | no | optional |
| `GA4_SERVICE_ACCOUNT_JSON` | Service-account key (raw JSON or base64) with Viewer on the GA4 property; enables the admin panel. | yes | optional |
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth client ("Web application") for per-provider Calendar sync. Staging: Preview with branch `staging` only, never Preview (all branches) (`docs/booking-runbook.md` §7.3). | no | optional (both or neither) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Secret of that client. Without the pair the Google card shows no connect button (an admin sees what is missing), the OAuth routes send a signed-in user back with `reason=config`, and availability ignores Google. A value with whitespace is refused the same way. | yes | optional |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | base64 of exactly 32 bytes (`openssl rand -base64 32`); AES-256-GCM key for stored Google tokens. **Optional:** empty → key derived from `CMS_SESSION_SECRET` (HKDF-SHA256). Any other length blocks connecting. Rotating either value forces every provider to reconnect Google, so set it before the first connection. One per environment. | yes | optional |
| `RESEND_API_KEY` | Resend API key for booking e-mails and gift voucher orders. **Optional:** an admin can instead store the key in `/admin/email` (sealed with AES-256-GCM, key derived from `CMS_SESSION_SECRET`); when set here it wins. With no key anywhere, booking mails are logged (number of recipients only, no subject or address) and skipped, and every gift voucher order shows "niet verstuurd". | yes | optional |
| `EMAIL_FROM` | Sender on a domain verified in Resend. Also required for gift voucher orders. Overrides the sender in `/admin/email`. | no | optional |
| `EMAIL_REPLY_TO` | Reply-To for customer mails (not used for gift voucher orders: their Reply-To is the visitor). Overrides `/admin/email`. | no | optional |
| `GIFT_VOUCHER_RECIPIENT` | Inbox for gift voucher orders (one plain address). Overrides `/admin/email` → *Ontvanger cadeaubonbestellingen*. Never falls back to the public contact e-mail; unset in both places, or invalid, means every order shows "niet verstuurd". | no | optional |
| `CMS_PGLITE_DIR` | Local PGlite directory (default `.pglite`). | no | local only |
| `CMS_PGLITE_AUTO_MIGRATE` | `"false"` stops PGlite auto-migrating on first use. | no | local only |
| `NEXT_PUBLIC_APP_URL` | Webshop origin; second fallback for the canonical origin. | no | legacy webshop |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET` | Clerk (webshop customers only; not the CMS). | secret key + webhook: yes | legacy webshop |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe checkout and order webhook. | secret key + webhook: yes | legacy webshop |

Set by Vercel, not by us: `VERCEL_URL` (last fallback for the canonical origin; never the
Google OAuth redirect URI on a deployment, it changes with every deployment), `VERCEL_ENV`.
Script-only, never in Vercel: `CMS_BREAK_GLASS_PASSWORD` (optional, inline for `cms:mfa-reset`),
`PROVIDER_EMAIL` / `PROVIDER_NAME` (`cms:seed-booking`),
`NEON_PROJECT_ID`, `STAGING_DATABASE_URL`, `PARENT_BRANCH`, `STAGING_BRANCH`
(`scripts/reset-staging.sh`).

How to obtain the Google, GA4 and Resend values: [`docs/booking-runbook.md`](docs/booking-runbook.md) §1–7.

## 6. Webshop services: test vs live (legacy)

- **Clerk:** Development instance for staging and previews, Production instance for
  production; each instance's webhook points at that environment's `/api/webhooks/clerk`.
- **Stripe:** test keys and a test webhook for staging (`stripe listen` locally); live keys
  only in production. (The unused Mollie client was removed on 2026-09-24; the checkout
  is Stripe only.)

## 7. Refresh staging from production

```bash
STAGING_BRANCH=Staging ./scripts/reset-staging.sh
```

Resets the Neon staging branch from its parent (`production`), then runs
`scripts/anonymize-staging.sql` against it. Needs `neonctl` (authenticated), `psql`,
`NEON_PROJECT_ID` and `STAGING_DATABASE_URL`. The script defaults to the Neon branch
`Staging` (override with `STAGING_BRANCH=…`).

> **What the anonymisation covers.** `anonymize-staging.sql` runs in one transaction and
> scrubs the webshop tables (`users`, `orders`) and the booking data: `cms_bookings`
> customer and guardian names, e-mails (`booking-<id>@example.invalid`), phones, address,
> bike details and notes, plus the Google event references (so a staging cancellation can
> never delete a real calendar event); it truncates `cms_sessions`, `cms_login_attempts`
> and `cms_booking_rate_limit`, empties the `cms_mfa_*` tables when they exist (the four of
> 0005 and the rate-limit counters of 0007; staging admins then enrol anew) and the public
> rate-limit counters `cms_rate_limits` of 0008 when it exists (IP addresses and e-mail
> hashes in the keys), and nulls every Google token on `cms_providers`. On
> `cms_integration_settings` (when it exists) it clears the stored e-mail API key (ciphertext,
> hint, date) and the gift voucher order inbox, so staging never uses production's Resend
> credential or mails test orders to the studio's real inbox; sender and reply-to stay. After a
> refresh an admin sets a staging key and inbox in `/admin/email` (or via the env vars).
> Add a line there whenever a new table stores personal data. After a reset, re-run
> `db:migrate` and the scripts in §3 if production is behind staging.

## 8. GDPR / PII caveats

A production → staging copy brings real personal data into a lower-trust environment.

1. **Anonymise on refresh.** `scripts/anonymize-staging.sql` must run on every copy (§7 lists
   what it covers).
2. **Test modes everywhere.** Staging's Clerk and Stripe are non-live, so copied webshop
   rows cannot trigger real payments.
3. **Live services on staging.** Resend and Google Calendar are real on staging. If a copied
   booking still holds a real e-mail address, cancelling it in the staging admin e-mails a
   real customer. Anonymise first.
4. **Foreign references.** Copied rows hold Clerk user ids and Stripe session ids of
   production; test new auth and checkout flows on staging rather than replaying copied rows.
5. **Retention.** Personal data is purged by `npm run cms:retention` (dry run first, then
   `-- --apply`), monthly, per environment. Policy, schedule and manual steps:
   [`docs/booking-runbook.md`](docs/booking-runbook.md) §11.
6. **No indexing.** Staging keeps `seo.allowIndexing = false` (`robots.txt` → `Disallow: /`,
   `noindex` on every page).
