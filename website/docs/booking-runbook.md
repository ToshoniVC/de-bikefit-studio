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
> (tag + banner), `src/lib/analytics/{ga4-tag,page-view}.ts(x)` (what the tag sends, §9.5),
> `src/lib/analytics/ga4.ts` (Data API), architecture in `docs/booking-architecture.md`.

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
   Save. Our tag sends its own `page_view` on every route change, with a
   masked address (§9.5); leaving this on would count every client-side
   navigation twice, and GA's extra page views would report the browser's
   own address, such as `/afspraak/bevestigd` with its signed `?ref=` after
   a booking.
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

7. Enter the values, either:
   - **in the admin (no deploy needed):** `/admin/email` (**Beheer → E-mail**, admins only).
     Paste the key in *API-sleutel* → **Sleutel opslaan** (stored encrypted; afterwards only
     its last four characters are shown), fill *Afzender*, *Antwoordadres* and *Ontvanger
     cadeaubonbestellingen* → **Opslaan**, then **Testbericht versturen** and check the
     inbox. Storing the key and saving the addresses are sensitive changes: more than
     5 minutes after signing in, confirm your identity first (*Bevestig je identiteit*,
     password and code). Needs migration `0004` on that database and `CMS_SESSION_SECRET`
     set (it is on staging and production) and kept: rotating it makes the stored key
     unreadable; or
   - **in Vercel** as `RESEND_API_KEY` / `EMAIL_FROM` / `EMAIL_REPLY_TO` (§7), then redeploy.
     A Vercel value wins over the admin value for that field; `/admin/email` shows which one
     is used.

## 7. 1Password and Vercel

### 7.1 What goes where

Store every value in 1Password first (one vault item per environment, e.g.
"Bikefit — staging integrations"), then add it in **Vercel → Settings →
Environment Variables** for staging and/or **Production**. Staging is not a
Vercel environment of its own (Hobby plan): it is **Preview with git branch
`staging`** (`DEPLOYMENT.md` §1). Mark the secret ones as **Sensitive**. All
names come from `.env.example`.

| Value | Vercel variable | Secret | Scope |
| --- | --- | :-: | --- |
| OAuth client ID (§4) | `GOOGLE_OAUTH_CLIENT_ID` | no | Preview/`staging` (§7.3) + Production; never Preview (all branches) |
| OAuth client secret (§4) | `GOOGLE_OAUTH_CLIENT_SECRET` | **yes** | Preview/`staging` (§7.3) + Production; never Preview (all branches) |
| Token encryption key (§7.2) | `GOOGLE_TOKEN_ENCRYPTION_KEY` | **yes** | one key **per environment**, set before the first provider connects |
| GA4 measurement id `G-…` (§5.1.3) | `NEXT_PUBLIC_GA4_MEASUREMENT_ID` | no | Production (Staging only to test the banner) |
| GA4 property id (§5.1.6) | `GA4_PROPERTY_ID` (or the admin setting) | no | Staging + Production |
| Service-account key JSON (§5.2.2) | `GA4_SERVICE_ACCOUNT_JSON` | **yes** | Staging + Production |
| Resend API key (§6.5) | `RESEND_API_KEY` (or `/admin/email`, §6.7) | **yes** | per environment |
| Sender (§6.6) | `EMAIL_FROM` (or `/admin/email`) | no | Staging + Production |
| Reply-to (§6.6) | `EMAIL_REPLY_TO` (or `/admin/email`) | no | Staging + Production |
| Public origin | `NEXT_PUBLIC_SITE_URL` (already set) | no | must equal the origin in the redirect URI; on a deployment the redirect URI's only source, https only |

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
providers must reconnect Google.** Treat it as permanent, and set it before the
first provider connects: switching from the derived key to an explicit one later
is such a change too.

