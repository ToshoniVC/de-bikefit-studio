# Staging runbook — De Bikefit Studio

How the Dutch public site, the `/admin` CMS and online booking are brought up and
updated on **staging**, plus the checklist before production. Every command is
copy-pasteable and contains **no secrets**: each secret or connection string is passed
inline at the moment it is needed and lives only in 1Password and Vercel.

**Who runs this.** Deployments are executed by the DevOps agent **Arend** (OpenClaw).
Previews and staging go automatically once the release gate is green; production, the
production database and DNS only after an explicit go from Toshoni (`../DEPLOYMENT.md` §2).
Arend records every deployment in its infrastructure log, outside this repository. A person
with Vercel and Neon access can follow the same steps. The offer redesign of 13 Oct 2026 has its
own rollout procedure in §9.

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
| `RESEND_API_KEY` | staging key | Optional: an admin can store it in `/admin/email` instead (§13); env wins. Without a key anywhere mails are logged and skipped. |
| `EMAIL_FROM`, `EMAIL_REPLY_TO` | sender on the verified domain, reply-to | Optional, same as above. |
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

`cms:seed` creates, fills and **publishes** the Dutch pages (home, `/aanbod` and its seven
offer pages, `/voor-wie`, `/bikefit`, `/ons-team`, `/veelgestelde-vragen`, `/afspraak`,
`/privacy`, `/algemene-voorwaarden`), both menus and the redirects (`/bikefit.html`,
`/over-ons`, `/contact`), through the real write API. Once real
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

---

## 9. Rolling out the offer redesign (Aanbod, 13 Oct 2026)

Brings an existing staging database to the redesign: `/`, `/aanbod`, seven `/aanbod/<slug>`,
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

   Expect: `~` for `/` and `/bikefit`, `+` for the ten new pages, `~ menu main/footer`,
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
   "Prijs op aanvraag"), the seven `/aanbod/<slug>` pages, `/voor-wie`, `/bikefit`,
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


## 12. Gift voucher patch ("Cadeaubon", 13 Oct 2026)

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

**Release steps (staging):**

1. Deploy the code (release gate, READY). Safe before the migration: a missing table counts as
   "nothing stored"; `/admin/email` then shows a red notice and refuses to save.
2. **Migrate** (additive, idempotent; creates only `cms_integration_settings`):

   ```bash
   DATABASE_URL='<staging pooled url>' npm run db:migrate
   ```

   Expect `→ driver: neon-http (<host>)` and `✓ migrations applied to Neon`. Re-running is a
   no-op.
3. **Verify** (admin login, nothing sent): `/admin/email` loads without the red notice; Status
   reads "Niet ingesteld" with *Te doen* for API key, sender and recipient; the nav shows
   "E-mail" for admins only. Optional: save an invalid sender (`abc`) and see it refused.
   Do **not** paste a real key or press *Testbericht versturen* unless sending is intended.
4. `CMS_SESSION_SECRET` must stay as it is: rotating it makes a stored key unreadable (the page
   then says so; nothing is sent until the key is pasted again).

**Rollback:** code back to the previous SHA; the table can stay (older code ignores it). If a key
was stored and must go: **Opgeslagen sleutel verwijderen** in `/admin/email` first.

