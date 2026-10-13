# Admin Content-Security-Policy

The CMS admin (`/admin` and everything below it) is served with a strict,
nonce-based Content-Security-Policy, generated per request. It is
**report-only** for now: browsers list violations in the console and block
nothing until the staging check in §3 is clean and the switch in §4 is flipped.
The public site has no CSP (`booking-runbook.md` §11.4).

Code: `src/lib/security/admin-csp.ts` (policy, nonce, mode switch),
`src/lib/security/admin-csp-response.ts` (middleware wiring),
`src/middleware.ts`, `src/app/admin/layout.tsx`. Tests: `*.test.ts` next to
both `security` modules.

## 1. How it works

1. **Middleware.** For `/admin` and `/admin/…` only (not `/administrator`,
   not `/api/…`), `src/middleware.ts` draws a fresh 128-bit nonce (Web
   Crypto), builds the policy and forwards both to the app as request headers
   (`x-nonce` and the policy header; copies sent by the client are dropped
   first, so a request cannot pick its own nonce). The same policy goes on the
   response. Both branches (with and without Clerk) do this; the cookie
   redirect and Clerk's protection are unchanged. The sign-in redirect for
   anonymous visitors carries the header too: a redirect renders nothing, but
   `curl -sI <origin>/admin` then shows it. Every other path is passed through
   as before, without a CSP header.
2. **Next.js stamps the nonce.** While rendering, Next reads the nonce from the
   forwarded policy header (the report-only name works too) and puts it on
   every `<script>` it emits, its script preloads and its stylesheet links.
3. **Per-request rendering.** `src/app/admin/layout.tsx` awaits
   `connection()`, so every admin route renders per request (a prerendered page
   would carry no nonce). After `npm run build` all 21 `/admin` routes of the
   security branch were `ƒ`; `/admin/logout` was the only static one.
   `/admin/email`, merged from `staging` afterwards, renders under the same
   layout: check that it shows as `ƒ` in the next build output (22 routes).
4. **Client-side navigation** inside the admin keeps the first document's
   policy and nonce; the chunks it loads are trusted through
   `'strict-dynamic'`.

Checked locally against `next start` (13 Oct 2026): on `/admin/logout` all 16
`<script>` tags carry the header's nonce, there is no inline `<style>`, no
`style` attribute and no external URL; the nonce changes on every load;
spoofed `x-nonce` / CSP request headers are ignored; RSC navigation requests
still return `text/x-component`; public pages get no CSP header.

## 2. The policy, line by line

Production (previews, staging, production):

