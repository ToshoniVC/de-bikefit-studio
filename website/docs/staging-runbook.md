# Staging runbook — De Bikefit Studio

How the Dutch public site, the `/admin` CMS and online booking are brought up and
updated on **staging**, plus the checklist before production. Every command is
copy-pasteable and contains **no secrets**: each secret or connection string is passed
inline at the moment it is needed and lives only in 1Password and Vercel.

**Who runs this.** Deployments are executed by the DevOps agent **Arend** (OpenClaw).
Previews and staging go automatically once the release gate is green; production, the
production database and DNS only after an explicit go from Toshoni (`../DEPLOYMENT.md` §2).
Arend records every deployment in its infrastructure log, outside this repository. A person
with Vercel and Neon access can follow the same steps. The changes of 13 Oct 2026 each have their
own rollout section: the offer redesign §9, the booking CTA patch §10, the page cleanup §11, the
gift voucher §12, the e-mail service in the admin §13 (migration 0004), admin two-step
verification §14 (migration 0005 and a new secret) and admin session limits, step-up and the
admin CSP §15 (migration 0006); 0007 (race-free second-step rate limits) has no section of its
own. Rolling 0004–0007 out together, as the security release does: the combined order in §16.
Two-step verification for providers (16 Oct 2026, no migration, no new secret): §17.
Beheer → Aanbod (16 Oct 2026, migrations 0009 and 0010 before the build): §18.

Environments, the Hobby-plan staging setup and the full env var contract:
[`../DEPLOYMENT.md`](../DEPLOYMENT.md). Google, GA4 and Resend setup, GDPR and retention:
[`booking-runbook.md`](./booking-runbook.md). The Qarakter webshop's own staging concerns
(Clerk/Stripe test keys, prod→staging refresh) are in `DEPLOYMENT.md` §6–8.

---

## 0. Before you start

| You need | Why |
| --- | --- |
| Neon project `Qarakter` access | the `Staging` branch and its pooled URL |
| Vercel project `de-bikefit-studio` access (Member or above) | branch-scoped env vars and redeploys |
| A local clone + `npm ci` in `website/` | migrate/bootstrap/seed scripts run from a shell, not from Vercel |
| Node 22.15+ | `cms-seed.mts` and `cms-selftest.mts` use `module.registerHooks()` |

The database scripts are **run by hand, one at a time**, pointed at the staging database
(Arend: inside `with-db-url.sh`). They are not part of the Vercel build on purpose: a build
step that writes to the database would run on every deploy. Do not run them while a
`next dev` is pointed at the same database.

---

## 1. Neon — the `Staging` branch

Project `Qarakter` already has a branch **`Staging`**, a copy-on-write child of
**`production`**. If it ever has to be recreated: Neon console → project → **Branches → New
branch**, name `Staging`, parent `production`.

Open the branch → **Connection string** → **Pooled** (host contains `-pooler`). That string
is staging's `DATABASE_URL`. Keep it in 1Password; never paste it into a file in the
repository.

---

## 2. Vercel — staging environment variables

The team is on the **Hobby plan: no custom environments**. Staging = Preview deployments of
the `staging` branch. Vercel → project → **Settings → Environment Variables** → environment
**Preview**, **git branch `staging`**. Mark secrets as *Sensitive*. Names only below; values
come from 1Password.

| Variable | Staging value | Notes |
| --- | --- | --- |
| `DATABASE_URL` | pooled URL of Neon `Staging` (§1) | Without it the app tries PGlite, which `src/db/cms.ts` refuses on any deployment (`NODE_ENV=production`). |
| `CMS_SESSION_SECRET` | `openssl rand -base64 48`, staging's own | Rotating it signs every CMS user out, makes an e-mail API key stored in `/admin/email` unreadable (§13) and, without a token key, disconnects Google. Never reuse production's. |
| `CMS_MFA_ENCRYPTION_KEY` | `openssl rand -base64 32`, staging's own | **Required** for admin and provider sign-in (two-step verification, §14, §17); set it before the deploy that brings it (§16). Treat as permanent: rotating it forces every admin and provider to re-enrol with a recovery code. Never reuse production's. |
| `NEXT_PUBLIC_SITE_URL` | `https://de-bikefit-studio-git-staging-toshoni.vercel.app` | Canonicals, sitemap, OG, e-mail links, OAuth redirect URI. |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | the shared web client | Register exactly `https://de-bikefit-studio-git-staging-toshoni.vercel.app/api/google/oauth/callback` on the client; scope Preview, branch `staging` only (`booking-runbook.md` §7.3). |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32`, staging's own | Set before the first connection: base64 of exactly 32 bytes (`booking-runbook.md` §7.3). Without it a key is derived from `CMS_SESSION_SECRET`; treat as permanent. |
| `RESEND_API_KEY` | staging key | Optional: an admin can store it in `/admin/email` instead (§13); env wins. Without a key anywhere mails are logged and skipped. |
| `EMAIL_FROM`, `EMAIL_REPLY_TO` | sender on the verified domain, reply-to | Optional, same as above. |
| `GIFT_VOUCHER_RECIPIENT` | **empty** until a working order inbox is chosen | Optional, same as above (`/admin/email` → *Ontvanger bestellingen en aanvragen*). Unset in both places = gift voucher orders are "niet verstuurd" (§12). |
| `GA4_PROPERTY_ID`, `GA4_SERVICE_ACCOUNT_JSON` | property id, service-account key | Admin analytics panel. Optional. |
| `NEXT_PUBLIC_GA4_MEASUREMENT_ID` | **empty**, unless testing the cookie banner | Build-time; the tag also needs *Analytics ingeschakeld* in the admin. |

**Never put `CMS_BOOTSTRAP_PASSWORD` in Vercel.** It is needed once, by `cms:bootstrap` in
§3.2, on the machine that runs it. The running app never reads it.

Every change to a variable needs a **redeploy** to take effect. The webshop keys are only
needed if the shop must work on staging (`DEPLOYMENT.md` §6); the CMS and booking need none.

---

## 3. Prepare a fresh staging database

For a new or reset `Staging` branch. Run from `website/` with the staging URL supplied
inline, so it never lands in a file.

```bash
cd website
npm ci
```

### 3.1 Apply migrations

```bash
DATABASE_URL='<staging pooled url>' npm run db:migrate
```

| File | Effect on staging |
| --- | --- |
| `0000_webshop_baseline.sql` | Guarded no-op against the existing webshop tables. |
| `0001_cms_foundation.sql` | Two enums and eleven `cms_*` tables. |
| `0002_role_provider.sql` | Adds `provider` to `cms_role`. |
| `0003_booking.sql` | The eight booking tables. |
| `0004_integration_settings.sql` | `cms_integration_settings`, the e-mail service set up in `/admin/email` (§13). |
| `0005_cms_admin_mfa.sql` | Four `cms_mfa_*` tables and `cms_sessions.mfa_verified_at` (§14). |
| `0006_cms_session_limits.sql` | `cms_sessions.absolute_expires_at` and `cms_sessions.reauthenticated_at` (§15). |
| `0007_cms_mfa_rate_limits.sql` | `cms_mfa_rate_limits` and the unique index `cms_mfa_challenges_user_id_unique_idx` (§16). |
| `0008_cms_rate_limits.sql` | `cms_rate_limits`, the race-free public booking limit (`booking-architecture.md` §9). Needed **before** a build that contains it serves `/afspraak`: without the table every booking attempt answers "Er ging iets mis bij het boeken" (`[booking] create_failed`). |
| `0009_cms_service_choice_label.sql` | `cms_services.choice_label` (text, default `''`), the label of a service under an offer ("Volwassene", "Jeugd"; `booking-architecture.md` §14). One guarded `ADD COLUMN`, no data change. Needed **before** a build that contains it: without the column `/afspraak` shows "Online boeken lukt op dit moment niet" and Admin → Diensten fails. Then run §3.2 once to fill the two labels. |
| `0010_cms_offerings.sql` | `cms_offerings` and `cms_offering_variants`, the settings of Beheer → Aanbod (`cms-architecture.md` §15). Two guarded `CREATE TABLE`s, their FKs and indexes; no data change. Needed **before** a build that contains it: until then every offer page derives its settings from its block (as before), Beheer → Aanbod cannot save, and the booking actions refuse every service (fail closed, like 0008). Then, optionally, §18. |

All additive and guarded (no `DROP`, `TRUNCATE` or webshop `ALTER`); already-applied files
are skipped. Expect `→ driver: neon-http (<host>)` and `✓ migrations applied to Neon`. The
current build needs 0005, 0006 and 0007 before anyone signs in to `/admin` (§16).

### 3.2 Bootstrap

```bash
DATABASE_URL='<staging pooled url>' \
CMS_BOOTSTRAP_PASSWORD='<a strong throwaway password>' \
npm run cms:bootstrap
```

Creates only what is missing: the admin `contact@toshoni.be` (`must_change_password =
true`), the six `nl` site settings (including `seo.allowIndexing = false` and the `booking`
rules), empty `main` and `footer` menus, the locations "De Bikefit Studio, Ninove" and "Bij
jou thuis", the five services and the ten offerings of Beheer → Aanbod (the seven offers of the
brief, shown, Bikefit – huidige fiets booked as Volwassenenfit/Jeugdfit; Gezinspakket, Fit aan
huis and Inspanningstest as hidden offerings; §19). Never overwrites anything. On a database
that already has the services, the only change it makes is to fill an **empty** `choice_label`
of `volwassenenfit` ("Volwassene") and `jeugdfit` ("Jeugd") after migration 0009 (printed as
`~ service nl/… : empty choice label set to …`); a label an admin typed is left alone. An
existing offering (by slug) is left alone too.

### 3.3 Seed content and the first provider

```bash
DATABASE_URL='<staging pooled url>' npm run cms:seed
DATABASE_URL='<staging pooled url>' npm run cms:seed-booking
```

`cms:seed` writes as the oldest active admin who has chosen their own password and set up
two-step verification: a session with a temporary password may do nothing but change it, and
an admin without an authenticator gets no session at all (`cms-architecture.md` §4). On a
fresh database, first sign in as `contact@toshoni.be`, replace the bootstrap password and set
up the authenticator (§6, steps 1–2, on a deployment that uses this database); until then
`cms:seed` stops with that explanation and writes nothing. `cms:seed-booking` writes directly
and does not need it.

`cms:seed` creates, fills and **publishes** the Dutch pages (home, `/aanbod`, `/cadeaubon`,
`/voor-wie`, `/bikefit`, `/ons-team`, `/veelgestelde-vragen`, `/afspraak`, `/privacy`,
`/algemene-voorwaarden`), both menus and the redirects (`/bikefit.html`, `/over-ons`,
`/aanbod/cadeaubon`, `/contact`), through the real write API. The offer itself is not pages but
the offerings `cms:bootstrap` wrote (§19). Once real
editing has started use `-- --only-missing` or `-- --refresh-slug <slug>` instead of a full
run: a full run overwrites the draft blocks of every seeded page.

`cms:seed-booking` creates the provider `toshoni@gmail.com` (role `provider`, forced password
change and, at the same first sign-in, two-step verification (§17); the temporary password is
**printed once** — hand it over directly, never through a log or chat transcript: whoever holds
it can enrol the authenticator), its profile, hours Mon–Fri 09–18 and Sat 09–13, and
subscriptions to the five services. The public booking widget lists no services until a
provider exists.

---

## 4. Rolling out booking to the existing staging database

Staging already runs the CMS (migrations `0000`–`0001`, admin, six pages). The booking
release adds migrations, data, pages and variables. Order matters:

1. **Migrate** — `DATABASE_URL='<staging pooled url>' npm run db:migrate` applies `0002`
   and `0003`.
2. **Bootstrap** — `… npm run cms:bootstrap` (with `CMS_BOOTSTRAP_PASSWORD` inline; the
   existing admin is left alone) adds the `booking` setting, both locations and the five
   services.
3. **Seed booking** — `… npm run cms:seed-booking` creates the first provider.
4. **Contact e-mail** — if known, set *Instellingen → Contact → e-mail* first: the legal
   texts take their address from it at seed time (`booking-runbook.md` §11.2).
5. **Refresh the three pages**, one at a time:

   ```bash
   DATABASE_URL='<staging pooled url>' npm run cms:seed -- --refresh-slug afspraak
   DATABASE_URL='<staging pooled url>' npm run cms:seed -- --refresh-slug privacy
   DATABASE_URL='<staging pooled url>' npm run cms:seed -- --refresh-slug algemene-voorwaarden
   ```

   Each replaces only that page's blocks and republishes it (a missing page is created).
6. **Env vars** — add the new staging variables from §2 (Google OAuth, token key, Resend,
   GA4 as wanted).
7. **Deploy** — merge to `staging` (or redeploy if the code is already there) so one build
   picks up the code and the new variables.
8. **Smoke** — Arend runs `site-health` on the staging alias; then the manual checks in §6
   and `booking-runbook.md` §9.

> The build that is live before step 7 does not know the `booking` block, so `/afspraak`
> answers 404 from step 5 until the new build is live. Keep steps 5–7 close together, or run
> step 5 after step 7.

---

## 5. Deploy

**Git (standard).** Merge the reviewed feature branch into `staging` and push. The Vercel Git
integration builds a Preview deployment of `staging` with the branch-scoped variables; the
alias `https://de-bikefit-studio-git-staging-toshoni.vercel.app` moves to it.

