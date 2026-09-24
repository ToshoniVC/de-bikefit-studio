# Booking runbook — Google Calendar, GA4 and e-mail

For Toshoni (or whoever holds the Google, Resend, Vercel and 1Password
accounts). Follow it top to bottom the first time; every section can also be
done on its own later.

What this switches on:

| Integration | Without it | With it |
| --- | --- | --- |
| **Google Calendar** (per provider, OAuth) | Availability = business hours minus existing bookings. No Google events. | Busy times in the provider's Google Calendar block slots; every booking becomes an event (without guests) in that calendar. |
| **Resend** (e-mail) | Booking mails are written to the server log and skipped. | Customer gets a confirmation with an `.ics` file and a cancel link; the provider gets a notification. |
| **GA4 tag** (public site) | No analytics at all, no cookie banner. | Cookie banner; GA4 loads **only after "Accepteren"**. |
| **GA4 Data API** (admin dashboard) | Dashboard panel shows "Google Analytics: niet verbonden" with the setup steps. | Dashboard opens with users, sessions, page views, top pages and top sources for the last 28 days. |

Everything degrades gracefully: the booking flow works with none of these set.

> Code references: `src/lib/booking/google.ts` (OAuth + Calendar REST),
> `src/app/api/google/oauth/{start,callback}/route.ts` (connect flow),
> `src/lib/email/**` (Resend), `src/components/studio/{analytics,consent-banner}.tsx`
> (tag + banner), `src/lib/analytics/ga4.ts` (Data API), architecture in
> `docs/booking-architecture.md`.

---

## 0. Before you start

| You need | Why |
| --- | --- |
| A Google account to own the Cloud project (e.g. `toshoni@gmail.com`) | There is no Google Workspace; a personal account can own the project. |
| Access to Google Analytics with the same account | To create the GA4 property. |
| A Resend account and access to the domain's DNS | To send mail from the studio's own domain. |
| Vercel project access (Member or above) | To set environment variables and redeploy. |
| 1Password | Every secret below goes there first, then into Vercel. |
| `openssl` (Git Bash, WSL or macOS terminal) | To generate the token encryption key (§7.2). |

Environments and their public origins (the OAuth redirect URI is always
`<origin>/api/google/oauth/callback`, built from `NEXT_PUBLIC_SITE_URL`):

| Environment | Origin |
| --- | --- |
| Local | `http://localhost:3000` |
| Staging | `https://de-bikefit-studio-git-staging-toshoni.vercel.app` |
| Production | the future domain, e.g. `https://www.debikefitstudio.be` (not decided yet) |

---

## 1. Create the Google Cloud project

1. Open <https://console.cloud.google.com> signed in with the owner account.
   Accept the terms if this is the first project.
2. Project picker (top left) → **New project**.
   - Name: **De Bikefit Studio**
   - Organisation: *No organisation* (there is no Workspace).
   - **Create**, then select the new project in the picker.
3. No billing account is needed for anything in this runbook.

## 2. Enable the two APIs

**APIs & Services → Library**, search and press **Enable** on:

1. **Google Calendar API** — availability (free/busy) and events.
2. **Google Analytics Data API** — the admin dashboard numbers.

(Enabling can take a minute before calls succeed.)

## 3. OAuth consent screen

In the current console this lives under **Google Auth Platform** (menu → APIs
& Services → OAuth consent screen opens it). Click **Get started** the first
time.

1. **App information**
   - App name: **De Bikefit Studio**
   - User support e-mail: your address (shown to providers on the consent screen).
2. **Audience**: **External**.
3. **Contact information**: developer e-mail (same address is fine) → agree to
   the policy → **Create**.
4. **Branding** (optional now): homepage and privacy-policy links can wait until
   the production domain exists. Do **not** upload a logo — a logo triggers
   Google's brand verification.
   - *Authorised domains*: only needed if the console refuses a redirect URI in
     §4. Then add the host: for Vercel hosts the **full** host
     (`de-bikefit-studio-git-staging-toshoni.vercel.app` — `vercel.app` is a
     public suffix), for the production domain the bare domain
     (`debikefitstudio.be`).