It must decode to exactly 32 bytes. `openssl rand -base64 48` (the recipe for
`CMS_SESSION_SECRET`) and `openssl rand -hex 32` give a value the server
refuses: the Google card then tells an admin, and no provider is sent to Google
until it is fixed (§10).

### 7.3 Staging: switch Google Calendar on

Staging is the Preview deployment of the `staging` branch, behind Vercel's
deployment protection, on the stable alias
`https://de-bikefit-studio-git-staging-toshoni.vercel.app` (`DEPLOYMENT.md` §1).
Its redirect URI, to register in the OAuth client exactly as written:

```text
https://de-bikefit-studio-git-staging-toshoni.vercel.app/api/google/oauth/callback
```

It follows from staging's `NEXT_PUBLIC_SITE_URL`
(`https://de-bikefit-studio-git-staging-toshoni.vercel.app`): its origin plus
`/api/google/oauth/callback` (`resolveGoogleOAuthConfig()` in
`src/lib/booking/google-oauth-config.ts`; a trailing slash or a path on the
variable is ignored). On a deployment nothing else is used: never `VERCEL_URL`
(every deployment has its own `…-<hash>-toshoni.vercel.app` host, which is never
registered, so Google would answer `redirect_uri_mismatch`) and never
`NEXT_PUBLIC_APP_URL`. Without an https `NEXT_PUBLIC_SITE_URL` no provider is sent
to Google at all. Once the variables are live, an admin sees the same URI under
**Aanbieders → <provider> → Google Agenda → Gegevens voor de OAuth-client**.

**Variables** (Vercel → Settings → Environment Variables → **Preview**, **git
branch `staging`**; values come from 1Password and are pasted there only):

| Variable | Value | Sensitive | Note |
| --- | --- | :-: | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | client ID of the web client (§4) | optional | Not a secret: it is in every consent URL. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | that client's secret | **yes** | |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32`, staging's own | **yes** | Before the first connection (§7.2). Never production's. |
| `NEXT_PUBLIC_SITE_URL` | `https://de-bikefit-studio-git-staging-toshoni.vercel.app` | no | Already set: check only. |

