# Staging runbook — De Bikefit Studio CMS

For someone with Vercel + Neon access who has never deployed this before.
Follow it top to bottom; every command is copy-pasteable and contains **no
secrets** — every secret is passed inline at the moment it is needed.

Scope: bringing the Dutch public site + `/admin` CMS up on **staging**.
The Qarakter webshop's own staging setup (Clerk/Stripe/Mollie test keys,
prod→staging data refresh, PII anonymisation) is unchanged and documented in
[`../DEPLOYMENT.md`](../DEPLOYMENT.md). Read that first if you also need the
shop working on staging.

> **Nothing here has been deployed yet.** This is the procedure, not a record.
> At the time of writing the CMS has only ever run locally on PGlite.

---

## 0. Before you start

| You need | Why |
| --- | --- |
| Neon project access | to create the `staging` branch and copy its pooled URL |
| Vercel project access (role: Member or above) | to set Staging env vars and deploy |
| A local clone + `npm ci` in `website/` | the migrate/bootstrap/seed scripts run from your machine, not from Vercel |
| Node 22.15+ | `scripts/cms-seed.mts` uses `module.registerHooks()` |

The three CMS scripts are **run once, by hand, from your own shell**, pointed at
the staging database. They are not part of the Vercel build, on purpose: a build
step that writes to the database would run on every deploy.

---

## 1. Neon — create the `staging` branch

1. Neon console → the existing project → **Branches** → **New branch**.
2. Name it **`staging`**, parent = the primary/production branch.
   (Copy-on-write, so it is instant and cheap.)
3. Open the branch → **Connection string** → choose the **Pooled** connection
   (the host contains `-pooler`). That string is your staging `DATABASE_URL`.

Keep that string in your password manager or clipboard only — do not paste it
into a file in the repository.

---

## 2. Vercel — environment variables for the Staging environment

Vercel → project → **Settings → Environment Variables**, scope **Staging**
(the custom environment that tracks the `staging` branch — see
`DEPLOYMENT.md` §2). Add:

| Variable | Value | Notes |
| --- | --- | --- |
| `DATABASE_URL` | the staging **pooled** Neon URL from §1 | Without it the app would try PGlite, which `src/db/cms.ts` refuses in production. |
| `CMS_SESSION_SECRET` | output of `openssl rand -base64 48` | Pepper for session-token hashing. Rotating it signs every CMS user out. Must differ from production's. |
| `NEXT_PUBLIC_SITE_URL` | the staging URL, e.g. `https://staging.debikefitstudio.be` | Drives canonicals, `sitemap.xml`, OG image URLs. Set it or every canonical points at localhost. |
| `NEXT_PUBLIC_GA4_MEASUREMENT_ID` | **leave empty** | Readiness only. Nothing reads it today; no analytics script and no analytics cookie ship. |

Generate the session secret with:

```bash
openssl rand -base64 48
```

### Do **not** put `CMS_BOOTSTRAP_PASSWORD` in Vercel

It is needed exactly once, by the `cms:bootstrap` command in §3, and only on
your own machine. Storing it in Vercel leaves the first admin's password sitting
in the deployment environment for its whole life. Pass it inline instead
(§3.2). The running app never reads it.

Also make sure the webshop's existing keys are present for the Staging scope if
you want the shop to work there too (`DEPLOYMENT.md` §2–3). The CMS itself needs
none of them.

---

## 3. Prepare the staging database (once, from your local shell)

All three commands run from the `website/` directory with the staging URL
supplied as an inline environment prefix, so it never lands in a file and never
enters your shell history as a stored variable.

```bash
cd website
npm ci
```

### 3.1 Apply migrations

```bash
DATABASE_URL='<staging pooled url>' npm run db:migrate
```

- `drizzle/0000_webshop_baseline.sql` back-fills the four existing webshop
  tables. Every statement is `CREATE TABLE IF NOT EXISTS` / guarded
  `ADD CONSTRAINT`, so against a Neon branch that already has the webshop it is
  a **complete no-op**.
- `drizzle/0001_cms_foundation.sql` adds the two enums and the eleven `cms_*`
  tables. **Additive only** — no `DROP`, no `TRUNCATE`, no `ALTER` of any
  webshop table.

Expect the command to print the driver (`neon-http`) and the resulting table
list.

### 3.2 Create the first admin

```bash
DATABASE_URL='<staging pooled url>' \
CMS_BOOTSTRAP_PASSWORD='<a strong throwaway password>' \
npm run cms:bootstrap
```

This creates:

- the admin `contact@toshoni.be` with `must_change_password = true`,
- the five default `nl` site settings (including `seo.allowIndexing = false`),
- empty `main` and `footer` menus.

It is idempotent — running it twice changes nothing. The password you pass here
is temporary: the first login forces a change (§5).

### 3.3 Seed the Dutch content

```bash
DATABASE_URL='<staging pooled url>' npm run cms:seed
```

Creates, fills and **publishes** the six Dutch pages (`/`, `/bikefit`,
`/over-ons`, `/veelgestelde-vragen`, `/contact`, `/afspraak`), both menus and the
`/bikefit.html → /bikefit` redirect. It writes through the real write API, so
snapshots, audit entries and permission checks are genuine.

Re-running it is safe: pages and menus are updated in place, settings and
existing redirects are left alone. Once real editing has started, use
`npm run cms:seed -- --only-missing` so it never overwrites edited drafts.