5. **Data access → Add or remove scopes**. Tick or paste these four, then
   **Update → Save**:
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.freebusy`
   - `openid`
   - `https://www.googleapis.com/auth/userinfo.email` (shown as `.../auth/userinfo.email` or "email")

   The two calendar scopes are *sensitive*; `openid`/`email` let us show which
   Google account is connected.
6. **Audience → Test users → Add users**: `toshoni@gmail.com` and any other
   provider's Google account. (Only matters while the app is in *Testing*.)
7. **Audience → Publishing status → Publish app → Confirm.** The status must
   read **In production**.

   **Why this matters:** while an External app is in *Testing*, Google expires
   every refresh token after **7 days** — the provider's calendar silently
   disconnects a week after connecting. *In production* tokens do not expire.

   **What to expect:** we do not submit the app for verification. Providers
   will see *"Google hasn't verified this app"* when connecting; they click
   **Advanced → Go to De Bikefit Studio (unsafe)**. An unverified app with
   sensitive scopes is capped at **100 users** in total, which is far more
   providers than we need. If the console nags "Prepare for verification",
   ignore it.

## 4. OAuth client (Web application)

**Google Auth Platform → Clients → Create client**

1. Application type: **Web application**. Name: `bikefit-web`.
2. *Authorised JavaScript origins*: leave empty.
3. *Authorised redirect URIs* — add each one exactly (scheme, host, port, no
   trailing slash):
   - `http://localhost:3000/api/google/oauth/callback`
   - `https://de-bikefit-studio-git-staging-toshoni.vercel.app/api/google/oauth/callback`
   - `https://<production domain>/api/google/oauth/callback` — add as soon as
     the domain is known (with or without `www`, exactly as
     `NEXT_PUBLIC_SITE_URL` will be).
4. **Create.** Copy the **Client ID** and **Client secret** into 1Password
   right away (download the JSON too: newer consoles show the secret only
   once). One client serves all three environments.

Changes to redirect URIs can take a few minutes to take effect.

## 5. GA4 — property, measurement id, service account

### 5.1 Property and web stream

1. <https://analytics.google.com> → **Admin** (gear) → **Create → Property**.
   - Name: **De Bikefit Studio**, time zone **Belgium**, currency **EUR**.
   - Business details / objectives: anything sensible → **Create**.
2. **Data collection → Web**: URL = the production domain (or staging for now),
   stream name `Website` → **Create stream**.
3. Copy the **Measurement ID** (`G-XXXXXXXXXX`) from the stream details.
4. Same page → **Enhanced measurement** (gear) → **Page views → Show advanced
   settings** → **untick "Page changes based on browser history events"** →
   Save. Our tag sends its own `page_view` on every route change; leaving
   this on would count every client-side navigation twice.
5. Leave **Google signals** off (Admin → Data collection). Optional: Admin →
   Data retention → 14 months.
6. **Admin → Property details**: copy the **Property ID** — a number such as
   `412345678`. This is *not* the `G-…` id.

### 5.2 Service account for the dashboard

1. Google Cloud console (same project) → **IAM & Admin → Service accounts →
   Create service account**.
   - Name: `ga4-dashboard` → **Create and continue**.
   - Project roles: **none** (skip) → **Done**.
2. Open the account → **Keys → Add key → Create new key → JSON → Create**. A
   `.json` file downloads. Put it in 1Password as a document, then delete the
   local file.
3. Copy the service account's e-mail
   (`ga4-dashboard@<project-id>.iam.gserviceaccount.com`).
4. Back in GA4 → **Admin → Property access management → + → Add users**:
   paste that e-mail, role **Viewer**, untick "Notify new users by email" →
   **Add**.

### 5.3 Tell the site

1. Vercel env vars (§7): `NEXT_PUBLIC_GA4_MEASUREMENT_ID`,
   `GA4_SERVICE_ACCOUNT_JSON` and optionally `GA4_PROPERTY_ID`. Redeploy —
   Vercel applies changed variables only to a new deployment. (The site reads
   the measurement id on the server through `src/lib/env.ts` and hands it to
   the tag; nothing depends on it being inlined at build time.)