**Redeploy without a code change** (after changing variables): Vercel → Deployments → latest
`staging` deployment → **Redeploy**.

The build needs **no database**: every CMS-backed route is `force-dynamic`, so `next build`
never queries Neon.

Production (`main`) deploys the same way, only after an explicit go.

---

## 6. First login and checks

1. Open `<staging alias>/admin/login` and sign in as `contact@toshoni.be` with the
   bootstrap password.
2. You are sent to `/admin/mfa` and cannot reach anything else until you set a new
   password (≥ 12 characters, lower case, upper case and a digit) and then link an
   authenticator (1Password or a free app): scan the QR code, type the six-digit code, and
   store the ten recovery codes shown once (in 1Password, with the account). Only then is
   there a session. Every later sign-in asks for the password and a code.
3. On the dashboard, check:
   - **Pagina's** — the seventeen pages from §3.3, all "Gepubliceerd".
   - **Diensten**, **Locaties**, **Aanbieders** — five services, two locations, one provider.
   - **Instellingen → SEO** — `allowIndexing` is **off**; `<alias>/robots.txt` says
     `Disallow: /` and pages carry `<meta name="robots" content="noindex, nofollow">`.
   - `/afspraak` shows the booking widget; `/privacy` and `/algemene-voorwaarden` load and
     are linked from the footer.
4. Create editor accounts under **Gebruikers** (role `editor`); they get a forced password
   change on first login too (no two-step verification for editors).
5. The provider signs in, changes the password, sets up two-step verification exactly as in
   step 2 (§17) and connects Google under **Mijn agenda** (`booking-runbook.md` §8).

**Keep `seo.allowIndexing` off for the entire life of staging.**

---

## 7. Rollback

### Code

Baseline tag **`webshop-baseline-2026-09-23`**
(`a793d1e8105bf125087fd3e78660eb5010726b8d`) is the last commit before any CMS work.

```bash
# revert just the app directory to the baseline
git checkout webshop-baseline-2026-09-23 -- website

# or restore the entire repository from the offline bundle
git clone '<workspace>/.winston/repos/de-bikefit-studio/baselines/webshop-baseline-2026-09-23.bundle' restored
```

The bundle sits at `.winston/repos/de-bikefit-studio/baselines/` relative to the workspace
root (the folder that contains `de-bikefit-studio/`); verify with
`git bundle verify '<path>/webshop-baseline-2026-09-23.bundle'`.

Faster on Vercel: **Promote** or redeploy an earlier deployment from the Deployments tab.

### Database

**Nothing needs undoing.** All migrations (0000–0007) are additive; the webshop tables and data
are identical before and after, and rolling back the code alone restores the previous
behaviour. Older code ignores the booking tables, `cms_integration_settings`, the `cms_mfa_*`
tables and the new `cms_sessions` columns; a page that uses the `booking` block reads as
unpublished on code that predates it.

The `cms_*` tables can stay in place. To remove them, drop the twenty-five `cms_*` tables plus
the `cms_role` and `cms_page_status` enum types. For a clean slate, reset the Neon `Staging`
branch from its parent (`DEPLOYMENT.md` §7, mind the anonymisation warning) and re-run §3.

---

## 8. Before PRODUCTION — checklist

Staging can run as-is. Production must not go live until every box is ticked, and every
production step (database, env vars, DNS, deploy) needs an explicit go; Arend executes.

**Google, e-mail, analytics**