Leave as they are: `CMS_SESSION_SECRET` (signs the OAuth state cookie and, without
a token key, is the token key's source), `CMS_MFA_ENCRYPTION_KEY`, `DATABASE_URL`.

**Why Preview/`staging` only, not Preview (all branches).**

- Least privilege: the client secret and the token key reach only deployments
  built from the reviewed `staging` branch, not every feature branch's code.
- Nothing is lost. Feature previews carry the staging alias as
  `NEXT_PUBLIC_SITE_URL`, so even with the variables their start route would hop
  to the staging alias and the connection would complete there (`DEPLOYMENT.md`
  §1). Without them their Google card says the connection is not set up, which
  is true for them.
- A feature preview that uses the staging database (which database previews use
  is not recorded in this repository) must not hold staging's token key: any
  branch's code could then decrypt the providers' tokens. The side effect to
  accept: when such a preview computes availability for a connected provider, it
  records *"Google Calendar is niet geconfigureerd op de server."* on that shared
  provider row; the next successful sync on staging clears it (§10).

**Redeploy.** Vercel applies a variable change only to new deployments: redeploy
the latest `staging` deployment after setting them (or merge the code that needs
them). The server reads `NEXT_PUBLIC_SITE_URL` and the Google variables at request
time (`src/lib/env.ts` looks them up by name, so Next does not inline
`NEXT_PUBLIC_SITE_URL` into server code); the redeploy is about Vercel binding
variables to a deployment.

**Toshoni — Google Cloud (§1–§4):**

- [ ] The project exists (§1) and the **Google Calendar API** is enabled (§2).
      Without it connecting works, but every sync fails with *Laatste fout: Google
      Agenda gaf een fout (HTTP 403).*
- [ ] Consent screen (§3): External, the four scopes, and as **test users** your
      own Google account and that of every provider who will connect on staging.
- [ ] Publishing status decided (§3.7): *In production* (unverified-app warning,
      tokens do not expire) or, for a short test only, *Testing* (only test users
      can connect, and the calendar disconnects after 7 days).
- [ ] OAuth client (§4, Web application): the URI above added under *Authorised
      redirect URIs* (https, no trailing slash). JavaScript origins stay empty. No
      per-deployment or feature-preview host.
- [ ] Client ID and secret in 1Password, and a fresh staging
      `GOOGLE_TOKEN_ENCRYPTION_KEY` (§7.2) in "Bikefit — staging integrations".
      Tell Arend the item names, never the values.
- [ ] Decided which Google account a provider connects on staging. The code always
      uses that account's **primary** calendar, so staging test bookings become
      real events in it; a separate test account keeps them out of a real agenda.

**Arend — Vercel:**

- [ ] Names only, never values: none of the three Google variables exists for
      *Preview (all branches)* or for *Production*; `NEXT_PUBLIC_SITE_URL` for
      Preview/`staging` is exactly the alias origin.
- [ ] Add the three variables for **Preview, git branch `staging`**, the secret
      and the key as *Sensitive*. With the CLI, pipe the value without a trailing
      line break (`printf '%s'`, not `echo`); the card flags whitespace.
- [ ] Redeploy staging and wait for READY.
- [ ] As admin on the alias: `/admin/providers/<id>` shows **Google Agenda
      koppelen** and no *"Google Agenda koppelen kan nog niet"* box, and *Gegevens
      voor de OAuth-client* shows exactly the URI above. As the provider,
      `/admin/agenda` shows the button too.
- [ ] Record the names, the scope, the deployment and the date in the
      infrastructure log.

Then the provider connects (§8) and §9 runs on staging. Whoever connects must
pass Vercel's deployment protection, so needs access to the Vercel team.

**Do not:**

- paste a value into chat, a doc, a commit, a screenshot or a log: 1Password is
  the source, Vercel holds the runtime copy;
- scope the Google variables to *Preview (all branches)*, or set them for
  *Production* as part of this step;
- register or rely on a `VERCEL_URL` / per-deployment host, a feature-preview
  host or an `http://` URI for staging;
- rotate or "align" `CMS_SESSION_SECRET` (it differs between Preview and
  Preview/`staging` on purpose; changing it signs everyone out and, without a
  token key, disconnects Google), or change `GOOGLE_TOKEN_ENCRYPTION_KEY` once
  providers are connected;
- reuse a token key across staging and production;
- switch off deployment protection or put a protection-bypass token in the
  redirect URI to make the callback work. The callback is an ordinary top-level
  navigation in the browser that already passed Vercel's login for the alias,
  so protection is not expected to interfere (not yet verified on staging). If
  Vercel's login answers the callback instead of the admin, report it.

**Open for Toshoni.** One OAuth client for all environments (§4) is the
documented setup. A second client in the same project (e.g. `bikefit-staging`,
only the staging URI) would keep staging's secret apart from production's; the
code works with either. Decide before production.

---

## 8. Connect a provider's Google Calendar

Prerequisites: migrations applied, `npm run cms:bootstrap` and
`npm run cms:seed-booking` run against the environment (the latter creates the
provider `toshoni@gmail.com` with a temporary password printed once), the
Google variables set and deployed (staging: §7.3). Without them the card shows
no button but *"Google Agenda koppelen kan nog niet"* (§10).

1. Sign in at `/admin/login` as the provider. The first login forces a new
   password and then setting up two-step verification (authenticator app and
   ten recovery codes; `staging-runbook.md` §17).
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

   **What GA4 receives about the page.** The tag never sends the browser's
   own address (`src/lib/analytics/page-view.ts`): `page_path` is the path;
   `page_location` is the origin, the path and, of the query, only
   `utm_source`, `utm_medium`, `utm_campaign`, `utm_term` and `utm_content`
   (GA4 reads campaign attribution from them). `?ref=` on
   `/afspraak/bevestigd`, `?dienst=`, click ids and the `#…` fragment are
   dropped. The cancel link `/afspraak/annuleren/<token>` is always reported
   as `/afspraak/annuleren/[token]`, without any query: the token cancels the
   booking. The tag puts the same values on its `gtag('config')`, so that
   GA's own later hits on the page (`user_engagement`, enhanced-measurement
   `scroll` and clicks) use them too. That part is Google's code and only a
   browser shows it, so run this check on staging before production, and
   again after any change to the tag or to the property's enhanced
   measurement:

   1. Make a dummy cancel link: the deployment's origin +
      `/afspraak/annuleren/KanarieKanarieKanarieKanarieKanarieKanarie1?utm_source=kanarie&x=kanarie#kanarie`.
      The token is made up, which is fine: the page shows *Deze link werkt
      niet* and still counts as a page view. Never use a customer's link.
   2. Open a private window, then DevTools → Network with *Preserve log*
      on, and only then the dummy link. Before any choice: the banner
      shows, there is **no** request to `googletagmanager.com`,
      `google-analytics.com` or `analytics.google.com`, and no `_ga`
      cookie.
   3. Click **Accepteren**. `gtag/js` loads, then a `collect` request to
      `google-analytics.com` (or `analytics.google.com`). Open its *Payload*
      (the query string and, when GA batches events, the request body with
      one line per event). For `en=page_view`: `dl` is
      `https://<host>/afspraak/annuleren/[token]` (shown encoded as
      `%5Btoken%5D`), with no `?` and no `#`; `dt` is *Afspraak annuleren*
      in the site's title template; a page-path field, if present
      (`ep.page_path`, or `dp`), is `/afspraak/annuleren/[token]`.
   4. **Automatic hits — the part our code cannot prove.** Stay about 15
      seconds, switch to another tab and back (GA normally sends
      `en=user_engagement` when the tab is hidden); make the window short
      enough to scroll and scroll to the bottom (`en=scroll`, when
      *Scrolls* is on in enhanced measurement). Every new `collect` request
      must show the same masked `dl`.
   5. Click **Naar de homepagina**: exactly one new `page_view` (two means
      §5.1.4 is still on), with `dl` = `https://<host>/` and the home
      page's title as `dt`. Switch tabs once more: the next
      `user_engagement` should show `dl` = `https://<host>/` too. If it
      still shows the cancel placeholder, GA ignores the repeated config:
      nothing leaks, but engagement lands on the wrong page; report it.
   6. Search the log for `kanarie` (Network → search; for request bodies,
      export the log as HAR and search the file). Only the site's own
      requests may match; no request to a Google host may.
   7. A normal page keeps its campaign keys: open
      `<origin>/afspraak?utm_source=runbook&utm_medium=check&dienst=bikefit`
      in the same tab. `dl` is
      `https://<host>/afspraak?utm_source=runbook&utm_medium=check` (no
      `dienst`), `dt` is that page's title.

   A Google request with `kanarie` in it, or a `dl`/`dr` with a query key
   other than `utm_*` or a `#`, is a failure: untick *Analytics
   ingeschakeld* (§5.3) and keep GA4 off in production until it is fixed.