2. `/admin → Instellingen → Analytics`:
   - **GA4 property id**: the number from §5.1.6 (not needed when
     `GA4_PROPERTY_ID` is set; the env var wins).
   - **GA4 measurement id**: the `G-…` id (for reference; the tag itself reads
     the env var).
   - Tick **Analytics ingeschakeld**. Without it the site loads no tag and
     shows no banner.

## 6. Resend — e-mail

1. Sign up at <https://resend.com> (region **EU / Ireland** when asked).
2. **Domains → Add domain** → the studio's domain (e.g. `debikefitstudio.be`).
3. Resend shows DNS records — typically an **MX** and an **SPF TXT** record on
   the `send` subdomain and a **DKIM TXT** record `resend._domainkey`. Add them
   exactly at the domain's DNS provider. Also recommended: a DMARC TXT record
   on `_dmarc` with `v=DMARC1; p=none;`.
4. Back in Resend → **Verify**. Wait until the domain shows **Verified**
   (minutes to a few hours).
5. **API Keys → Create API key**: name `bikefit-staging` (and later
   `bikefit-production`), permission **Sending access**, domain = the verified
   domain. Copy it (shown once) → 1Password.
6. Choose the sender, e.g. `De Bikefit Studio <afspraken@debikefitstudio.be>`
   (any mailbox name on the verified domain; it does not need to exist) and a
   reply-to such as `contact@toshoni.be`.

Before the domain is verified you can only test with
`EMAIL_FROM="De Bikefit Studio <onboarding@resend.dev>"`, and Resend then
delivers **only to the Resend account's own address**.

## 7. 1Password and Vercel

### 7.1 What goes where

Store every value in 1Password first (one vault item per environment, e.g.
"Bikefit — staging integrations"), then add it in **Vercel → Settings →
Environment Variables** for the **Staging** and/or **Production** scope. Mark
the secret ones as **Sensitive**. All names come from `.env.example`.

| Value | Vercel variable | Secret | Scope |
| --- | --- | :-: | --- |
| OAuth client ID (§4) | `GOOGLE_OAUTH_CLIENT_ID` | no | Staging + Production |
| OAuth client secret (§4) | `GOOGLE_OAUTH_CLIENT_SECRET` | **yes** | Staging + Production |
| Token encryption key (§7.2) | `GOOGLE_TOKEN_ENCRYPTION_KEY` | **yes** | one key **per environment** |
| GA4 measurement id `G-…` (§5.1.3) | `NEXT_PUBLIC_GA4_MEASUREMENT_ID` | no | Production (Staging only to test the banner) |
| GA4 property id (§5.1.6) | `GA4_PROPERTY_ID` (or the admin setting) | no | Staging + Production |
| Service-account key JSON (§5.2.2) | `GA4_SERVICE_ACCOUNT_JSON` | **yes** | Staging + Production |
| Resend API key (§6.5) | `RESEND_API_KEY` | **yes** | per environment |
| Sender (§6.6) | `EMAIL_FROM` | no | Staging + Production |
| Reply-to (§6.6) | `EMAIL_REPLY_TO` | no | Staging + Production |
| Public origin | `NEXT_PUBLIC_SITE_URL` (already set) | no | must equal the origin in the redirect URI |

`GA4_SERVICE_ACCOUNT_JSON` accepts the raw JSON or its base64. Base64 avoids
problems with the key's line breaks:

```bash
base64 -w0 key.json        # Linux / WSL / Git Bash
base64 -i key.json         # macOS
```

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("key.json"))
```

Every change to Vercel variables needs a **redeploy** to take effect.

For local testing, put the same names in `website/.env.local` (never in
`.env.example`). The OAuth client already allows `http://localhost:3000`.

### 7.2 Generate `GOOGLE_TOKEN_ENCRYPTION_KEY`

Providers' Google refresh tokens are stored encrypted (AES-256-GCM) with this
key. Generate one per environment:

```bash
openssl rand -base64 32
```