- [ ] **Google Cloud OAuth client** exists with the production redirect URI
      `<production origin>/api/google/oauth/callback` registered exactly, and the **OAuth
      consent screen is published** ("In production"); otherwise refresh tokens expire after
      7 days (`booking-runbook.md` §3–4).
- [ ] **Resend domain verified** (SPF, DKIM, DMARC) and a production API key created
      (`booking-runbook.md` §6).
- [ ] **GA4 property** with a web stream for the production domain, and the **service
      account** added as Viewer on the property (`booking-runbook.md` §5).

**Environment variables (Vercel → Production)**

- [ ] `DATABASE_URL` (Neon `production`, pooled), a fresh `CMS_SESSION_SECRET` (never
      staging's), a fresh `CMS_MFA_ENCRYPTION_KEY` (never staging's; set before the deploy,
      §16), `NEXT_PUBLIC_SITE_URL` = the production origin.
- [ ] `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, a production-only
      `GOOGLE_TOKEN_ENCRYPTION_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`,
      `NEXT_PUBLIC_GA4_MEASUREMENT_ID`, `GA4_SERVICE_ACCOUNT_JSON`, optionally
      `GA4_PROPERTY_ID`. Staging keeps its own values. The e-mail values and the gift voucher
      order inbox may instead be set by an admin in `/admin/email` (§13); an env value wins.

**Database (Neon `production`)**

- [ ] `db:migrate` (0000–0007, before the deploy that needs them, §16), then `cms:bootstrap`
      (change the admin password and set up two-step verification immediately), `cms:seed`,
      `cms:seed-booking` (the provider changes the password and sets up two-step verification
      at the first sign-in, §17) — or, if production already has content,
      `cms:seed -- --refresh-slug` for **`afspraak`**, **`privacy`** and
      **`algemene-voorwaarden`**.
- [ ] **Retention** scheduled: `npm run cms:retention` monthly against production, dry run
      first, `-- --apply` after reading the counts (`booking-runbook.md` §11.3).

**Content and legal**

- [ ] **Public contact e-mail** set in *Instellingen → Contact*, then the two legal pages
      refreshed so the texts carry it (`booking-runbook.md` §11.2). Also street address and
      postal code, so the `LocalBusiness` JSON-LD is complete.
- [ ] **Lawyer review** of the privacy statement and the terms, and the processor agreements
      and verwerkingsregister done (`booking-runbook.md` §11.5).
- [ ] **VAT number** and legal name under *Instellingen → Organisatie*.
- [ ] **Placeholder testimonials** replaced with real, attributable reviews, or the block
      deleted (they are flagged `isPlaceholder` and render nothing).
- [ ] **Pricing** decided: real prices entered and the flag cleared, or deliberately hidden.
- [ ] **Photography** replaced with real studio photos via *Media*, Dutch alt text on every
      image.
- [ ] **Content-Security-Policy**: the admin CSP enforced and validated on staging (§15,
      `admin-csp.md`); public-site CSP decided (not set yet; `booking-runbook.md` §11.4).

**Go-live**

- [ ] **DNS**: add the domain in Vercel, let it issue the certificate, then switch the
      record; `NEXT_PUBLIC_SITE_URL` must equal that domain.
- [ ] **Flip `seo.allowIndexing` to `true`** on the production database only; verify
      `/robots.txt` switches to `Allow: /` and pages lose `noindex`.
- [ ] **`/sitemap.xml`** lists exactly the pages to index; submit it in Google Search
      Console.
- [ ] **End-to-end check** on production as in `booking-runbook.md` §9 (free/busy, event,
      mail, cancel, consent before GA4, dashboard).

---

## 9. Rolling out the offer redesign (Aanbod, 13 Oct 2026)

Brings an existing staging database to the redesign: `/`, `/aanbod` (since 17 Oct 2026 the offerings are rows, §19, not pages),
`/voor-wie`, `/bikefit`, `/ons-team`, the `main` and `footer` menus, `/over-ons` unpublished
(row and snapshot kept) with a 301 to `/ons-team`. Nothing else: no settings (contact, SEO,
analytics), no legal pages, no `/afspraak`, `/contact` or `/veelgestelde-vragen`, no users, and
**no booking data** — the five service ids, providers, subscriptions and bookings are verified
unchanged before and after.

**New migrations: none.** The new block types are validated in code (`cms_blocks.type` is
`text`). **Do not run a full `cms:seed`** on staging: it would overwrite every seeded page.

Order (the old build cannot render the new block types, so code goes first):

1. **Release gate** on the exact SHA (six steps).
2. **Deploy** the feature/staging push; wait for the staging build to be READY. The new code
   renders the old content unchanged (verified locally; `/aanbod` and `/ons-team` answer 404
   until step 5).
3. **Dry run** — writes nothing: no admin session, no audit entry, and the planner runs on a
   database handle that throws on any write (`scripts/lib/aanbod-rollout-run.mts`; self-test
   section 15 proves it). Prints `would act as <admin>`, every page/menu/redirect action, the
   reasons, any blockers (`!`) and the offer ↔ booking report:

   ```bash
   DATABASE_URL='<staging pooled url>' npm run cms:rollout-aanbod
   ```

   Expect: `~` for `/` and `/bikefit`, `+` for the three new pages, `~ menu main/footer`,
   `~ page /over-ons — unpublish`, `+ redirect /over-ons → /ons-team`, "Bikefit – huidige
   fiets — online booking", the six others "enquiry", and the booking counts. A line with `!`
   (unpublished draft edits on an overwritten page, a translation-group clash, or an existing
   `/over-ons` redirect to somewhere else) blocks the apply: resolve it, or for drafts pass
   `--allow-draft-overwrite` once you have checked them (the backup keeps them either way).
4. **Neon snapshot** — create a branch from `Staging` (e.g. `staging-pre-aanbod-2026-10-13`).
5. **Apply**:

   ```bash
   DATABASE_URL='<staging pooled url>' npm run cms:rollout-aanbod -- --apply \
     --expect-host '<host part of the staging DATABASE_URL>'
   ```

   `--expect-host` must equal the host the script prints on its first line (`→ driver:
   neon-http (<host>)`); any other host is refused, so the command cannot hit another branch
   by accident. It writes a JSON backup of every row it will overwrite to
   `website/.rollout-backups/aanbod-rollout-<timestamp>.json` **before** the first write (keep
   it with the deploy log; it holds page and menu content, no personal data or secrets), then
   publishes the pages one by one, replaces both menus, creates the redirect, unpublishes
   `/over-ons`, and checks the booking tables. Audit log: `rollout.aanbod.overwrite` per
   overwritten page (old draft and live block list + backup name), the repo's own
   `block.delete` / `page.publish` / `navigation.update` / `redirect.create` /
   `page.unpublish` entries, and `rollout.aanbod.apply`. Running it again prints "nothing to
   do".
6. **Cache.** The script writes outside the app, so the app's tag cache is not busted: pages,
   menus and redirects switch over within **5 minutes** (the readers' fallback revalidation),
   and the first request after that may still serve the old version once. Wait 5 minutes,
   load each page twice, then verify. (A redeploy does not reliably clear Vercel's data cache.)
7. **Verify** on the stable alias: `site-health`, plus `/aanbod` (two groups, seven cards,
   "Prijs op aanvraag"), the `/aanbod/<slug>` offerings (§19), `/voor-wie`, `/bikefit`,
   `/ons-team` (Robin and Goran: initials and "Een uitgebreid profiel volgt binnenkort."), `/over-ons` → 308 to `/ons-team`, the main menu (no Home), and
   `/afspraak?dienst=bikefit-huidige-fiets` (widget with Volwassenenfit/Jeugdfit, "Je boekt
   voor …") and `/afspraak?dienst=lactaattest` (contact prompt, no widget). Do not create
   bookings to test.

**Rollback.** Content: `npm run cms:rollout-aanbod -- --restore <backup.json> --expect-host
'<host>'` puts back the overwritten pages (fields, live snapshot and draft blocks), both menus,
re-publishes `/over-ons`, and unpublishes/disables what the rollout created (nothing is
deleted). Or restore the Neon snapshot branch from step 4. Code: redeploy the previous
staging deployment — but restore the content **first**, because old code cannot render the new
block types.

**Images.** The three temporary images ship in the build (`public/images/editorial/`); nothing
to upload. Replacing one later: `docs/editorial-images.md`.

## 10. Booking CTA patch ("Boek je bikefit" → /afspraak, 13 Oct 2026)

The accent band "Comfort is een keuze. Maak ze." on `/veelgestelde-vragen`, `/contact` and
`/afspraak` was seeded with a "Boek je bikefit →" button that dialled the phone. It now goes
where the header's "Afspraak maken" goes (`/afspraak`); seeds and block defaults are fixed in
code, and `npm run cms:patch-booking-cta` corrects pages that already exist. It changes only
the `href` of links labelled "Boek je bikefit…" that point at `tel:` or `#contact`; labels,
styles, the visible phone-number links and all other content stay as they are. Unpublished
pages are reported and left alone; settings, menus, redirects, media, users and booking tables
are never written (booking counts verified before and after). **No migrations. Never a full
`cms:seed` or a rerun of `cms:rollout-aanbod` for this.**