6. **Dashboard.** `/admin` as admin: the Google Analytics panel shows numbers.
   A new property needs 24–48 h before the Data API returns data (realtime is
   not included), and the panel caches for one hour.

## 10. Troubleshooting

### Connect-flow results

The callback returns to `/admin/agenda` (or `/admin/providers/<id>`) with
`?google=connected` or `?google=error&reason=<code>`; the start route does the
same with `reason=config` instead of sending anyone to Google:

| `reason` | Meaning | Fix |
| --- | --- | --- |
| `config` | This server is not ready to connect: OAuth client missing or pasted with whitespace, token key not base64 of 32 bytes, or (on a deployment) `NEXT_PUBLIC_SITE_URL` missing or not https. Only shown to a signed-in user who may connect this provider. | The Google card names the problem to an admin (below); fix it (§7.3) and redeploy. The server log has `[google-oauth] not_ready` with the problem codes, never a value. |
| `access_denied` | The provider pressed *Cancel* on Google's screen. | Start again and allow access. |
| `missing_scope` | Consent was given without one of the calendar checkboxes. | Start again and tick both boxes. |
| `state` | The 10-minute window passed, the flow was finished in another browser, or it started on a different host than `NEXT_PUBLIC_SITE_URL`. | Start again from the admin on the `NEXT_PUBLIC_SITE_URL` host. |
| `session` | Not signed in to the admin, signed in as someone else than who started, or an admin or provider session without two-step verification. | Sign in (with the code from your authenticator) and start again. |
| `forbidden` | The signed-in user may not manage this provider. | Use the provider's own login or an admin. |
| `exchange` | Google refused the authorisation code (often a redirect URI or client secret mismatch). | Check §4 and the Vercel values; start again. The server log has only `[google-oauth] code_exchange_failed`; Google's description is not logged. |
| `no_refresh_token` | Google returned no refresh token. | Remove the app at <https://myaccount.google.com/permissions>, then connect again. |
| `store` | The tokens could not be saved (provider missing, database or key problem). | The server log has only `[google-oauth] store_refused` (the repo said no) or `store_failed` (it threw). Check that the provider still exists and the database is reachable. A malformed `GOOGLE_TOKEN_ENCRYPTION_KEY` is caught before Google since 16 Oct 2026 (`config`). |
| `google` | Google returned another error. | Google's `error` value is not logged; retry, then check the OAuth client and consent screen (§3–§4). |