Without `openssl` (PowerShell, cryptographically random):

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```

Leaving it empty falls back to a key derived from `CMS_SESSION_SECRET`.
**Changing either value later makes every stored token unreadable: all
providers must reconnect Google.** Treat it as permanent.

---

## 8. Connect a provider's Google Calendar

Prerequisites: migrations applied, `npm run cms:bootstrap` and
`npm run cms:seed-booking` run against the environment (the latter creates the
provider `toshoni@gmail.com` with a temporary password printed once), the
Google variables set and deployed.

1. Sign in at `/admin/login` as the provider. The first login forces a new
   password.
2. **Mijn agenda** → the Google Agenda card → **Google Agenda koppelen**
   (this opens `/api/google/oauth/start?provider=<id>`; when already connected
   the button reads **Opnieuw koppelen**).
3. Google asks which account to use: pick the account whose calendar holds the
   provider's appointments.
4. *"Google hasn't verified this app"* → **Advanced → Go to De Bikefit Studio
   (unsafe)**.
5. On the permission screen **tick both calendar checkboxes** (Google lets
   people untick them; without both, the connection is refused) → **Continue**.
6. You land on `/admin/agenda?google=connected` ("Google Agenda gekoppeld");
   the card shows *Verbonden als <Google e-mail>*. The provider's **primary**
   calendar is used.

**Ontkoppelen** on the same card revokes the token at Google and forgets it.

An admin can start the same flow from **Aanbieders → <provider>**; it returns
to `/admin/providers/<id>?google=connected`. The Google sign-in must still be
done with the provider's own Google account, so normally the provider does it.

## 9. Verify end to end

Do this on staging after every change to the integrations.

1. **Free/busy is respected.** In the provider's Google Calendar create an
   event two days from now, 10:00–12:00, shown as *Busy*. Open `/afspraak`,
   choose a service and this provider: that day offers no slot that overlaps
   10:00–12:00 (a 90-minute fit cannot start at 09:00 either). Change the
   event to *Free* and reload: the slots return.
2. **The event appears.** Book a slot with your own e-mail. Within seconds the
   provider's calendar shows `<Dienst> — <naam>` at that time, **without
   guests**. Under **Afspraken** the booking shows *Google: gesynchroniseerd*.
3. **Mail arrives.** You receive the confirmation with an `.ics` attachment
   and a cancel link; the provider receives a notification. Resend → *Emails*
   shows both as *Delivered*.
4. **Cancel works.** Open the cancel link: the Google event disappears and both
   parties get a cancellation mail.
5. **Consent before GA4.** In a private window open the site with DevTools →
   Network: the banner shows, and there is **no** request to
   `googletagmanager.com` or `google-analytics.com` and no `_ga` cookie.
   Click **Accepteren**: `gtag/js` loads and a `collect` request with
   `en=page_view` follows; navigating sends another one. GA4 → Reports →
   *Realtime* shows the visit. **Weigeren** loads nothing; the footer link
   **Cookies** reopens the banner.
6. **Dashboard.** `/admin` as admin: the Google Analytics panel shows numbers.
   A new property needs 24–48 h before the Data API returns data (realtime is
   not included), and the panel caches for one hour.

## 10. Troubleshooting

### Connect-flow results

The callback returns to `/admin/agenda` (or `/admin/providers/<id>`) with
`?google=connected` or `?google=error&reason=<code>`:

| `reason` | Meaning | Fix |
| --- | --- | --- |
| `access_denied` | The provider pressed *Cancel* on Google's screen. | Start again and allow access. |
| `missing_scope` | Consent was given without one of the calendar checkboxes. | Start again and tick both boxes. |
| `state` | The 10-minute window passed, the flow was finished in another browser, or it started on a different host than `NEXT_PUBLIC_SITE_URL`. | Start again from the admin on the `NEXT_PUBLIC_SITE_URL` host. |
| `session` | Not signed in to the admin, or signed in as someone else than who started. | Sign in and start again. |
| `forbidden` | The signed-in user may not manage this provider. | Use the provider's own login or an admin. |
| `exchange` | Google refused the authorisation code (often a redirect URI or client secret mismatch). | Check §4 and the Vercel values; start again. |
| `no_refresh_token` | Google returned no refresh token. | Remove the app at <https://myaccount.google.com/permissions>, then connect again. |
| `store` | The tokens could not be saved (provider missing, database or key problem). | Check the server log; verify `GOOGLE_TOKEN_ENCRYPTION_KEY` is base64 of 32 bytes. |
| `google` | Google returned another error. | The message is in the server log. |

A plain-text **503 "Google Agenda is nog niet ingesteld"** means
`GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` are missing in this
environment (set them and redeploy).

### Calendar disconnects after about 7 days

The card shows *"Google-toegang is ingetrokken of verlopen"* a week after
connecting: the consent screen is still in **Testing**. Publish it (§3.7) and
reconnect. The same message appears when the provider removed the app at
<https://myaccount.google.com/permissions>. *"sleutel gewijzigd"* means
`GOOGLE_TOKEN_ENCRYPTION_KEY` or `CMS_SESSION_SECRET` changed (§7.2):
reconnect.

### `Error 400: redirect_uri_mismatch`

The redirect URI we send is `NEXT_PUBLIC_SITE_URL` + `/api/google/oauth/callback`.
It must match one entry in §4 **exactly**: `https` vs `http`, `www` or not,
port, no trailing slash. Check `NEXT_PUBLIC_SITE_URL` for that Vercel
environment, fix the list in the OAuth client, wait a few minutes and retry.
Google's error page shows the URI it received (*error details*).

### `Error 403: access_denied` — "app is being tested"

The app is still in *Testing* and the Google account is not a test user. Add
it (§3.6) or, better, publish the app (§3.7).

### GA4 panel stays "niet verbonden"

The panel names the problem:

- *geen toegang tot property …* → the service-account e-mail is not a
  **Viewer** on the GA4 property (§5.2.4).
- *Data API staat niet aan* → enable **Google Analytics Data API** in the
  project that owns the service account (§2).
- *kent property … niet* → the property id is wrong; it is the number from
  Property details, not `G-…`.
- *sleutel … geweigerd* → the key was deleted in Cloud console; create a new
  JSON key and update `GA4_SERVICE_ACCOUNT_JSON`.
- All zeros → new property: wait 24–48 h. The panel refreshes at most hourly.

### No cookie banner on the public site

Needs all three: `NEXT_PUBLIC_GA4_MEASUREMENT_ID` set in the deployment's
environment (redeploy after adding it), **Analytics ingeschakeld** ticked in Instellingen → Analytics,
and no earlier choice in this browser (delete the `cms_consent` cookie or use
the footer link **Cookies**).

### Mail does not arrive

- No `RESEND_API_KEY` → mails are only logged (Vercel → Logs, search `email`).
- *domain is not verified* → finish §6.4; `EMAIL_FROM` must use that domain.
- Check the spam folder and Resend → *Emails* for bounces.

## 11. GDPR en bewaartermijnen

What the site does to comply with the GDPR (AVG) and Belgian law, what has to
be run by hand, and what is still open for Toshoni. The texts themselves are
standard templates for this site; **a lawyer must read them before
production** (§11.5).

### 11.1 Cookie banner

- The banner exists only where GA4 can load: `NEXT_PUBLIC_GA4_MEASUREMENT_ID`
  set for the deployment **and** *Analytics ingeschakeld* ticked (§5.3). Everywhere
  else there is no banner, no analytics script, no non-essential cookie, and
  the footer shows no "Cookies" button (there is no choice to revisit).
- Before a choice: **no** GA script, no request to `googletagmanager.com` or
  `google-analytics.com`, no `_ga` cookie. The only cookie a choice writes is
  `cms_consent` (`granted` or `denied`, 365 days).
- **Weigeren** is as easy as **Accepteren**: two buttons of equal weight side
  by side, no pre-ticked boxes, no "more options" detour. Weigeren also removes
  any `_ga*` cookies left from an earlier acceptance.
- The choice can be changed at any time with **Cookies** in the footer's
  bottom row (it reopens the banner).
- The banner links to `/privacy` automatically once that page is published.
- Test it as in §9.5, in a private window.

### 11.2 Privacyverklaring and Algemene voorwaarden

Two CMS pages, seeded and published by `scripts/cms-seed.mts` (one page-head
hero + one text block each):

| Page | Path | Linked from |
| --- | --- | --- |
| Privacyverklaring | `/privacy` | footer (every page), consent banner, booking form, customer e-mails |
| Algemene voorwaarden | `/algemene-voorwaarden` | footer (every page), booking form, customer e-mails |

- The footer's bottom row always links both pages, plus the legal identity
  (Qarakter BV · De Bikefit Studio · Weversstraat 7, 1730 Asse · BTW BE
  1036.912.281 · RPR Brussel, Nederlandstalige afdeling, from
  `src/lib/studio/legal.ts`) and the public e-mail address
  once *Instellingen → Contact → e-mail* is filled in. A fresh `cms:seed` also
  adds a footer menu column **Juridisch** with the same two links; the bottom
  row then skips them so nothing shows twice. Existing databases do not get
  that menu column (menus are not re-seeded); the bottom-row links cover it.
- The booking form says "Door te boeken ga je akkoord met onze algemene
  voorwaarden en privacyverklaring", both links opening in a new tab.
- The confirmation and cancellation e-mails end with a transactional footer
  (legal identity, KBO number, RPR, phone, links to both pages). No
  unsubscribe link: they are service messages, not marketing.
- **E-mail address in the texts**: at seed time the `[E-MAILADRES]`
  placeholder is filled from *Instellingen → Contact → e-mail*; when that is
  empty the seed writes `info@debikefitstudio.be` and prints a `!` warning.
  **That address is unverified.** Once Toshoni confirms the real address, set
  it in the admin and refresh both pages.

**Refresh on staging** (or any existing database). Run after the usual order
migrate → `cms:bootstrap` → `cms:seed-booking`, with the environment's
`DATABASE_URL` in front of the command. (The DevOps agent wraps this in
`with-db-url.sh` from its `neon-db` skill, which lives outside this repo and
supplies the URL from the secret store; without it, use the plain form.)

```bash
DATABASE_URL='<staging pooled url>' npm run cms:seed -- --refresh-slug privacy
DATABASE_URL='<staging pooled url>' npm run cms:seed -- --refresh-slug algemene-voorwaarden
```

Each run replaces only that page's blocks and republishes it; its title and
SEO fields, all other pages, menus, settings and redirects stay as they are.
A missing page is created in full. Expected output ends with
`✓ refresh complete — /privacy re-seeded and published in nl`.

**Editing these two texts in the admin is fine, in HTML mode.** Every block
write, the seed's included, goes through the rich-text allowlist in
`src/lib/cms/actions/sanitize.ts`, which keeps headings, lists, links and bold
or italic text. The admin's text field opens such a block in its **HTML**
mode automatically (a "Tekst"/"HTML" switch above the box); edit the source
there and save. Do not switch the block to "Tekst": that conversion flattens
headings and lists (the admin asks for confirmation first). Keep the seed as
the source of record: after a change in the admin, mirror the wording in
`PRIVACY_HTML` / `TERMS_HTML` in `scripts/cms-seed.mts` and update the date on
the first line, or the next `--refresh-slug` will overwrite it. The title and
SEO fields can be edited in the admin as usual.

### 11.3 Retention (bewaartermijnen)

The privacy statement (§3 on that page) promises these periods. What enforces
them:

| Data | Period | How |
| --- | --- | --- |
| Bookings (`cms_bookings`: contact details, bike, complaints, address) | 3 years after the customer's **last** appointment | `scripts/cms-retention.mts`, monthly (below) |
| Booking rate-limit rows (`cms_booking_rate_limit`: IP + e-mail) | 24 hours | pruned on every booking; the script is the backstop |
| Admin login attempts (`cms_login_attempts`) | pruned on every login | automatic (`src/lib/cms/auth.ts`); the script does not touch it |
| Server logs (Vercel) | ≤ 30 days | Vercel's log retention for the plan |
| GA4 | ≤ 14 months | GA4 Admin → Data retention: keep 2 or 14 months, never more |
| Admin audit log, sessions, content | not personal customer data | never purged by the script |

The script's rule for bookings: a booking whose appointment ended more than 3
years ago (any status) is deleted, **unless** the same customer e-mail
(case-insensitive) has a booking that ended less than 3 years ago or lies in
the future; then all of that customer's bookings are kept. So a customer's
history goes as a whole, three years after the last appointment.

**Monthly run (Arend).** Dry run first, read the counts, then apply. No Vercel
cron on purpose: a person looks at the numbers before anything is deleted.

```bash
# 1. dry run (default): prints the policy and what WOULD be deleted, deletes nothing
DATABASE_URL='<pooled url>' npm run cms:retention
# 2. if the counts look right
DATABASE_URL='<pooled url>' npm run cms:retention -- --apply
```

The DevOps agent runs both through `with-db-url.sh` from its `neon-db` skill
(outside this repo; it supplies the URL so nobody types it); by hand, use the
plain `DATABASE_URL=… npx tsx …` form above. `--json` prints a
machine-readable report. Exit code 0 on
success (dry run or apply), 1 on any error. Do staging and production
separately. Keep the printed counts with the verwerkingsregister (§11.5).

Not covered by the script, to handle by hand:

- **Google Calendar**: events in the providers' calendars keep the customer's
  name and contact details. Providers delete events older than 3 years, or
  keep event text minimal.
- **Neon backups**: deleted rows stay in Neon's restore history for the
  project's history-retention window, then disappear.
- **Resend**: sent-mail logs follow Resend's retention for the plan.
- **An erasure request** ("recht op wissen"): there is no delete button for
  bookings in the admin. Arend deletes by e-mail (check with a `SELECT` first):
  `DELETE FROM cms_bookings WHERE lower(trim(customer_email)) = lower('<e-mail>');`
  and the provider removes the matching Google Calendar events. Answer within
  one month.

### 11.4 Security headers

Set for every route in `next.config.ts` (`headers()`):

| Header | Value | Where |
| --- | --- | --- |
| `X-Content-Type-Options` | `nosniff` | all routes |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | all routes |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` | all routes |
| `X-Frame-Options` | `DENY` | `/admin` and everything under it |