| Directive | Value | Why |
| --- | --- | --- |
| `default-src` | `'self'` | Fallback for everything not listed (media, manifest, …): own origin only. |
| `script-src` | `'self' 'nonce-…' 'strict-dynamic'` | Only scripts with this response's nonce run; `'strict-dynamic'` lets them load Next's chunks. Browsers that know `'strict-dynamic'` ignore `'self'` (it remains a fallback for old ones). No `'unsafe-inline'`, no `'unsafe-eval'`: an injected `<script>` or `onclick=` does not run. |
| `style-src` | `'self' 'nonce-…'` | Stylesheets from our origin (`/_next/static/…`); `<style>` elements only with the nonce. The admin renders none (Base UI's style-injecting components are not used there). |
| `style-src-attr` | `'unsafe-inline'` | The one relaxation; see below. |
| `img-src` | `'self' blob: data:` | Media via `/api/cms/media/:id` and `/_next/image` (same origin); `data:` for CSS and SVG data URIs; `blob:` for local previews. |
| `font-src` | `'self'` | `next/font` self-hosts both fonts under `/_next/static/media`. |
| `connect-src` | `'self'` | RSC navigations and server actions are same-origin; the GA4 dashboard panel fetches on the server. |
| `object-src` | `'none'` | No plugins. |
| `base-uri` | `'none'` | No `<base>`; an injected one cannot re-point relative URLs. |
| `form-action` | `'self'` | Forms and server actions post to our origin. Google Calendar's OAuth starts from a link, not a form, so it is unaffected. |
| `frame-ancestors` | `'none'` | Never framed (clickjacking). `X-Frame-Options: DENY` stays as well, for older browsers and while this is report-only. |
| `frame-src` | `'none'` | The admin embeds no frames (the public contact block's map never renders there). |
| `upgrade-insecure-requests` | enforce mode only | Browsers ignore it in a report-only policy and warn. Never in development (localhost is plain http). |

Not set on purpose: `worker-src`, `manifest-src`, `media-src` (none used in
the admin; they fall back to `script-src` / `default-src`), and no
`report-uri` / `report-to` yet (§7).

**`style-src-attr 'unsafe-inline'`, the trade-off.** React writes
`style={{…}}` props into the server HTML as `style="…"` attributes: the colour
swatches in *Diensten*, and `next/image` adds `style="color:transparent"` to
every media thumbnail. A nonce can mark elements, not attributes, so without
this the swatches lose their colour and every thumbnail raises a report. It
lets injected markup carry inline styles (for instance an overlay that redraws
part of the page). It does not let that markup run script, load anything from
another host (`img-src`, `font-src` and `connect-src` stay `'self'`), or add
`<style>` elements, whose selectors CSS-based data theft needs. To remove it
later, move those values to classes or set them through the CSSOM
(`ref.current.style.backgroundColor = …`), which CSP does not govern.

**Development (`next dev`)**, as the Next.js CSP guide prescribes:
`script-src` adds `'unsafe-eval'` (React's debugging), `style-src` becomes
`'self' 'unsafe-inline'` without the nonce (a nonce would switch
`'unsafe-inline'` off; the dev overlay and hot-reloaded CSS inject styles), and
`connect-src` adds `ws:` for the hot-reload socket. Production builds never
get these.

## 3. Staging browser check (before enforcing)

Use Chrome in a guest window or clean profile (extensions inject scripts and
styles and cause false reports); spot-check Firefox or Safari if editors use
them. Open DevTools before loading the first page: Console → *Preserve log*,
Network → filter *Doc*.

On every page below:

- [ ] Network → the document request → *Response headers*:
      `content-security-policy-report-only` is present and starts with
      `default-src 'self'; script-src 'self' 'nonce-`.
- [ ] Reload: the `'nonce-…'` value is different.
- [ ] Console and the *Issues* tab: **zero** `[Report Only] Refused to …`
      messages (Firefox: `Content-Security-Policy: (Report-Only policy) …`).
      On Vercel preview/staging URLs the **Vercel Toolbar** injects
      `https://vercel.live/…` scripts without our nonce; those reports are
      the toolbar, not the app. Disable the toolbar for the project (or the
      browser session) before the check, or ignore exactly those lines and
      note it in the report. With enforcement the toolbar does not load on
      `/admin`, which is intended. Reports naming a Clerk host or
      `challenges.cloudflare.com` are not noise: Clerk is mounted (§6) and
      the check has failed.
- [ ] Once per session, *View page source* (Ctrl+U): every `<script` has
      `nonce="…"` equal to the header's. (The Elements panel may show
      `nonce=""`: browsers hide the value from the DOM on purpose;
      `document.scripts[0].nonce` still returns it.)

Pages:

1. `/admin/login` signed out; submit a wrong password once.
2. `/admin/mfa`: the second step (code entry; on first enrolment also the QR
   code, the recovery codes and their copy button).
3. `/admin`: the dashboard.
4. `/admin/pages` → open a page: block editor (add, move and remove a block,
   *Tekst*/*HTML* switch), open the media picker, pick an image, save.
5. `/admin/media`: upload a small PNG and an SVG; thumbnails show; change an
   alt text.
6. `/admin/users`.
7. `/admin/account` and `/admin/password`.
8. `/admin/bookings`; `/admin/agenda` as a provider account.
9. `/admin/settings`: every section; `/admin/email`: the status card, the
   forms and *Bevestig je identiteit* (do not store a real key or send a
   test message unless that is intended).
10. `/admin/services`: the colour swatches show their colours.
11. Quick visits: `/admin/locations`, `/admin/providers` and one provider,
    `/admin/navigation`, `/admin/redirects`, `/admin/audit`.
12. Click through the sidebar (client-side navigation): no new messages.
13. `/admin/logout` → *Ja, afmelden* → back on `/admin/login`.
14. No regression: `/` and `/afspraak` have **no** CSP header.

Any message: note the page, the directive and the blocked resource, fix the
code (preferred) or widen the policy with the reason recorded in §2, and
repeat. Record date, browser and result in the PR or work block.

## 4. Switch to enforce, and roll back

**Switch.** In `src/lib/security/admin-csp.ts`, change

```ts
export const ADMIN_CSP_MODE: AdminCspMode = 'report-only';
```

to `'enforce'`. That renames the header to `Content-Security-Policy` and adds
`upgrade-insecure-requests` (production builds). No test changes are needed.
Feature branch → CI → preview → staging, repeat §3 (messages then read
`Refused to …` and the blocked thing really breaks), then production only
with Toshoni's explicit go.

**Roll back.** Change the line back to `'report-only'` and deploy; quicker
still, promote the previous deployment in Vercel (Instant Rollback). No data
or migration is involved either way.

## 5. Known limits

- **`/admin/<unknown>`** is not an admin route: the public catch-all renders
  its 404 with the site chrome, under the admin policy. Where GA4 is
  configured and the visitor consented, its tag is reported there (blocked
  once enforced). Intended: nothing is tracked under `/admin`.
- **Paths ending in a static-file extension** (`/admin/pages/x.html`,
  `/admin/providers/x.png`) skip the middleware because of its `matcher`, so
  they get neither the cookie redirect nor the policy. The dashboard layout
  still gates them, and such an id resolves to "not found". To close it, add
  `'/admin/:path*'` to the matcher in `src/middleware.ts` (the cookie redirect
  then applies there too).
- **CSP is per document.** If a public page ever soft-navigates into `/admin`
  through `next/link`, that document keeps the public (absent) policy until
  the next full load. No public page links to the admin today, and the admin's
  links to the public site open in a new tab.
- Browsers from before 2022 without `style-src-attr` fall back to `style-src`
  and would block style attributes once enforced.

## 6. Clerk caveat

`src/app/layout.tsx` wraps the whole app, admin included, in `ClerkProvider`
whenever `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is set (the secret key is not
needed for that). The policy above is complete only where that key is not set.
**For staging this is not verified:** the staging env table
(`staging-runbook.md` §2) lists no Clerk keys, but `DEPLOYMENT.md` §6 gives
Clerk's Development instance to "staging and previews" (a Preview variable
without a branch filter reaches the `staging` branch too) and its Production
instance to production. Open validation item, with what to check and what each
result means: `staging-runbook.md` §15, step 4. Until it is checked and
recorded, the policy stays report-only (§4).

Where the key is set, every admin page renders Clerk's
`<script src="https://<frontend-api>/npm/@clerk/clerk-js…">` (plus a preload)
without a nonce, which `'strict-dynamic'` reports (and blocks once enforced).
Clerk's SDK then also needs `connect-src` to its Frontend API host,
`img-src https://img.clerk.com`, `worker-src 'self' blob:`, inline styles
(`<ClerkProvider nonce>` or `'unsafe-inline'` in `style-src`) and
`https://challenges.cloudflare.com` in `script-src` and `frame-src` (bot
protection).

Recommended: do not mount Clerk under `/admin`. Move `ClerkProvider` from the
root layout into the webshop's route-group layouts (the admin has its own
auth). Only if that is impossible: `<ClerkProvider dynamic>` (it then reads the
`x-nonce` header the middleware already forwards) plus exactly those hosts,
added in `buildAdminCsp()` behind a parameter.

## 7. Optional follow-ups

- **Reporting endpoint**: `Reporting-Endpoints` + `report-to` (and
  `report-uri` for Firefox) pointing to a small route handler that
  rate-limits like the other unauthenticated writes and logs `[csp]` lines
  without personal data. Useful once enforced, to see real sessions.
- **Public-site CSP**: a nonce policy that admits GA4
  (`https://*.googletagmanager.com` in `script-src`; `*.google-analytics.com`,
  `*.analytics.google.com` and `*.googletagmanager.com` in `connect-src`
  and `img-src`), the nonce passed to the GA4 `next/script` tags, and
  per-request rendering of those pages; or a hash-based policy to keep them
  static.
- The matcher entry from §5 and the Clerk move from §6.
- Later hardening: drop `style-src-attr 'unsafe-inline'` (§2), then consider
  Trusted Types.