### "Google Agenda koppelen kan nog niet" or "OAuth-client ontbreekt"

The Google Agenda card has no **Google Agenda koppelen** button and says the
connection is not set up on this server.

- Builds before 16 Oct 2026 say *"De Google-koppeling is nog niet ingesteld op de
  server (OAuth-client ontbreekt)"* to everyone, and their OAuth routes answer a
  plain-text 503 that names the variables. It means `GOOGLE_OAUTH_CLIENT_ID` or
  `GOOGLE_OAUTH_CLIENT_SECRET` is missing in that deployment's environment. On
  16 Oct 2026 that was staging's state: Preview/`staging` had neither (§7.3).
- Since then, an admin sees *"Google Agenda koppelen kan nog niet op deze
  server."* with one line per problem and, when it is known, the redirect URI to
  register. A provider sees only that it is not set up and to ask the beheerder;
  an editor, that a beheerder can set it up. The routes no longer answer 503: a
  signed-in user who may connect the provider is sent back with `reason=config`,
  anyone else gets the sign-in page, the 403 or the `state` error as before.

| Line on the card (admin) | Fix |
| --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID ontbreekt.` / `GOOGLE_OAUTH_CLIENT_SECRET ontbreekt.` | Set it for this environment's scope (staging: §7.3) and redeploy. |
| `… bevat een spatie of regeleinde.` | Paste the value again without whitespace (CLI: `printf '%s'`, not `echo`) and redeploy. |
| `GOOGLE_TOKEN_ENCRYPTION_KEY is geen base64 van precies 32 bytes.` | A key that never worked never stored anything: make one with `openssl rand -base64 32`. If it worked before, put the old value back from 1Password instead; a new key disconnects every provider. Redeploy. |
| `NEXT_PUBLIC_SITE_URL ontbreekt.` | Set it to the environment's fixed https origin. On a deployment the redirect URI comes from this variable only. |
| `NEXT_PUBLIC_SITE_URL moet met https:// beginnen.` / `… is geen geldig http(s)-adres.` | Correct the value and redeploy. |

Every fix needs a redeploy. On a feature preview the message is expected with
the recommended scope (§7.3): connect on staging instead.

