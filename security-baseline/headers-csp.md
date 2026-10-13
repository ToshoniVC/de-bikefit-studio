# HTTP headers and Content Security Policy

Header profile for browser-facing hosts. Covers WEB-02 – WEB-07 and OPS-06 in
[control-matrix.md](control-matrix.md), plus the CSP side of DAT-04. Values are targets, not a
description of any deployed system. Verification: [acceptance-tests.md](acceptance-tests.md)
(AT-15, AT-31 – AT-36, AT-58).

## Baseline header profile

| Header                         | Value                                                                                                           | Applies to                                          | Profiles     | Rationale                                                                                        | Control        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------ | -------------- |
| `Strict-Transport-Security`    | `max-age=63072000; includeSubDomains` (minimum `max-age=31536000`)                                              | Every HTTPS response                                | P1–P3        | Browser refuses plain HTTP for the host and its subdomains (RFC 6797)                            | WEB-02         |
| `Content-Security-Policy`      | See [Policy](#policy)                                                                                           | HTML responses                                      | P1–P3        | Blocks injected script, framing and `<base>` hijacking                                           | WEB-03         |
| `Reporting-Endpoints`          | `csp="https://www.example.com/csp-report"`                                                                      | HTML responses                                      | P1–P3        | Names the endpoint for the `report-to` directive (W3C Reporting API)                             | WEB-03         |
| `X-Content-Type-Options`       | `nosniff`                                                                                                       | Every response                                      | P1–P4        | Stops MIME sniffing (Fetch Standard)                                                             | WEB-04         |
| `Referrer-Policy`              | `strict-origin-when-cross-origin`; `no-referrer` on token pages                                                 | Every response                                      | P1–P4        | Keeps paths and query strings away from other origins                                            | WEB-04, WEB-05 |
| `Permissions-Policy`           | `accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()` | HTML responses                                      | P1–P3        | Disables powerful features the site does not use; allow `self` or named origins only when needed | WEB-04         |
| `Cross-Origin-Opener-Policy`   | `same-origin`; `same-origin-allow-popups` when a payment or OAuth popup needs it                                | HTML responses                                      | P1–P3        | Separates the browsing context group from cross-origin windows                                   | WEB-04         |
| `Cross-Origin-Resource-Policy` | `same-origin`; `same-site` if sibling subdomains load the resource                                              | Every response                                      | P1–P3        | Blocks cross-origin no-cors reads of our responses                                               | WEB-04         |
| `X-Frame-Options`              | `DENY`; `SAMEORIGIN` when `frame-ancestors 'self'`                                                              | HTML responses                                      | P1–P3        | Legacy fallback only; `frame-ancestors` is the control (ASVS 5.0 V3.4.6)                         | WEB-04         |
| `Cache-Control`                | `no-store`                                                                                                      | Authenticated responses, personal data, token pages | P1–P3 (P4 S) | No copy in browser or shared caches (RFC 9111 §5.2.2.5)                                          | WEB-05         |
| `X-Powered-By`, `Server`       | Absent; `Server` without version                                                                                | Every response                                      | P1–P4        | Less fingerprinting                                                                              | WEB-04         |
| `Clear-Site-Data`              | `"cache", "cookies", "storage"`                                                                                 | Logout response                                     | P2, P3       | SHOULD; clears client-side state after logout                                                    | SES-05         |

Not part of the baseline: `X-XSS-Protection` (do not set it, or send `0`, as the OWASP HTTP
Headers Cheat Sheet recommends) and `Cross-Origin-Embedder-Policy` (only when cross-origin isolation
is needed; it blocks most third-party embeds).

## Policy

Framework-neutral target policy (one line in practice; `{NONCE}` is generated per response). Its
script part is the nonce-based strict policy of the OWASP Content Security Policy Cheat Sheet
(`script-src 'nonce-{RANDOM}' 'strict-dynamic'; object-src 'none'; base-uri 'none'`), extended
with framing, form and reporting directives:

```http
Content-Security-Policy: default-src 'self'; script-src 'nonce-{NONCE}' 'strict-dynamic'; style-src 'self' 'nonce-{NONCE}'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; report-uri https://www.example.com/csp-report; report-to csp
Reporting-Endpoints: csp="https://www.example.com/csp-report"
```

| Directive                            | Value                                                                          | Level  | Why                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| `script-src`                         | `'nonce-…' 'strict-dynamic'`, or `'sha256-…' 'strict-dynamic'` on static pages | MUST   | Only scripts we emitted run; scripts they load are trusted transitively (CSP3 §8.2)                                     |
| `script-src` exclusions              | No `'unsafe-inline'`, no `'unsafe-eval'` in production                         | MUST   | Either one re-enables injected script                                                                                   |
| `object-src`                         | `'none'`                                                                       | MUST   | No plugins (ASVS 5.0 V3.4.3)                                                                                            |
| `base-uri`                           | `'none'`                                                                       | MUST   | Stops `<base>` tag hijacking of relative URLs (ASVS 5.0 V3.4.3)                                                         |
| `frame-ancestors`                    | `'none'`, or `'self'` when the site frames itself                              | MUST   | Clickjacking (ASVS 5.0 V3.4.6)                                                                                          |
| `form-action`                        | `'self'`, plus a payment provider origin if a form posts there                 | MUST   | Stops form exfiltration                                                                                                 |
| `report-uri` and `report-to`         | Both, to the same endpoint                                                     | MUST   | `report-uri` is deprecated but still needed for browsers without `report-to` (CSP3 §6.5.1)                              |
| `default-src`                        | `'self'`                                                                       | SHOULD | Safe fallback for unlisted fetch directives                                                                             |
| `style-src`                          | `'self' 'nonce-…'`                                                             | SHOULD | `'unsafe-inline'` for styles only when Report-Only shows framework-generated style attributes; record it in the mapping |
| `img-src`, `font-src`, `connect-src` | Minimal list of origins                                                        | SHOULD | Limits exfiltration channels                                                                                            |

Nonce rules:

- At least 128 bits from a CSPRNG, base64-encoded, new for every response (CSP3 §7.1 requires a
  unique value per policy transmission and recommends 128 bits).
- Never cache an HTML response that carries a nonce: a cached page replays the nonce. Pages that
  must be cached use the hash-based variant.
- Put the nonce only on script and style elements the server itself emits; never copy a nonce into
  user-controlled markup.

Report endpoint:

- Accepts `application/csp-report` and `application/reports+json`, bodies up to 64 KB, returns 204.
- Rate-limited per IP; unauthenticated; never reflects input.
- Strips query strings and fragments from reported URLs before storing (they may hold tokens,
  LOG-02); keeps reports at most 30 days.

## Roll-out procedure

| Phase          | What                                                                                                                                                              | Exit criteria                                                                                                                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Inventory   | List script, style, image, font, connect and frame sources per page type: public pages, forms, login, admin, error pages, consent banner before and after consent | Inventory reviewed; target policy written                                                                                                                                                                                              |
| 1. Report-Only | Send the target policy as `Content-Security-Policy-Report-Only` on staging, then production                                                                       | At least 7 days in production and at least 1,000 HTML page views, or every journey of the inventory executed in two browser engines on low-traffic sites; zero unexplained violations in the last 72 h; canary report received (AT-33) |
| 2. Enforce     | Send the same policy as `Content-Security-Policy`; keep the endpoint                                                                                              | AT-32 passes on every deployment                                                                                                                                                                                                       |
| 3. Change      | Run the new policy in Report-Only next to the enforced one (both headers can be sent together, per the OWASP CSP Cheat Sheet)                                     | Same exit criteria as phase 1, except changes that only remove sources                                                                                                                                                                 |
| Rollback       | Revert to the previous enforced policy, never to no policy                                                                                                        | Incident noted in the mapping                                                                                                                                                                                                          |

Classify every violation as fixed, browser-extension noise (sources such as `chrome-extension`,
`moz-extension`, `safari-web-extension`), or a policy change with a reason. "Unexplained" means
none of these.

## Analytics after consent

Control link: DAT-04.

- Before consent: no analytics script element, no request to analytics hosts, no analytics cookie.
- After consent: a first-party loader that carries the nonce inserts the analytics script;
  `'strict-dynamic'` trusts it. Analytics hosts may be listed in `connect-src` and `img-src` up front:
  an allowed origin loads nothing by itself; the consent check in code is the control.
- On withdrawal: stop loading from the next page view and delete the analytics cookies the site can
  delete.
- Tag managers that inject arbitrary third-party code bypass the purpose of CSP. They SHOULD NOT be
  used; if used, record the accepted risk in the mapping.

## HSTS roll-out

1. Confirm every subdomain of the registered domain serves valid HTTPS, because `includeSubDomains`
   covers all of them.
2. On staging, ramp `max-age` from 86400 (one day) to 604800 (one week) to the target 63072000.
3. Production starts at `max-age` ≥ 31536000 with `includeSubDomains` (WEB-02).
4. `preload` only after a written decision by the security owner. List requirements (checked on
   hstspreload.org): valid certificate, HTTP-to-HTTPS redirect on the same host, all subdomains on
   HTTPS, `max-age` ≥ 31536000, `includeSubDomains` and `preload` on the base domain. Treat
   preloading as hard to undo.

## Cookies

Control: WEB-06; the session cookie is SES-02.

| Attribute         | Session cookie              | Other first-party cookies                                         | Consent-choice cookie              |
| ----------------- | --------------------------- | ----------------------------------------------------------------- | ---------------------------------- |
| Name prefix       | `__Host-`                   | `__Host-` unless subdomain sharing is required (then `__Secure-`) | `__Host-`                          |
| `Secure`          | Yes                         | Yes                                                               | Yes                                |
| `HttpOnly`        | Yes                         | Yes unless client script must read it                             | No (the banner reads it)           |
| `SameSite`        | `Strict` (P2) or `Lax` (P3) | `Lax` or `Strict`; `None` only with a documented cross-site need  | `Lax`                              |
| `Path` / `Domain` | `/` / absent                | `/` / absent unless sharing is required                           | `/` / absent                       |
| Lifetime          | ≤ absolute session lifetime | As short as the purpose allows                                    | Documented in the cookie inventory |
| Content           | Opaque token                | No personal data                                                  | Choice and policy version only     |

The consent-choice cookie is essential (it stores the refusal or acceptance) and may be set before
consent. Keep a cookie inventory (name, purpose, lifetime, essential yes/no) in the project mapping.

## Token and authenticated pages

Control: WEB-05.

- Send `Cache-Control: no-store` on every authenticated response and on pages reached through a
  token link (reset, invite, confirm, cancel); token pages also set `no-referrer` through the
  `Referrer-Policy` header or a `<meta name="referrer" content="no-referrer">` tag.
- Token pages SHOULD send `X-Robots-Tag: noindex` (or the equivalent meta tag) and load no
  third-party resources.
- Consume tokens with POST from a form on the page, never on GET: mail scanners prefetch links.

## Cross-origin requests

Control: WEB-07.

- State-changing requests use POST, PUT, PATCH or DELETE (ASVS 5.0 V3.5.3).
- The server rejects them unless `Origin` matches the application origin. When `Origin` is absent,
  accept `Sec-Fetch-Site: same-origin` or a valid anti-CSRF token; otherwise reject (ASVS 5.0
  V3.5.1). SameSite cookies are defence in depth, not the control.
- CORS: no `Access-Control-Allow-Origin` unless an endpoint is meant for cross-origin use; never `*`
  or a reflected origin together with `Access-Control-Allow-Credentials: true` (ASVS 5.0 V3.4.2).
- Framework-provided Origin checks (for example on server actions) count as the control when the
  mapping names them and AT-36 passes.

## security.txt

Control: OPS-06; specification: RFC 9116.

```text
Contact: mailto:security@example.com
Expires: 2027-10-13T00:00:00Z
Preferred-Languages: en, nl
Canonical: https://www.example.com/.well-known/security.txt
```

| Rule                                                                                     | Source                                           |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Served at `/.well-known/security.txt` over HTTPS                                         | RFC 9116 §3                                      |
| `Content-Type: text/plain; charset=utf-8`                                                | RFC 9116 §3                                      |
| `Contact` present (MUST); use a role address, never a personal one                       | RFC 9116 §2.5.3                                  |
| `Expires` present exactly once, at most 365 days ahead; renewed at every baseline review | RFC 9116 §2.5.5 (RECOMMENDED: less than a year)  |
| One file per host; a file covers only the host it is served from                         | RFC 9116 §3.1                                    |
| OpenPGP signature MAY be added                                                           | RFC 9116 §2.3 (RECOMMENDED there; optional here) |
| Reports acknowledged within 5 business days                                              | Baseline (OPS-06)                                |

## Example implementation: Next.js proxy with per-request nonce

Implementation choice (replaceable). Checked against the Next.js documentation on 2026-10-13: from
version 16 the request hook is a `proxy.ts` file exporting `proxy` (the `middleware` convention is
deprecated and renamed); earlier versions use `middleware.ts` exporting `middleware`. Check the
documentation of the framework version you run before copying this.

```ts
// proxy.ts (Next.js 16+; earlier versions: middleware.ts). Implementation choice (replaceable).
import { NextResponse, type NextRequest } from 'next/server';

const REPORT_URL = 'https://www.example.com/api/csp-report';
const ENFORCE = false; // phase 1 = Report-Only; switch after the exit criteria are met

export function proxy(request: NextRequest) {
  // 16 random bytes = 128 bits, as CSP3 recommends.
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
  const csp = [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `report-uri ${REPORT_URL}`,
    'report-to csp',
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce); // readable in server components via headers()
  requestHeaders.set('Content-Security-Policy', csp); // Next.js reads the nonce from this header

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  const name = ENFORCE ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';
  response.headers.set(name, csp);
  response.headers.set('Reporting-Endpoints', `csp="${REPORT_URL}"`);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
```

Notes taken from the Next.js CSP guide (checked 2026-10-13):

- Next.js applies the nonce while rendering on the server, based on the CSP header of the request,
  to its own framework scripts; scripts you add need the nonce from `x-nonce`.
- Nonces require dynamic rendering of every matched page: static optimisation and ISR are off,
  pages are not CDN-cached by default, and Partial Prerendering is incompatible. Pages that must
  stay static need the hash-based variant instead.
- The guide's own example derives the nonce from `crypto.randomUUID()`; the sketch above uses 16
  random bytes to meet the 128-bit recommendation of CSP3.
- Development tooling may need `'unsafe-eval'`; never send it in production.
- Static headers (HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP, CORP,
  `X-Frame-Options`) can be set in the framework's header configuration or at the hosting edge.