> Run these **one at a time**. Do not run them while a `next dev` is pointed at
> the same database.

---

## 4. Deploy

Two equivalent routes.

**A. Git (preferred — matches `DEPLOYMENT.md`)**

```bash
git push origin staging
```

Vercel builds the `staging` branch into the Staging environment automatically.

**B. Vercel CLI, from the repository root**

The app lives in a subfolder, so the root directory must be `website`:

```bash
cd website
vercel deploy            # preview
vercel deploy --prod     # only for the production environment
```

If the project was linked with **Root Directory = `website`** (as
`DEPLOYMENT.md` §2 specifies), run `vercel` from `website/`. Confirm with
`vercel project ls` / the project's **Settings → General → Root Directory**.

The build needs **no database**: every CMS-backed route is `force-dynamic`, so
`next build` never queries Neon.

---

## 5. First login

1. Open `https://<staging-url>/admin/login`.
2. Sign in as `contact@toshoni.be` with the `CMS_BOOTSTRAP_PASSWORD` from §3.2.
3. You are redirected to `/admin/password` and **cannot reach anything else**
   until you set a new password (minimum 12 characters, with lower case, upper
   case and a digit). Changing it revokes every other session.
4. You land on the dashboard. Check:
   - **Pagina's** — six pages, all "Gepubliceerd".
   - **Instellingen → SEO** — `allowIndexing` is **off**.
   - `https://<staging-url>/robots.txt` says `Disallow: /`.
   - The public pages carry `<meta name="robots" content="noindex, nofollow">`.
5. Create the real editor accounts under **Gebruikers** (role `editor`); they
   also get a forced password change on first login.

**Keep `seo.allowIndexing` off for the entire life of staging.** It is the one
switch between a staging URL and Google's index.

---

## 6. Rollback

### Code

Baseline tag **`webshop-baseline-2026-09-23`**
(`a793d1e8105bf125087fd3e78660eb5010726b8d`) is the last commit before any CMS
work — the webshop exactly as it was.

```bash
# revert just the app directory to the baseline
git checkout webshop-baseline-2026-09-23 -- website

# or restore the entire repository from the offline bundle
git clone '<workspace>/.winston/repos/de-bikefit-studio/baselines/webshop-baseline-2026-09-23.bundle' restored
```

The bundle sits next to the repository, at
`.winston/repos/de-bikefit-studio/baselines/webshop-baseline-2026-09-23.bundle`
relative to the workspace root (the folder that contains `de-bikefit-studio/`).
It records the complete history including the tag — verify any time with:

```bash
git bundle verify '<path>/webshop-baseline-2026-09-23.bundle'
```

On Vercel you can also simply **Promote** an earlier deployment from the
Deployments tab, which is faster than a git revert.

### Database

**Nothing needs undoing.** Both migrations are additive: the webshop tables and
their data are identical before and after. Rolling back the *code alone* fully
restores the webshop, because nothing in the webshop references a `cms_*`
object.

The `cms_*` tables can simply be left in place — they cost nothing and keep the
content if you roll forward again. If you really want them gone, drop the eleven
`cms_*` tables plus the `cms_role` and `cms_page_status` enum types.

If you prefer a clean slate instead, reset the Neon `staging` branch from its
parent (see `DEPLOYMENT.md` §4) and re-run §3.

---

## 7. Before PRODUCTION — checklist

Staging can go live as-is. Production must not, until every box is ticked.

- [ ] **Flip `seo.allowIndexing` to `true`** — in `/admin → Instellingen → SEO`,
      on the production database only. Verify `/robots.txt` switches from
      `Disallow: /` to `Allow: /` and that page `<meta name="robots">` loses
      `noindex`.
- [ ] **Fill in the contact details** — `/admin → Instellingen → Contact`:
      street address, postal code, e-mail address. None of these exist in any
      source material today, so the `LocalBusiness` JSON-LD ships incomplete
      until they are entered.
- [ ] **Fill in the VAT number** (and legal name) under
      `Instellingen → Organisatie`.
- [ ] **Replace the placeholder testimonials.** The four reviews in the
      `testimonial` block are illustrative copy from the content deck and are
      flagged `isPlaceholder`, so they currently render nothing. Either enter
      real, attributable reviews or delete the block.
- [ ] **Decide on pricing.** No amount appears anywhere in the prototype,
      content decks or brand material. The `pricing` block is placeholder-flagged
      and hidden. Either enter real prices and clear the flag, or leave it
      hidden deliberately.
- [ ] **Replace the placeholder photography** with real studio/fit photos,
      uploaded through `/admin → Media` with Dutch alt text on every image.
- [ ] **DNS** — point the production domain at Vercel and set
      `NEXT_PUBLIC_SITE_URL` to that domain, so canonicals, `sitemap.xml` and OG
      image URLs are absolute and correct. Add the domain in Vercel and let it
      issue the certificate before switching the record.
- [ ] **A fresh `CMS_SESSION_SECRET`** for production (never reuse staging's).
- [ ] **Bootstrap the production admin** with §3.2 against the production
      `DATABASE_URL`, then change the password immediately.
- [ ] **Re-check `/sitemap.xml`** lists exactly the pages you want indexed, and
      submit it in Google Search Console once indexing is on.
- [ ] **Booking + analytics remain out of scope** — the main CTA still dials
      `tel:+32473952633`, and no analytics script ships. If GA4 is wanted, follow
      `cms-architecture.md` §12.7, which requires a consent banner first.