Check after a deploy: DevTools → Network → the document request → *Response
headers* (or `curl -sI <origin>/` and `curl -sI <origin>/admin/login` when the
deployment is not behind Vercel protection).

**No Content-Security-Policy yet.** The GA4 tag and Next's own inline scripts
would need per-request nonces (which also makes every page dynamic). That is a
separate piece of work; do it before production if the lawyer or a security
review asks for it. `payment=()` is fine while the site uses redirect
checkouts only; relax it if an embedded wallet (Apple Pay / Google Pay) is
ever added.

### 11.5 Organisational checklist (Toshoni)

These are not code; they make the texts true.

- [ ] **Processor agreements (DPA) accepted** with every processor named on the
      privacy page: **Vercel**, **Neon** and **Resend** (each publishes a DPA
      on its legal pages; check whether it applies with the terms of service
      or must be signed separately), **Google** (GA4: Admin → Account settings
      → accept the *data processing terms*; for Google Calendar ask the
      lawyer: a personal, non-Workspace Google account comes with consumer
      terms, not a processor agreement). Keep a copy or screenshot of each
      acceptance with the date.
- [ ] **Verwerkingsregister** (record of processing, art. 30 AVG) based on
      sections 2–4 of the privacy page: per activity (bookings, provider
      calendar, e-mail, invoicing, security logs, statistics) the purpose,
      legal basis, categories of people and data, recipients/processors,
      transfers outside the EEA and the retention period from §11.3.
- [ ] **Public contact e-mail** for privacy requests and complaints: confirm
      `info@debikefitstudio.be` or give the real address → *Instellingen →
      Contact → e-mail* → refresh both pages (§11.2). The footer shows it
      from then on (art. III.74 WER requires an e-mail address on the site).
- [ ] **Lawyer review** of both texts before production, including the RPR
      division (derived from the registered office; check the Staatsblad), the
      50 % late-cancellation fee, the exception to the withdrawal right and
      the Google Calendar point above.
