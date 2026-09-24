# Staging runbook — De Bikefit Studio

How the Dutch public site, the `/admin` CMS and online booking are brought up and
updated on **staging**, plus the checklist before production. Every command is
copy-pasteable and contains **no secrets**: each secret or connection string is passed
inline at the moment it is needed and lives only in 1Password and Vercel.

**Who runs this.** Deployments are executed by the DevOps agent **Arend** (OpenClaw).
Previews and staging go automatically once the release gate is green; production, the
production database and DNS only after an explicit go from Toshoni (`../DEPLOYMENT.md` §2).
Arend records every deployment in its infrastructure log, outside this repository. A person
with Vercel and Neon access can follow the same steps.

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
| `CMS_SESSION_SECRET` | `openssl rand -base64 48`, staging's own | Rotating it signs every CMS user out and, without a token key, disconnects Google. Never reuse production's. |
| `NEXT_PUBLIC_SITE_URL` | `https://de-bikefit-studio-git-staging-toshoni.vercel.app` | Canonicals, sitemap, OG, e-mail links, OAuth redirect URI. |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | the shared web client | Staging redirect URI must be registered on the client (`booking-runbook.md` §4). |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32`, staging's own | Optional (falls back to a key derived from `CMS_SESSION_SECRET`); treat as permanent. |
| `RESEND_API_KEY` | staging key | Without it mails are logged and skipped. |
| `EMAIL_FROM`, `EMAIL_REPLY_TO` | sender on the verified domain, reply-to | |
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

All additive and guarded (no `DROP`, `TRUNCATE` or webshop `ALTER`); already-applied files
are skipped. Expect `→ driver: neon-http (<host>)` and `✓ migrations applied to Neon`.

### 3.2 Bootstrap

```bash
DATABASE_URL='<staging pooled url>' \
CMS_BOOTSTRAP_PASSWORD='<a strong throwaway password>' \
npm run cms:bootstrap
```

Creates only what is missing: the admin `contact@toshoni.be` (`must_change_password =
true`), the six `nl` site settings (including `seo.allowIndexing = false` and the `booking`
rules), empty `main` and `footer` menus, the locations "De Bikefit Studio, Ninove" and "Bij
jou thuis", and the five services. Never overwrites anything.

### 3.3 Seed content and the first provider

```bash
DATABASE_URL='<staging pooled url>' npm run cms:seed
DATABASE_URL='<staging pooled url>' npm run cms:seed-booking
```

`cms:seed` creates, fills and **publishes** eight pages (`/`, `/bikefit`, `/over-ons`,
`/veelgestelde-vragen`, `/contact`, `/afspraak`, `/privacy`, `/algemene-voorwaarden`), both
menus and the `/bikefit.html → /bikefit` redirect, through the real write API. Once real
editing has started use `-- --only-missing` or `-- --refresh-slug <slug>` instead of a full
run: a full run overwrites the draft blocks of every seeded page.

`cms:seed-booking` creates the provider `toshoni@gmail.com` (role `provider`, forced password
change; the temporary password is **printed once** — hand it over directly, never through a
log or chat transcript), its profile, hours Mon–Fri 09–18 and Sat 09–13, and subscriptions
to the five services. The public booking widget lists no services until a provider exists.

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
2. You are sent to `/admin/password` and cannot reach anything else until you set a new
   password (≥ 12 characters, lower case, upper case and a digit). Changing it revokes every
   other session.
3. On the dashboard, check:
   - **Pagina's** — eight pages, all "Gepubliceerd".
   - **Diensten**, **Locaties**, **Aanbieders** — five services, two locations, one provider.
   - **Instellingen → SEO** — `allowIndexing` is **off**; `<alias>/robots.txt` says
     `Disallow: /` and pages carry `<meta name="robots" content="noindex, nofollow">`.
   - `/afspraak` shows the booking widget; `/privacy` and `/algemene-voorwaarden` load and
     are linked from the footer.
4. Create editor accounts under **Gebruikers** (role `editor`); they get a forced password
   change on first login too.
5. The provider signs in, changes the password and connects Google under **Mijn agenda**
   (`booking-runbook.md` §8).

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

**Nothing needs undoing.** All four migrations are additive; the webshop tables and data are
identical before and after, and rolling back the code alone restores the previous
behaviour. Older code ignores the booking tables; a page that uses the `booking` block reads
as unpublished on code that predates it.

The `cms_*` tables can stay in place. To remove them, drop the nineteen `cms_*` tables plus
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
      staging's), `NEXT_PUBLIC_SITE_URL` = the production origin.
- [ ] `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, a production-only
      `GOOGLE_TOKEN_ENCRYPTION_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`,
      `NEXT_PUBLIC_GA4_MEASUREMENT_ID`, `GA4_SERVICE_ACCOUNT_JSON`, optionally
      `GA4_PROPERTY_ID`. Staging keeps its own values.

**Database (Neon `production`)**

- [ ] `db:migrate` (0000–0003), then `cms:bootstrap` (change the admin password
      immediately), `cms:seed`, `cms:seed-booking` — or, if production already has content,
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
- [ ] **Content-Security-Policy** decided (not set yet; `booking-runbook.md` §11.4).

**Go-live**

- [ ] **DNS**: add the domain in Vercel, let it issue the certificate, then switch the
      record; `NEXT_PUBLIC_SITE_URL` must equal that domain.
- [ ] **Flip `seo.allowIndexing` to `true`** on the production database only; verify
      `/robots.txt` switches to `Allow: /` and pages lose `noindex`.
- [ ] **`/sitemap.xml`** lists exactly the pages to index; submit it in Google Search
      Console.
- [ ] **End-to-end check** on production as in `booking-runbook.md` §9 (free/busy, event,
      mail, cancel, consent before GA4, dashboard).