### `Laatste fout: Google Agenda gaf een fout (HTTP 403).` right after connecting

Most likely the **Google Calendar API** is not enabled in the project (§2):
connecting needs only OAuth, every free/busy or event call needs the API. Enable
it and wait a few minutes; the next availability check clears the error. Google's
own reason (`accessNotConfigured`) is not stored, only the status
(`booking-architecture.md` §7).

### `Laatste fout: Google Calendar is niet geconfigureerd op de server.`

The deployment that last computed availability for this provider has no OAuth
client: the variables were removed, or a deployment without them (such as a
feature preview) uses this database (§7.3). The connection itself is intact; the
next successful sync on a configured deployment clears the message.

### Calendar disconnects after about 7 days

The card shows *"Google-toegang is ingetrokken of verlopen"* a week after
connecting: the consent screen is still in **Testing**. Publish it (§3.7) and
reconnect. The same message appears when the provider removed the app at
<https://myaccount.google.com/permissions>. *"sleutel gewijzigd"* means
`GOOGLE_TOKEN_ENCRYPTION_KEY` or `CMS_SESSION_SECRET` changed (§7.2):
reconnect.

### `Error 400: redirect_uri_mismatch`

The redirect URI we send is the origin of `NEXT_PUBLIC_SITE_URL` +
`/api/google/oauth/callback` (on a deployment never `VERCEL_URL`). An admin sees
it on the Google card under *Gegevens voor de OAuth-client*; staging's is in §7.3.
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
- *gaf een fout (HTTP …)*, *antwoordde niet op tijd* or *kon niet worden
  gelezen* → Google's own text is neither shown nor logged; the server log has
  `[analytics] ga4_request_failed` and, for a Data API error, the HTTP status.
  Retry after a few minutes; if it persists, check the service account and key
  in Cloud console (§5.2).
- All zeros → new property: wait 24–48 h. The panel refreshes at most hourly.

### No cookie banner on the public site

Needs all three: `NEXT_PUBLIC_GA4_MEASUREMENT_ID` set in the deployment's
environment (redeploy after adding it), **Analytics ingeschakeld** ticked in Instellingen → Analytics,
and no earlier choice in this browser (delete the `cms_consent` cookie or use
the footer link **Cookies**).

### Mail does not arrive

- Open `/admin/email`: the Status card says what is missing and where each value comes from.
- No key (neither `RESEND_API_KEY` nor one stored in the admin) → mails are only logged, one
  line each with the number of recipients (Vercel → Logs, search `email`). Gift voucher orders
  then fail visibly ("niet verstuurd"), see § 12.
- "kan niet meer ontsleuteld worden" → `CMS_SESSION_SECRET` was rotated; paste the key again.
- *domain is not verified* (Resend's text, in the Resend dashboard; the site shows only a code
  such as `HTTP 403: validation_error`) → finish §6.4; the sender must use that domain.
- **Testbericht versturen** in `/admin/email` shows the HTTP status and Resend's error code
  (e.g. `HTTP 422: validation_error`), the server log the same. Never Resend's own text: it can
  echo addresses. Read the full refusal in the Resend dashboard (*Logs*).
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
- After **Accepteren**, the tag sends GA4 each page's title, its path, and
  the origin plus path with only the `utm_*` campaign keys of the query,
  never the full address: no other query keys (such as the signed `?ref=` of
  `/afspraak/bevestigd`) and no fragment. It never sends the cancel link's
  token, which can cancel a booking: that page is reported as
  `/afspraak/annuleren/[token]`. Data minimisation; §9.5 verifies it in the
  browser, GA's own automatic hits included.
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