1. Deploy the code first (release gate, staging READY). The code change alone does not alter
   existing pages.
2. **Dry run** — read-only like §9 (no session, no audit, write-refusing db handle; self-test
   section 16):

   ```bash
   DATABASE_URL='<staging pooled url>' npm run cms:patch-booking-cta
   ```

   Expect `~ page /afspraak`, `~ page /contact`, `~ page /veelgestelde-vragen`, each
   `retarget 1 link(s)` with `"Boek je bikefit →" tel:+32473952633 → /afspraak`, then
   `dry run: run again with --apply to write`. A `!` line means that page has unpublished draft
   edits: the apply refuses (it never publishes an editor's draft). Publish or discard that
   draft in `/admin` first, then dry-run again. Any other page in the list: check it before
   applying.
3. **Apply** (Neon snapshot first is optional for a three-link change; the tool writes its own
   backup before the first write):

   ```bash
   DATABASE_URL='<staging pooled url>' npm run cms:patch-booking-cta -- --apply \
     --expect-host '<host part of the staging DATABASE_URL>'
   ```

   Backup: `website/.rollout-backups/booking-cta-patch-<timestamp>.json` (page rows and blocks
   only). It updates the blocks through the repo, publishes each page, re-checks that nothing
   is left to patch and the booking tables are unchanged, and logs `patch.booking-cta.apply`
   in the audit log. The short-lived admin session is revoked in every case. A second run
   prints "nothing to do".
4. **Verify** after 5 minutes (cache fallback, see §9 step 6): on the three pages the "Boek je
   bikefit" button links to `/afspraak`, the "0473 95 26 33" links still use `tel:`.

**Rollback:** `npm run cms:patch-booking-cta -- --restore <backup.json> --expect-host '<host>'`
puts the page rows and draft blocks back exactly (the backup uses the §9 format and restore).

---

## 11. Page cleanup patch (Toshoni's site review, 13 Oct 2026)

What the review changes, and where:

| Where | Code (deploy) | Content (`cms:patch-page-cleanup`) |
| --- | --- | --- |
| Top-level pages | no visible "Home / …" breadcrumb (JSON-LD stays; nested pages keep theirs), compact top spacing | — |
| `/aanbod`, `/voor-wie`, `/ons-team` | card/name headings become `<h2>` when the section has no title | kicker without "· Ninove"; no "Waar je ook staat" / "Wie je ontmoet" heading; "Junioren" → "Jeugd" and the new junior text; meta description of `/voor-wie` |
| `/afspraak` | widget headings follow the section level | page head, "Vier manieren om te boeken", the "Boek je bikefit" contact section and closing band removed; kicker "Online boeken" emptied; "Andere vraag?" (mail + phone) appended to "Voor je komt" |
| `/contact` | redirects keep the query string (`/contact?dienst=x` → `/afspraak?dienst=x`) | 301 → `/afspraak`, then the page unpublished (row, draft, snapshot kept) |
| Menus | — | "Contact" links → `/afspraak` (labels kept) |
| Footer | identity line and "Ninove · Op afspraak" note removed | settings `contact.email` `""` → `info@debikefitstudio.be` |

Every field edit names the value it expects (the seed at `staging@9c655fe`); a field an editor
changed since, a page with unpublished draft edits, an existing `/contact` redirect to another
target or a different e-mail address makes the patch refuse — no override. **No migrations.
Never a full `cms:seed`, `--refresh-slug` or a rerun of `cms:rollout-aanbod` for this.**

1. Deploy the code first (release gate, staging READY). Old content renders fine on the new
   code; the footer shows the e-mail only once step 3 has run.
2. **Dry run** (read-only like §9; self-test section 17):

   ```bash
   DATABASE_URL='<staging pooled url>' npm run cms:patch-page-cleanup
   ```

   Expected, in this order: `~ page /aanbod — 1 change(s)`, `~ page /voor-wie — 7 change(s)`,
   `~ page /ons-team — 3 change(s)`, `~ page /afspraak — 6 change(s)` (each change listed),
   `~ page /contact — unpublish`, `+ redirect /contact → /afspraak (301) — create`,
   `~ menu main` and `~ menu footer — "Contact" /contact → /afspraak`,
   `~ settings contact.email — "" → info@debikefitstudio.be`, the guard counts, then
   `dry run: run again with --apply to write`. **Stop and report on any `!` line.**
3. **Apply** (optional Neon snapshot first; the tool writes its own backup before the first
   write):

   ```bash
   DATABASE_URL='<staging pooled url>' npm run cms:patch-page-cleanup -- --apply \
     --expect-host '<host part of the staging DATABASE_URL>' --backup-dir <dir>
   ```

   Backup `page-cleanup-patch-<timestamp>.json`: rows and blocks of the five pages, both menus,
   and the contact settings value. Order: e-mail, pages (publish last per page), redirect, then
   unpublish `/contact`, menus. It verifies the published snapshots, the redirect, the menus
   and the e-mail, checks the booking tables are unchanged, audits `patch.page-cleanup.apply`
   and always revokes its session. A second dry run prints `dry run: nothing to do`.
4. **Verify** after the 5-minute cache window (load each page twice): see the smoke list in the
   work-block report; no bookings, no mail.

**Rollback:** `npm run cms:patch-page-cleanup -- --restore <backup.json> --expect-host '<host>'`
restores the five pages (re-publishing `/contact`) and both menus, disables the `/contact`
redirect and sets `contact.email` back (other contact fields untouched). Then, if needed, the
code: redeploy `staging@9c655fe`.


## 12. Gift voucher patch ("Cadeaubon", 13 Oct 2026) — superseded

**Superseded on 17 Oct 2026:** `cms:patch-cadeaubon` no longer exists. The voucher page is
seeded at `/cadeaubon` and its card is on the `/aanbod` catalogue block; an existing database
gets both through `cms:migrate-aanbod` (§19). Kept for the record.

What it adds, and where:

| Where | Code (deploy) | Content (`cms:patch-cadeaubon`) |
| --- | --- | --- |
| `/aanbod/cadeaubon` | block `giftVoucher` (order form + server action, `src/lib/gift-voucher/`) | page created with one `giftVoucher` block and published |
| `/aanbod` | category `overige` ("Overige"); a `giftVoucher` page becomes a card "Bedrag naar keuze" | catalogue groups: "Overige" appended after Bikefit and Begeleiding (exact-value guard) |

Nothing else: no settings, menus, redirects, booking tables, migrations or env vars. Home and
`/bikefit` keep their own groups. Independent of §11 (different fields); run it after §11.
The order recipient is **not** set by any patch: it is `/admin/email` (§13)
or env `GIFT_VOUCHER_RECIPIENT` (see `booking-runbook.md` § Cadeaubon), and stays empty until
a working inbox is chosen, so orders show "niet verstuurd". **Never a full `cms:seed` or
`--refresh-slug` for this.**

1. Deploy the code first (release gate, staging READY). Old content renders unchanged on the
   new code.
2. **Dry run** (read-only; self-test section 18):

   ```bash
   DATABASE_URL='<staging pooled url>' npm run cms:patch-cadeaubon
   ```

   Expected: `+ page /aanbod/cadeaubon — create and publish`,
   `~ page /aanbod — 1 change(s), then publish` with `offerCatalogue.groups: "…meegroeit.\"}]…" →
   "…meegroeit.\"},{\"category\":\"overige\",\"title\":\"Overige\",\"lede\":\"\"}]…"`, the guard
   counts, then `dry run: run again with --apply to write`. **Stop and report on any `!` line.**
3. **Apply** (the tool writes its own backup before the first write):

   ```bash
   DATABASE_URL='<staging pooled url>' npm run cms:patch-cadeaubon -- --apply \
     --expect-host '<host part of the staging DATABASE_URL>' --backup-dir <dir>
   ```

   Backup `cadeaubon-patch-<timestamp>.json` (the `/aanbod` row and blocks; the new page is
   recorded as created). Order: voucher page (create, block, publish), then `/aanbod` (groups,
   publish). It verifies both published snapshots, checks the booking tables, audits
   `patch.cadeaubon.apply` and always revokes its session. A second dry run prints
   `dry run: nothing to do`.
4. **Verify** after the 5-minute cache window (GETs only, load twice): `/aanbod` lists
   "Overige" last with a "Cadeaubon" card ("Bedrag naar keuze") linking to `/aanbod/cadeaubon`;
   that page has one `<h1>` "Cadeaubon", the breadcrumb Home / Aanbod / Cadeaubon, the labels
   "Bedrag in euro", "Persoonlijke boodschap", "Voornaam en naam", "E-mail", "Telefoon" and the
   button "Bestel nu". `/afspraak?dienst=cadeaubon` shows the normal widget, not an enquiry.
   **Do not submit the form against a configured mail provider** unless an order mail to the
   studio is intended; without an API key (env or `/admin/email`) a submit shows "Je
   bestelling is niet verstuurd" and sends nothing (that is the expected staging state today).

**Rollback:** `npm run cms:patch-cadeaubon -- --restore <backup.json> --expect-host '<host>'`
unpublishes `/aanbod/cadeaubon` (row kept; a later apply re-publishes it) and puts `/aanbod`
back. Then, if needed, the code. Mail delivery itself is configured separately:
`docs/booking-runbook.md` § 12.

## 13. E-mail service in the admin (`/admin/email`, migration 0004, 13 Oct 2026)

Admins can set up the e-mail service themselves: **Beheer → E-mail** (`/admin/email`,
permission `email.manage`). API key (write-only, stored AES-256-GCM sealed in
`cms_integration_settings`, key derived from `CMS_SESSION_SECRET`), sender, reply-to, gift
voucher order inbox, a status card and a test-mail button. Env variables keep working and win
per field. Details: `cms-architecture.md` (site settings section) and `booking-runbook.md` §6.7.
With the security release (§15), storing or removing the key and saving the addresses are
sensitive changes: an admin confirms their identity first (*Bevestig je identiteit*, password
and code, valid 5 minutes).

**Release steps (staging):** as written below for a build **without** the security release.
A build that contains it (§14, §15) must not be deployed before 0005 and 0006 exist: then
follow the combined order in §16, which migrates 0004 in the same run.

1. Deploy the code (release gate, READY). Safe before the migration: a missing table counts as
   "nothing stored"; `/admin/email` then shows a red notice and refuses to save.
2. **Migrate** (additive, idempotent; 0004 creates only `cms_integration_settings`):

   ```bash
   DATABASE_URL='<staging pooled url>' npm run db:migrate
   ```

   Expect `→ driver: neon-http (<host>)` and `✓ migrations applied to Neon`. Re-running is a
   no-op.
3. **Verify** (admin login, nothing sent): `/admin/email` loads without the red notice; Status
   reads "Niet ingesteld" with *Te doen* for API key, sender and recipient; the nav shows
   "E-mail" for admins only. Optional: save an invalid sender (`abc`) and see it refused
   (with the security release: within 5 minutes of signing in, or after *Bevestig je
   identiteit*). Do **not** paste a real key or press *Testbericht versturen* unless sending
   is intended.
4. `CMS_SESSION_SECRET` must stay as it is: rotating it makes a stored key unreadable (the page
   then says so; nothing is sent until the key is pasted again).
5. After a prod→staging refresh, `anonymize-staging.sql` has cleared the stored key and the
   order inbox (`DEPLOYMENT.md` §7): set a staging key and a staging inbox again before testing
   sends.

**Rollback:** code back to the previous SHA; the table can stay (older code ignores it). If a key
was stored and must go: **Opgeslagen sleutel verwijderen** in `/admin/email` first.

---

## 14. Admin two-step verification (TOTP, migration 0005, 13 Oct 2026)

Admins now sign in with a password **and** a code from an authenticator app (1Password or a
free app such as Aegis, Ente Auth or Google Authenticator); recovery codes cover a lost
phone. Editors and providers were unchanged by this step; providers followed on 16 Oct 2026
(§17), editors stay as they are. Design: `cms-architecture.md` §4, "Two-step
verification". It needs one migration and one new secret, in this order. Arend executes;
staging is autonomous after the release gate, production needs Toshoni's go. It ships together
with §15 (same branch, `feat/security-baseline-20261013`); rolling both out after §13: the
combined order in §16. The steps below are the detail of that order.

1. **Secret first.** Generate a staging-only key (`openssl rand -base64 32`), store it in
   1Password, then set `CMS_MFA_ENCRYPTION_KEY` in Vercel → Preview (branch `staging`) as
   *Sensitive*. Preview deployments of other branches that use the staging database need it
   too, or admins (and, since §17, providers) cannot sign in there. Never print, paste or log the value.
2. **Snapshot**, then migrate (additive, guarded; the running build keeps working on the
   extended schema):

   ```bash
   DATABASE_URL='<staging pooled url>' npm run db:migrate
   ```

   Expect `0005_cms_admin_mfa` to be applied and `✓ migrations applied to Neon`; the same run
   applies `0004_integration_settings` if §13 has not run yet, `0006_cms_session_limits`
   (§15) and `0007_cms_mfa_rate_limits` (§16), since the code ships them together. Check: `cms_mfa_factors`,
   `cms_mfa_recovery_codes`, `cms_mfa_challenges`, `cms_mfa_attempts` exist and
   `cms_sessions.mfa_verified_at` is a nullable column.
3. **Deploy** the code (release gate, READY). From that moment every existing **admin**
   session is refused: admins are sent to sign in again.
4. **First admin sign-in** (Toshoni, `contact@toshoni.be`): password → *Tweestapsverificatie
   instellen* → scan the QR code → six-digit code → store the ten recovery codes in 1Password
   with the account → dashboard. No lockout: an admin without an authenticator always gets the
   enrolment step after the password. *Gebruikers* shows "Tweestapsverificatie aan".
5. **CLI scripts** (`cms:seed`, `cms:rollout-aanbod`, `cms:patch-booking-cta`,
   `cms:patch-page-cleanup`, `cms:migrate-aanbod`) act only as an admin who has enrolled;
   until step 4 is done they stop, dry runs included, with "no active admin has two-step
   verification yet".
6. **Checks:** `/admin/login` does **not** show "Tweestapsverificatie is op deze server niet
   geconfigureerd" (if it does, the key is missing or malformed: fix it in Vercel, redeploy); a
   wrong code is refused; `/admin` without a session goes to the login page; an editor still
   signs in with a password only; the audit log shows `auth.mfa_enrol` and `auth.mfa_verify`.

   **Order matters:** the new build reads the 0005 tables at sign-in, so deploying it before
   step 2 breaks `/admin/login` until the migration runs. Migrate first.

**Lost authenticator.** Sign in with a recovery code, then *Mijn account →
Tweestapsverificatie → Authenticator vervangen*. Authenticator **and** recovery codes lost:
another admin uses *Gebruikers → Tweestapsverificatie resetten* (the user gets a temporary
password). No other admin: break-glass with database access, dry run first:

```bash
DATABASE_URL='<staging pooled url>' npm run cms:mfa-reset -- --email <address>
DATABASE_URL='<staging pooled url>' CMS_BREAK_GLASS_PASSWORD='<new temporary password>' \
  npm run cms:mfa-reset -- --email <address> --apply \
  --expect-host '<host part of the staging DATABASE_URL>'
```

It replaces the password by the temporary one (≥ 12 characters, lower, upper, digit; hand it
over out of band, it must be changed at sign-in), revokes every session, removes that user's
authenticators, recovery codes and challenges, clears their failed-attempt log and writes
`auth.mfa_break_glass` to the audit log. It prints no secret. Without
`CMS_BREAK_GLASS_PASSWORD` the password stays as it was and whoever knows it can enrol first:
only do that when the user is ready to sign in right away.

**Locked out by someone guessing codes** (they know the password; the audit log shows
`auth.mfa_failed` after `auth.login`): a new password stops it and clears the counter. Another
admin resets the password (or MFA) under *Gebruikers*; with no other admin, use the break-glass
command above with a temporary password.

**Key rotation or loss.** Stored authenticators become unreadable ("gebruik een
herstelcode"); recovery codes still work, after which each admin replaces the authenticator.

**Rollback.** Code first: redeploy the previous build; it ignores the new tables and column,
so admins sign in with a password only again (MFA is then simply off). The migration does not
need to be undone; leave the tables in place for a later re-deploy. A refresh of staging from
production empties the `cms_mfa_*` tables (`scripts/anonymize-staging.sql`), after which
staging admins enrol anew.

**Production** (after Toshoni's go): the same steps with a production-only key in Vercel →
Production, `db:migrate` against Neon `production` after a snapshot, deploy, then the first
admin enrols immediately.

---

## 15. Admin session limits, step-up, stronger password hashing and admin CSP (migration 0006, 13 Oct 2026)

Security block 3, on the same branch as §14 (`feat/security-baseline-20261013`) and rolled out
together with it or right after it (combined order: §16). Design: `cms-architecture.md` §4
(Passwords, Sessions, Step-up) and `docs/admin-csp.md`. No new secret. Arend executes; staging
is autonomous after the release gate, production needs Toshoni's go.

What changes for people:

- **Admins** are signed out after **15 minutes without a request** and **8 hours after
  signing in** at the latest. Editors and providers keep their 14-day sessions (a separate
  decision, not changed silently).
- **Sensitive admin changes** (create a user, change a role, (de)activate, reset a password,
  change your own password, change the e-mail service settings in `/admin/email`) need
  *Bevestig je identiteit* (password + code) within the last 5 minutes. Signing in counts; the
  form sits above those forms.
- **Password hashes** get stronger at the next sign-in of each user (automatic, nothing to do).
- **`/admin` sends a Content-Security-Policy in report-only mode**: nothing is blocked yet.

Steps:

1. **Snapshot**, then migrate (additive, guarded; old builds ignore the two new columns):

   ```bash
   DATABASE_URL='<staging pooled url>' npm run db:migrate
   ```

   Expect `0006_cms_session_limits` (and `0004_integration_settings` / `0005_cms_admin_mfa` /
   `0007_cms_mfa_rate_limits` if §13 / §14 have not run yet) to be applied; after §14 step 2 this is a no-op. Check:
   `cms_sessions.absolute_expires_at` and `cms_sessions.reauthenticated_at` exist as nullable
   `timestamptz`. Nothing else changes.

   **Order matters:** the new build reads both columns on every admin request, so deploying it
   before the migration breaks `/admin`. Migrate first.
2. **Deploy** (release gate, READY). Existing admin sessions that have been idle for more than
   15 minutes, or are older than 8 hours, end at once: sign in again.
3. **Checks** (Toshoni or Winston, on the staging URL):
   - sign in as admin (password + code); *Gebruikers* shows "Identiteit bevestigd: je kan tot
     HH:MM gebruikers beheren";
   - wait 6 minutes (or sign in more than 5 minutes earlier), try *Rol wijzigen*: the form
     answers "Bevestig eerst je identiteit …"; confirm with password + code; the change works;
   - leave the admin untouched for 16 minutes, then click a menu item: back to the login page;
   - an editor stays signed in as before;
   - audit log: `auth.step_up`, and `auth.mfa_reauth_failed` after a deliberately wrong code.
4. **CSP browser validation** — `docs/admin-csp.md` has the checklist. In short: DevTools on
   each admin screen, the response carries `Content-Security-Policy-Report-Only` with a fresh
   nonce per load, and the console shows **no** `[Report Only] Refused to …` line. Public pages
   carry **no** CSP header (GA4 unaffected). Record the result in the work-block report.

   - [ ] **Clerk on staging (open validation item).** The admin policy is complete only where no
         Clerk publishable key is set (`docs/admin-csp.md` §6). For staging that was assumed, never
         checked on the deployment, and the docs disagree: §2 lists no Clerk keys, but
         `DEPLOYMENT.md` §6 gives Clerk's Development instance to "staging and previews", and a
         Preview variable without a branch filter reaches the `staging` branch too.
         `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` alone is enough to mount `ClerkProvider` on every
         page, `/admin` included. Check:
     - Vercel → Settings → Environment Variables (names only, never values): is
       `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` set for Preview (all branches, or branch `staging`)?
       And for Production?
     - On `/admin/login` signed out and `/admin` signed in: *View page source* has no `clerk-js`
       script or preload, DevTools → Network filtered on `clerk` and `challenges.cloudflare.com`
       shows no request, and no `[Report Only]` line names a Clerk host.

     What the result means:
     - **No key and nothing from Clerk:** the policy is complete for staging. Record "Clerk: not
       loaded" with date and deployment URL. If Production does set the key, this result does
       not cover production: its admin would load Clerk.
     - **Anything from Clerk** (script, request or report), **or a key listed in Vercel** even if
       the page shows nothing yet (the deployment predates the variable; the next one loads
       Clerk): the policy is incomplete and step 4 has not passed, even if Clerk's lines are the
       only ones. Fix it as `docs/admin-csp.md` §6 recommends (move `ClerkProvider` out of the
       root layout into the webshop's layouts, on a feature branch), or remove the Clerk keys
       from staging's scope with Toshoni's go if the shop need not work there, then repeat
       step 4. Widening the policy for Clerk is the last resort (§6 of that doc).

     Until this item is checked and recorded, enforcement stays **off**: `ADMIN_CSP_MODE` stays
     `'report-only'` on staging, and on production until the same check passed with production's
     Clerk configuration.

5. **Switch to enforcement** only after step 4 passed on staging: the one-line change of
   `ADMIN_CSP_MODE` to `'enforce'` in `src/lib/security/admin-csp.ts`, as its own commit through
   the normal branch flow, then repeat step 4 (now nothing may break). Rollback: set it back
   to `'report-only'` and redeploy.

**CLI note.** `cms:seed`, `cms:rollout-aanbod`, `cms:patch-booking-cta`, `cms:patch-page-cleanup`
and `cms:patch-cadeaubon` act through an admin session, which now also ends after 15 idle
minutes; they make requests continuously, so this only matters if a run is paused for that
long — run it again.

**Rollback.** Code first: redeploy the previous build; it ignores the two columns (sessions
then behave as before: 14 days, sliding, no step-up) and sends no admin CSP. The migration does
not need to be undone. Upgraded password hashes stay valid for the old build (same format,
the parameters are read from the hash itself).

**Production** (after Toshoni's go): the same steps against Neon `production` after a
snapshot, then deploy; CSP enforcement on production only after it was enforced and validated
on staging.

---

## 16. Security release on staging: migrations 0004 → 0005 → 0006 → 0007 in one rollout

The order to follow when the security branch (`feat/security-baseline-20261013`: §14 and §15)
reaches staging after the e-mail service of §13, whether or not 0004 is already on the staging
database. One new secret, one migration run, one deploy. Arend executes; staging is autonomous
after the release gate, production needs Toshoni's go.

1. **Release gate** on the exact SHA (six steps).
2. **Secret, before the deploy.** `CMS_MFA_ENCRYPTION_KEY` in Vercel → Preview (branch
   `staging`), *Sensitive*, a staging-only value kept in 1Password (§14 step 1). Leave
   `CMS_SESSION_SECRET` exactly as it is: rotating it signs everyone out, and the e-mail API key
   stored in `/admin/email` is sealed under a key derived from it (§13 step 4).
3. **Neon snapshot**: a branch from `Staging` (e.g. `staging-pre-security-2026-10-13`).
4. **Migrate, once:**

   ```bash
   DATABASE_URL='<staging pooled url>' npm run db:migrate
   ```

   Applies, in this order, whatever the database still lacks: `0004_integration_settings`,
   `0005_cms_admin_mfa`, `0006_cms_session_limits`, `0007_cms_mfa_rate_limits`. Expect
   `→ driver: neon-http (<host>)` and `✓ migrations applied to Neon` (the script does not list
   file names). Check: `cms_integration_settings` and the five `cms_mfa_*` tables exist
   (`cms_mfa_rate_limits` from 0007), the unique index `cms_mfa_challenges_user_id_unique_idx`
   exists, and `cms_sessions.mfa_verified_at`, `absolute_expires_at` and `reauthenticated_at`
   are nullable `timestamptz`. 0007's only data change deletes duplicate sign-in challenges
   (10-minute state), keeping the newest per user. The live build keeps working on the extended
   schema. (A database that once
   ran the security migrations under their earlier numbers does not get 0004 this way:
   `cms-architecture.md` §2, Migrations.)

   **Migrate before deploying:** the security build reads the 0005 tables at sign-in and the
   0006 columns on every admin request, so without them `/admin/login` and `/admin` break;
   without 0007 the admin second step breaks (the challenge upsert needs the unique index, the
   code limits need `cms_mfa_rate_limits`). 0004 is safe either way: the e-mail code treats a
   missing table as "nothing stored".
5. **Deploy** (merge to `staging`, wait for READY). Every existing admin session is refused
   from then on: admins sign in again.
6. **Admin enrolment, right after the deploy** (Toshoni, `contact@toshoni.be`): password (a
   temporary one is replaced first) → *Tweestapsverificatie instellen* → QR code → six-digit
   code → the ten recovery codes into 1Password with the account → dashboard (§14 step 4).
   `/admin/login` must not say "Tweestapsverificatie is op deze server niet geconfigureerd";
   if it does, step 2 is missing or malformed: fix it, redeploy.
7. **Checks:** the two-step checks (§14 step 6), the step-up and idle checks (§15 step 3), and
   `/admin/email` (§13 step 3): no red notice, and a save more than 5 minutes after signing in
   asks for *Bevestig je identiteit* first. No real key, no test message, no bookings.
8. **CSP browser checklist** (`admin-csp.md` §3, `/admin/email` included; §15 step 4). The
   switch to enforcement stays a separate change (§15 step 5).
9. **CLIs from now on.** `cms:seed`, `cms:rollout-aanbod`, `cms:patch-booking-cta`,
   `cms:patch-page-cleanup` and `cms:patch-cadeaubon` refuse to run, dry runs included, until an
   admin has a permanent password and an authenticator (step 6): they stop with "every active
   admin still has a temporary password" or "no active admin has two-step verification yet".
   If the page cleanup (§11) or the gift voucher (§12) is not on staging yet, run it after
   step 6.

**Rollback.** Code first: redeploy the previous build (effects in §14 and §15, Rollback); the
migrations stay, older code ignores the new tables and columns. Keep `CMS_MFA_ENCRYPTION_KEY`
and `CMS_SESSION_SECRET` unchanged for a later re-deploy.

**Production** (after Toshoni's go): the same order with a production-only
`CMS_MFA_ENCRYPTION_KEY` in Vercel → Production, a snapshot of Neon `production`, `db:migrate`,
deploy, and the first admin enrols immediately; CSP enforcement on production only after it was
enforced and validated on staging.

---

## 17. Provider two-step verification (16 Oct 2026, no migration)

Providers ("Aanbieder") now sign in like admins: password **and** a code from an authenticator
app, enrolled at the first sign-in after the deploy, with ten recovery codes. A provider cannot
switch it off (only replace the authenticator), the step-up *Bevestig je identiteit* asks for
the code, and changing the own password needs that step-up within 5 minutes. **Unchanged:**
the provider's session lifetime (14 days, sliding; accepted for this staging-only MFA test,
**not** approved for production; see `cms-architecture.md` §4), editors (password only, unless they kept
an authenticator), admins, permissions, public booking. Design and the policy per role:
`cms-architecture.md` §4, "Two-step verification". Arend executes; staging is autonomous after
the release gate, production needs Toshoni's go.

**No migration, no new secret.** The `provider` role exists since 0002 and the `cms_mfa_*`
tables and `cms_sessions.mfa_verified_at` since 0005; the change is code only. `db:migrate`
has nothing to apply for it. It needs what §16 already set up: `CMS_MFA_ENCRYPTION_KEY` on the
deployment and migrations 0005–0007 applied. If staging's admin signs in with a code today, both
are in place.

Steps:

1. **Release gate** on the exact SHA (six steps).
2. **Precondition:** `<staging alias>/admin/login` does **not** say "Tweestapsverificatie is op
   deze server niet geconfigureerd". If it does, stop: the key is missing (§14 step 1), and
   after the deploy no provider could sign in.
3. **The staging provider's temporary password.** `toshoni@gmail.com` (role provider) has never
   signed in: it still has the temporary password `cms:seed-booking` printed once. Whoever holds
   that password can set up the authenticator first. If it may have travelled (chat, log,
   screenshot) or is lost, an admin replaces it right before the first sign-in: *Gebruikers* →
   *Bevestig je identiteit* → *Wachtwoord resetten* for `toshoni@gmail.com`, and hands the new
   temporary password over directly, never through a log or chat transcript.
4. **Deploy** (merge to `staging`, wait for READY). From now on every provider session is
   refused (`mfa_required`): the dashboard sends the provider to `/admin/login?mfa=1` ("Je account
   vraagt naast je wachtwoord ook een code …"), and the Google connect and callback routes refuse
   it with the same guard check (`cmsAccessDenial()`). Public booking and the calendar sync of an
   already connected provider need no provider session and are unaffected.
5. **First provider sign-in** (Toshoni, as `toshoni@gmail.com`), in this order: `/admin/login` →
   e-mail and temporary password → `/admin/mfa` *Kies een nieuw wachtwoord* (≥ 12 characters,
   lower case, upper case, a digit) → *Tweestapsverificatie instellen* → *Authenticator
   instellen* → scan the QR code (or type the key) in 1Password or an authenticator app → the
   six-digit code → *Bevestigen en aanmelden* → the **ten recovery codes, shown once**: store them
   in 1Password with the provider account → *Ik heb ze bewaard, naar het beheer* → *Mijn agenda*.
   The provider login is a separate entry in the authenticator ("De Bikefit Studio (test)" with
   `toshoni@gmail.com`), next to the admin's.
6. **Checks** (Arend: release gate, site-health, logs; Toshoni or Winston: the browser):
   - before the code, the provider has no session: opening `/admin/agenda` leads back to the
     code step, never to the agenda; a wrong code answers "Die code klopt niet …";
   - after enrolment: *Mijn agenda* loads; as admin, *Gebruikers* shows the provider with
     "Tweestapsverificatie aan" (before: "Geen authenticator: moet tweestapsverificatie
     instellen");
   - as provider, *Mijn account*: authenticator active, ten recovery codes, **no**
     *Tweestapsverificatie uitschakelen*; more than 5 minutes after signing in, *Wachtwoord
     wijzigen* first asks *Bevestig je identiteit* with password **and** code;
   - the provider is still signed in after 16 minutes without a click (standard session; an admin
     would be signed out);
   - an editor still signs in with a password only; an admin is unchanged (password + code);
   - audit log: `auth.login`, `auth.password_change` and `auth.mfa_enrol` for
     `toshoni@gmail.com`; Vercel logs: no `[cms] action_failed` during the sign-in.
7. **Nothing for the CLIs:** they act as an enrolled admin, as before.

**Lost device (provider).** With the recovery codes: sign in with one, then *Mijn account →
Tweestapsverificatie → Authenticator vervangen*. Authenticator **and** codes lost: an admin
signs in, *Gebruikers* → *Bevestig je identiteit* → *Tweestapsverificatie resetten* → the
provider → own password and code. The provider gets a temporary password (shown once to the
admin; hand it over out of band, after checking it is really that person) and at the next
sign-in replaces it and enrols anew. A provider can never reset anyone (*Gebruikers* is
admin-only, the server refuses with `forbidden`). No admin available: the break-glass CLI of §14
works for providers too, dry run first:

```bash
DATABASE_URL='<staging pooled url>' npm run cms:mfa-reset -- --email <provider address>
DATABASE_URL='<staging pooled url>' CMS_BREAK_GLASS_PASSWORD='<new temporary password>' \
  npm run cms:mfa-reset -- --email <provider address> --apply \
  --expect-host '<host part of the staging DATABASE_URL>'
```

The dry run prints `<address> (provider): …` with the counts; `--apply` removes the factor,
recovery codes, challenges and sessions and writes `auth.mfa_break_glass`.

**Rollback.** Code only: redeploy the previous build; there is no migration to undo and no
variable to remove. Effect: providers without an authenticator sign in with a password alone
again and provider sessions without the second step are accepted again. A provider who already
enrolled keeps the authenticator and is still asked for it at sign-in (the previous build asks
anyone who has one) and could switch it off there under *Mijn account*. A refresh of staging from
production empties the `cms_mfa_*` tables (`scripts/anonymize-staging.sql`): providers then
enrol anew, like admins.

**Production** (after Toshoni's go): the same steps; `CMS_MFA_ENCRYPTION_KEY` is already required
there since §16. Each production provider enrols at the next sign-in after the deploy, so tell
them beforehand to have their phone or 1Password at hand.

---

## 18. Beheer → Aanbod (offering settings, migration 0010, 16 Oct 2026) — superseded by §19

**Superseded on 17 Oct 2026:** `cms:migrate-offerings` no longer exists; migration 0010 stays
required and is followed by 0011 (§19). Kept for the record.

What changes: one place in Beheer to decide per offer page whether it is shown, whether it has
Volwassene/Jeugd variants, the price per variant and whether it is booked directly online or
asked for through a form on its page; providers tick what they offer under *Mijn agenda → Mijn
aanbod* (`cms-architecture.md` §15, `booking-architecture.md` §15). Arend executes; staging is
autonomous after the release gate, production needs Toshoni's go.

1. **Release gate** on the exact SHA (six steps).
2. **Neon snapshot** of `Staging` (e.g. `staging-pre-offerings-2026-10-16`).
3. **Migrate before the deploy** (0009 first if staging does not have it yet, then §3.2 for the
   two labels):

   ```bash
   DATABASE_URL='<staging pooled url>' npm run db:migrate
   ```

   Check: `cms_offerings` and `cms_offering_variants` exist and are empty. The live build is not
   affected by the new tables. A push to `staging` deploys by itself, so nothing is pushed or
   merged before this check passed: a build without 0010 in the database refuses every booking
   (fail closed).
4. **Deploy.** Without any row every offer page derives its settings from its block, so the site
   looks as before, with three intended differences: each card and offer page names how it is
   booked ("Online te boeken", "Op aanvraag", or greyed "Tijdelijk niet online te boeken"); an
   offer that is asked for shows the enquiry form on its page instead of a booking button; and a
   directly booked offer that no active provider offers is greyed out with a disabled button.
5. **Save the derived settings (optional, recommended):**

   ```bash
   DATABASE_URL='<staging pooled url>' npm run cms:migrate-offerings                         # dry run
   DATABASE_URL='<staging pooled url>' npm run cms:migrate-offerings -- --apply --expect-host <host>
   ```

   The dry run is read-only (no session, no audit entry) and lists per published offer page
   `+ create` (an exact copy of what the page shows), `! manual` (not exact, e.g. a free-text price
   label or a service that shows its own price in the widget: an editor decides in Beheer →
   Aanbod; the page keeps its current behaviour meanwhile) or `= skip` (draft, or already saved).
   The apply saves only the `create` rows through the repo (audit `offering.update`), checks that
   bookings, services and provider subscriptions are unchanged, and is idempotent. Needs an admin
   with their own password and two-step verification, like the other CLIs (§16 step 9).
6. **Checks** (no booking or enquiry is submitted on staging):
   - `/admin/aanbod` lists every offer page; Bikefit – huidige fiets shows *Volwassene en Jeugd
     apart*, *Rechtstreeks online boeken*, Volwassenenfit / Jeugdfit, no prices.
   - `/aanbod` and the detail page: same Duur ("Volwassene: 1 u 30 min · Jeugd: 1 uur") and
     "Prijs op aanvraag" as before, no `offers` in the Service JSON-LD.
   - `/afspraak?dienst=bikefit-huidige-fiets` opens "Voor wie?" as before;
     `?dienst=lactaattest` names the offer and links to its form.
   - The provider sees *Mijn aanbod* grouped by offer under *Mijn agenda*.
   - Beheer → E-mail: *Ontvanger bestellingen en aanvragen* is the inbox the enquiry form uses
     (empty = every enquiry says "niet verstuurd"; never `contact.email`).

**Rollback.** Code first: redeploy the previous build; it ignores the two tables. To return a
page to its derived behaviour on the new build, delete its row
(`DELETE FROM cms_offerings WHERE page_id = '<id>'`, variants cascade). The tables stay.


---

## 19. The offering is the offer (migration 0011 + `cms:migrate-aanbod`, 17 Oct 2026)

What changes: Beheer → Aanbod owns the whole offer (text, image, shown or not, Volwassene/Jeugd,
duration and price per variant, direct booking or enquiry) and writes the booking services
itself; the seven offer pages under `/aanbod/` and the Diensten screen are gone; `/aanbod/<slug>`
is rendered from the offering; the gift voucher page moves to `/cadeaubon`; a user with the role
Aanbieder gets the provider profile with the account (`cms-architecture.md` §14,
`booking-architecture.md` §14). Arend executes; staging is autonomous after the release gate,
production needs Toshoni's go. §12 and §18 are superseded by this section.

1. **Release gate** on the exact SHA (six steps).
2. **Neon snapshot** of `Staging` (e.g. `staging-pre-aanbod-offerings-2026-10-17`).
3. **Migrate before the deploy** (0011 widens `cms_offerings`; additive):

   ```bash
   DATABASE_URL='<staging pooled url>' npm run db:migrate
   ```

   Check: `cms_offerings` has the columns `slug`, `title`, `contents`, `image`; nothing else
   changed. The live build ignores the new columns.
4. **Deploy and migrate at once.** The new build does not serve the offer pages (the block
   type `offer` no longer exists), and until step 5 ran the offer lists are empty. Run step 5
   right after the staging build is READY; the dry run can run before the deploy.
5. **Convert the offer pages:**

   ```bash
   DATABASE_URL='<staging pooled url>' npm run cms:migrate-aanbod                   # dry run
   DATABASE_URL='<staging pooled url>' npm run cms:migrate-aanbod -- --apply --expect-host <host>
   ```

   The dry run is read-only (no session, no audit entry, writes refused) and lists per offer page
   `+ … create the offering from the page (derived|stored settings), then delete the page`, per
   service no offering books through `+ service … — hidden offering`, `~ page /aanbod/cadeaubon —
   move to /cadeaubon`, `+ redirect /aanbod/cadeaubon → /cadeaubon`, `~ page /aanbod — add the
   voucher card`, the guard counts. A `!` line blocks the apply (a text that does not validate, an
   unpublished draft on `/aanbod`, a redirect pointing elsewhere): fix it in `/admin` first. The
   apply writes a backup JSON of every page it deletes or changes
   (`website/.rollout-backups/aanbod-migrate-<timestamp>.json`) before the first write, acts as
   the enrolled admin, writes the offerings (audit `offering.create` / `offering.update`), moves
   the voucher page, creates the redirect, patches and publishes `/aanbod`, deletes the offer
   pages (audit `page.delete`), verifies the catalogue and the pages, checks the booking tables
   and audits `migrate.aanbod.apply`. A second run prints `nothing to do`.
6. **Cache.** As in §9: the readers' fallback revalidation is 5 minutes; wait, load each page
   twice, then verify.
7. **Checks** (no booking or enquiry is submitted on staging):
   - `/admin/aanbod` lists ten offerings: the seven of the brief (shown) and Gezinspakket, Fit
     aan huis, Inspanningstest (hidden); Bikefit – huidige fiets shows *Volwassene en Jeugd
     apart*, *Rechtstreeks online boeken*, 90 and 60 minutes, no prices, the provider under
     "Aangeboden door". Open one: the text of the former page is there.
   - `/admin/pages` shows one *Aanbod* page and *Cadeaubon* at `/cadeaubon`; no page under
     `/aanbod/`. The admin menu has no *Diensten*.
   - `/aanbod`: three groups, seven cards with their status, "Prijs op aanvraag", the Cadeaubon
     card under Overige → `/cadeaubon`; `/aanbod/bikefit-huidige-fiets` renders with breadcrumb,
     "Volwassene: 1 u 30 min · Jeugd: 1 uur", the booking button; `/aanbod/lactaattest` shows
     the enquiry form; `/aanbod/gezinspakket` and `/aanbod/onbekend` answer 404;
     `/aanbod/cadeaubon` → 308 to `/cadeaubon`; the sitemap lists the seven offerings.
   - `/afspraak`: "Bikefit – huidige fiets" once with Volwassene / Jeugd; Gezinspakket, Fit aan
     huis and Inspanningstest are no longer offered (hidden offerings; show them in Beheer →
     Aanbod if Toshoni wants them back); `?dienst=bikefit-huidige-fiets` narrows,
     `?dienst=lactaattest` links to the form.
   - The provider sees *Mijn aanbod* grouped by offering under *Mijn agenda*; a new user with the
     role Aanbieder (Gebruikers) gets "Het aanbiedersprofiel is meteen aangemaakt." and an agenda
     at the first sign-in.
   - Audit log: `offering.create` per converted page, `page.delete` per deleted page,
     `migrate.aanbod.apply` once.

**Rollback.** Restore the Neon snapshot of step 2, then redeploy the previous build (the old
build needs the offer pages the migration deleted; the backup JSON holds them for reference,
there is no `--restore`). The schema change is additive and can stay.

**Production** (after Toshoni's go): the same steps against Neon `production`, right after
`main` is deployed.