- The footer's bottom row always links both pages. The public e-mail address
  (*Instellingen → Contact → e-mail*, `info@debikefitstudio.be`) is in the
  footer's contact column. The legal identity line (Qarakter BV, Weversstraat 7,
  1730 Asse, BTW, RPR; `src/lib/studio/legal.ts`) was removed from the footer at
  Toshoni's request on 13 Oct 2026; it stays in both legal texts and in the
  customer e-mails — recheck art. III.74 WER with the lawyer before production. A fresh `cms:seed` also
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
| Booking rate-limit counters (`cms_rate_limits`, since migration 0008: the IP and a SHA-256 hash of the e-mail address in the key, attempt times) | 1 day after the last attempt of that key | pruned on every booking attempt (`src/lib/rate-limit.ts`); the script does not touch them |
| Older rate-limit rows (`cms_booking_rate_limit`: IP + e-mail; bookings wrote here until 0008, now only gift voucher requests, with a hashed e-mail) | 24 hours | pruned on every gift voucher request; the script is the backstop. Booking rows written before 0008 go with the next voucher request or the next `--apply` run |
| Admin login attempts (`cms_login_attempts`) | pruned on every login | automatic (`src/lib/cms/auth.ts`); the script does not touch it |
| Two-step code counters of admins and providers (`cms_mfa_rate_limits`: user id and IP in the key, attempt times; the older `cms_mfa_attempts` log is no longer written) and sign-in challenges (`cms_mfa_challenges`) | 1 day / 10 minutes | pruned on every code check and sign-in (`src/lib/cms/mfa/`); the script does not touch them |
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

The first four are set in `next.config.ts` (`headers()`); the admin's
Content-Security-Policy comes from `src/middleware.ts`, because it carries a
fresh nonce on every request:

| Header | Value | Where |
| --- | --- | --- |
| `X-Content-Type-Options` | `nosniff` | all routes |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | all routes |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` | all routes |
| `X-Frame-Options` | `DENY` | `/admin` and everything under it |
| `Content-Security-Policy-Report-Only` | the admin policy: scripts and `<style>` elements only with the response's nonce, no third-party hosts ([`admin-csp.md`](./admin-csp.md)) | `/admin` and everything under it; renamed `Content-Security-Policy` once enforced |

Check after a deploy: DevTools → Network → the document request → *Response
headers* (or `curl -sI <origin>/` and `curl -sI <origin>/admin/login` when the
deployment is not behind Vercel protection). The admin policy must be on
`/admin/login` with a different `'nonce-…'` on every reload, and on no public
page.

**Admin CSP: report-only for now.** In this mode the browser lists every
violation in the console and blocks nothing. It becomes enforcing only after
the staging browser check in [`admin-csp.md`](./admin-csp.md) §3 comes back
clean. Switching it on and rolling it back are each a one-line change (§4 there).

**The public site has no Content-Security-Policy.** The consent-gated GA4 tag
and Next's own inline scripts would need per-request nonces (which also makes
every page dynamic) and a policy that admits the Google hosts. That is a
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

## 12. Cadeaubon — order requests by e-mail

`/aanbod/cadeaubon` (block *Cadeaubon (bestelformulier)*) lets a visitor order a gift voucher:
amount of their choice in euro, an optional personal message (plain text, max. 500 characters),
name, e-mail and optionally phone. **Bestel nu** sends one e-mail **to the studio**; nothing is
paid, invoiced or issued on the site and the visitor gets no automatic mail.

**What the studio does with the mail** ("Cadeaubon-aanvraag: € 75,50 (CB-1A2B3C4D)"): make the
invoice and a payment link by hand and send them to the visitor's address (replying to the
mail goes straight to the visitor: it is the Reply-To). The mail lists the amount, the message,
the contact details and the reference.

**What has to be set for it to work** (until then every order says "Je bestelling is niet
verstuurd", keeps the form filled in and shows the phone number, from Contact or else the
legal identity's 0473 95 26 33; nothing is sent):

| Setting | Where | Notes |
| --- | --- | --- |
| API key | `/admin/email` → *API-sleutel* (stored encrypted), or Vercel env `RESEND_API_KEY` (sensitive, wins); source 1Password | § 6 |
| Sender | `/admin/email` → *Afzender*, or env `EMAIL_FROM` (wins) | an address on a domain **verified in Resend**, e.g. `De Bikefit Studio <bestellingen@debikefitstudio.be>`; never the visitor's address |
| Recipient | `/admin/email` → *Ontvanger cadeaubonbestellingen*, or env `GIFT_VOUCHER_RECIPIENT` (wins) | one plain address of an inbox that **really receives mail**. Deliberately separate from the public Contact → E-mail in the footer, with no fallback to it: a provider accepts mail to a dead domain and it bounces later, so the visitor would see "verstuurd" for an order nobody gets. Empty or invalid = not sent |
| Reply-To | not used for vouchers | the visitor's address is the Reply-To |

`/admin/email` (**Beheer → E-mail**, admins only) shows the status of all of these (the key
only as its source and last four characters, never the value) and can send a test message.
Changing a value there needs a recent identity confirmation (*Bevestig je identiteit*,
`cms-architecture.md` §4).

**Turning it on, in this order** (each step alone changes nothing for visitors until all three
are done; never submit a test order unless a mail to the studio is intended):

1. Toshoni names the working order inbox. An admin sets it in `/admin/email`.
2. Resend account with a sender domain **verified in Resend** (DKIM/SPF DNS records: needs an
   explicit DNS go).
3. An admin pastes the API key (also kept in 1Password) and the sender in `/admin/email`, or
   Arend sets `RESEND_API_KEY` / `EMAIL_FROM` in Vercel and redeploys. Check the Status card:
   *Aanwezig* / *Klaar* for key, sender and recipient.
4. **Testbericht versturen** to the order inbox and check that it arrives.

**Honest states.** The site says "verstuurd" only when Resend **accepted** the message (HTTP
2xx). A missing key or sender, an empty recipient, a refusal, a timeout or an exception is
"niet verstuurd". Acceptance is not proof of delivery to the inbox: check Resend → *Emails*
for bounces (an inbox on a domain without MX bounces).

**Abuse and duplicates.** Server-side validation (zod + Dutch messages), a honeypot, Next's
Origin check on the server action, 5 requests per 15 minutes per e-mail address or IP (rows in
`cms_booking_rate_limit` with `cadeaubon:` keys, e-mail stored as a truncated SHA-256, pruned
after a day), and a per-form request id: a repeat of a form that was already sent is confirmed
without a second mail. The form disables "Bestel nu" while a request is in flight.
Validation runs before the rate limit, so it is kept cheap: the schema first caps every raw
field (`GIFT_VOUCHER_RAW_LIMITS` in `src/lib/gift-voucher/order.ts`: message 4000 characters,
name 500, e-mail 400, phone 100, amount 64, honeypot 400, request id 128; technical bounds far
above the form's limits, not voucher terms), and the normalising and patterns after it run in
linear time (the e-mail pattern never sees more than 200 characters). A field over its cap gets
that field's usual Dutch message, an over-long honeypot counts as filled in and an over-long
request id is ignored like any malformed one.

**Privacy.** No order is stored on the site; the order exists only in the studio's mailbox.
Server logs carry no visitor data (`[cadeaubon] aanvraag niet verstuurd (not_configured)`; an
unexpected failure in the action logs `[cadeaubon] order_action_failed` and nothing else; the
mail helper logs no subject and no address, only the number of recipients, the HTTP status and
Resend's error code). Server-action argument logging in `next dev` is switched off
(`logging.serverFunctions: false`), so neither visitor data nor a key typed into
`/admin/email` reaches a local terminal. The form posts with `method="post"`, so a submit before
the page has loaded its JavaScript never puts the visitor's data in a URL.

**Not decided, not stated** (register C-04): validity, form of the voucher, delivery, minimum or
maximum amount. The form accepts € 1 to € 5.000 as a technical bound.
