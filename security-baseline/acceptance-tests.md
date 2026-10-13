# Acceptance tests

Checklist that turns the controls of [control-matrix.md](control-matrix.md) into repeatable checks.
Every control with M in P2 has at least one test. Passing tests in a template repository proves
nothing about a project; only evidence stored for a project's commit counts.

## How to use

| Type                         | Runs                                                        | Where                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Automated (CI)               | On every pull request                                       | Unit and integration tests on a throwaway database; no network to production                                                            |
| Automated (deployment smoke) | After every preview, staging and production deployment      | Read-only probes run everywhere; probes that create sessions or fail logins run on staging with test accounts only, never in production |
| Manual                       | At each assessment and on the cadence stated in the control | A person follows the procedure and stores the evidence                                                                                  |

- Evidence names the commit SHA and date, is redacted, and is stored as a CI artefact or next to the
  mapping; an undated screenshot is not evidence. Test accounts and TOTP secrets live in the CI
  secret store (DAT-06), never in scripts.
- Scripts are provider-neutral examples (bash, curl, grep, awk; GNU date where noted) and each is an
  Implementation choice (replaceable): adapt the login request to your application, keep the asserts.

## GOV tests

| ID    | Controls       | Type   | Profiles | Procedure                                                                                                                          | Pass criterion                                                                                | Evidence                                     |
| ----- | -------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------- |
| AT-01 | GOV-01, GOV-03 | Manual | All      | Open the mapping: owner and deputy, baseline version, commit SHA, assessment date; check every exception                           | Assessment at most 6 months old; every exception complete, unexpired and at most 90 days long | Mapping URL at commit SHA                    |
| AT-02 | GOV-02         | Manual | All      | Compare the worksheet's review log with the git history of authentication, integration and data-model changes since the last entry | Worksheet at most 12 months old; every trigger since then has a log entry                     | Worksheet URL at commit SHA; git log excerpt |

## IAM tests

| ID    | Controls | Type                         | Profiles | Procedure                                                                                                                                        | Pass criterion                                                                                                                                                                                                                                                            | Evidence                                      |
| ----- | -------- | ---------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| AT-03 | IAM-01   | Manual                       | P2, P3   | On staging, block outbound access to external identity providers (or remove their configuration); log in as every admin; export the account list | Every admin logs in with local password and MFA; no shared or default accounts (`admin`, `root`, `test`, generic mailboxes)                                                                                                                                               | Login log or recording; redacted account list |
| AT-04 | IAM-02   | Automated (CI)               | P2, P3   | Unit tests on the password-policy function                                                                                                       | 14 characters rejected and 15 accepted for single-factor use; 8 accepted only with mandatory MFA; 64-character and Unicode passphrases accepted; lowercase-only passphrase accepted; blocklisted, context-word and breached samples rejected with a reason; no truncation | CI log URL                                    |
| AT-05 | IAM-03   | Automated (CI)               | P2, P3   | Unit tests on the hashing helper; inspect one stored hash on staging                                                                             | Encoded parameters at or above the minimums; the same password hashed twice gives different 16-byte salts; verification correct; weaker stored parameters flagged for re-hash                                                                                             | CI log URL; redacted hash prefix              |
| AT-06 | IAM-04   | Automated (CI) + Manual      | P2, P3   | Integration test of the login flow; manual TOTP checks on staging                                                                                | P2: the password-only step reaches no admin route; an account without a factor lands in enrolment; no SMS, voice or e-mail factor offered; a reused TOTP code fails; ±1 step accepted, ±2 steps rejected                                                                  | CI log URL; screenshots                       |
| AT-07 | IAM-06   | Automated (CI) + Manual      | P2, P3   | Unit test of the code generator; walk the recovery flow on staging                                                                               | 10 unique codes of at least 64 bits; stored values are hashes; a used code fails on reuse; use triggers a notification and forced regeneration                                                                                                                            | CI log URL; notification screenshot           |
| AT-08 | IAM-07   | Automated (CI) + Manual      | P2, P3   | Integration test with an injected clock; review the admin UI and the audit log                                                                   | Setup link valid at 23 h 59 min, rejected at 24 h 1 min and after first use; first use forces password and MFA enrolment; no screen shows a password; admin reset logged with both admins; no P2 e-mail self-service route                                                | CI log URL; audit log excerpt                 |
| AT-09 | IAM-08   | Automated (CI) + Manual      | P3       | Integration test with an injected clock; database query on staging                                                                               | Stored value differs from the link token; token rejected after 30 min, after use and after a newer request; enrolled second factor still required; all sessions revoked; identical reply for unknown addresses                                                            | CI log URL; redacted query output             |
| AT-10 | IAM-09   | Automated (deployment smoke) | P2, P3   | [Throttling](#throttling) script on staging; then 51 failed logins from one IP with random identifiers; check the notification at 20 failures    | 6 failures pass unthrottled; immediate retry refused with a wait ≥ 1 s (429 and `Retry-After`, or the INP-07 equivalent); the next wait doubles; the IP limit refuses; user notified at 20                                                                                | Script output; notification screenshot        |
| AT-11 | IAM-10   | Automated (deployment smoke) | P2, P3   | [User enumeration](#user-enumeration) script for login; the same for reset and registration (P3)                                                 | Same status codes and normalised bodies; median difference below 50 ms over 20 requests per group                                                                                                                                                                         | Script output                                 |
| AT-12 | IAM-11   | Manual                       | P2, P3   | Trigger every IAM-11 event on staging with a test mailbox                                                                                        | Every notification arrives within 5 min; an e-mail change also notifies the old address                                                                                                                                                                                   | Mailbox screenshots with timestamps           |
| AT-13 | IAM-05   | Manual                       | P2, P3   | Register and use a platform authenticator and a roaming security key                                                                             | Both work as second factor                                                                                                                                                                                                                                                | Screenshots                                   |

## SES tests

| ID    | Controls       | Type                         | Profiles   | Procedure                                                                                                                                                 | Pass criterion                                                                                                                                                                                    | Evidence      |
| ----- | -------------- | ---------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| AT-14 | SES-01         | Automated (CI)               | P2, P3     | [Unit test](#unit-test-for-a-pure-helper) of the token helper; integration test searches the session table and captured request logs for the cookie value | Token ≥ 16 random bytes and unique; the table holds only a SHA-256 or HMAC-SHA-256 digest (64 hex characters, more for a stronger hash), never the token; the token never appears in URLs or logs | CI log URL    |
| AT-15 | SES-02, WEB-06 | Automated (deployment smoke) | P1, P2, P3 | [Cookie attributes](#cookie-attributes) on the login response (staging) and on key public pages                                                           | Every cookie Secure and SameSite Lax or Strict; session cookie `__Host-`, HttpOnly, Path=/, no Domain, Max-Age ≤ absolute lifetime                                                                | Script output |
| AT-16 | SES-01, SES-05 | Automated (deployment smoke) | P2, P3     | [Session revocation](#session-revocation) script on staging; admin "revoke sessions" checked by hand                                                      | Distinct token per login; other sessions fail after a password change; the token is rotated; a logged-out token fails on the next request                                                         | Script output |
| AT-17 | SES-03         | Automated (CI)               | P2, P3     | Integration test with an injected clock                                                                                                                   | P2: idle 29 min valid, 31 min rejected; 12 h 1 min rejected despite activity; P3: 60 min idle and 24 h absolute; "remember me" at most 30 days                                                    | CI log URL    |
| AT-18 | SES-04         | Automated (CI)               | P2, P3     | Integration test for each sensitive action with an injected clock                                                                                         | Last authentication 4 min ago: allowed; 6 min ago: re-authentication required                                                                                                                     | CI log URL    |

## ACC tests

| ID    | Controls | Type           | Profiles   | Procedure                                                                                                                                                                                               | Pass criterion                                                                                                  | Evidence   |
| ----- | -------- | -------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------- |
| AT-19 | ACC-01   | Automated (CI) | P2, P3, P4 | Enumerate routes and server actions from the framework; compare with the permission matrix; call each unauthenticated and with the lowest role                                                          | Test fails on any unmapped route; unauthenticated gives 401 or a login redirect; a missing permission gives 403 | CI log URL |
| AT-20 | ACC-02   | Automated (CI) | P2, P3, P4 | Two accounts: A reads, updates and deletes B's object IDs; snapshot of response field names                                                                                                             | Every cross-account call gives 403 or 404; responses contain only allowlisted fields                            | CI log URL |
| AT-21 | ACC-03   | Automated (CI) | P4         | Machine-credential lifecycle tests                                                                                                                                                                      | Key stored hashed; expired or revoked key gives 401 on the next request; out-of-scope call gives 403            | CI log URL |
| AT-22 | ACC-04   | Automated (CI) | All        | Webhook without signature, with a wrong signature, with a 6-minute-old signed timestamp (if the sender signs one) and a replayed event ID; OAuth callback without, with a wrong and with a reused state | All rejected (400 or 401); a valid request is accepted                                                          | CI log URL |

## INP tests

| ID    | Controls | Type                         | Profiles   | Procedure                                                                                                                                                                                      | Pass criterion                                                                                                                                        | Evidence                     |
| ----- | -------- | ---------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| AT-23 | INP-01   | Automated (CI)               | All        | Per entry point: wrong type, oversize value, unknown field; static check that every action and route handler uses a schema                                                                     | 400 or 422 with a generic body; unknown field not stored; static check passes                                                                         | CI log URL                   |
| AT-24 | INP-02   | Automated (CI)               | All        | [Sink search](#sink-search)                                                                                                                                                                    | No unreviewed match                                                                                                                                   | CI log URL                   |
| AT-25 | INP-03   | Automated (CI)               | P1, P2, P3 | Sanitiser tests with a payload corpus (`<script>`, `onerror`, `javascript:` and `data:` URLs, SVG `onload`, `<style>`); sink search for raw-HTML APIs                                          | No script, event handler or disallowed scheme survives; raw-HTML sinks only in allowlisted files                                                      | CI log URL                   |
| AT-26 | INP-04   | Manual                       | All        | Upload an HTML file renamed to `.jpg`, an oversize file, an SVG with script and a photo with GPS metadata; download each                                                                       | Rejected or sanitised; oversize gives 413; non-images served with `nosniff` and `attachment`; metadata removed; stored names random                   | Test notes; response headers |
| AT-27 | INP-05   | Automated (deployment smoke) | P1, P2, P3 | `curl -sI` every redirecting endpoint with `next=//evil.example`, `next=https://evil.example`, `next=/\evil.example`, `next=%2F%2Fevil.example`                                                | `Location` stays on the own origin                                                                                                                    | Script output                |
| AT-28 | INP-06   | Automated (CI)               | P2, P3, P4 | URL-guard unit tests with a stubbed resolver: 127.0.0.1, 10.0.0.1, 169.254.169.254, [::1], [fd00::1], 0.0.0.0, decimal and octal IP forms, a name resolving to a private address, a redirect   | All rejected; allowlisted host accepted; redirect not followed                                                                                        | CI log URL                   |
| AT-29 | INP-07   | Automated (deployment smoke) | P1, P3     | On staging, submit each unauthenticated form 6 times in 10 min from one IP, and 4 times in one hour with one e-mail address from two IPs; count stored records and sent mails before and after | The 6th and the 4th submission get 429, or the documented equivalent result where no status code can be set; neither creates a record or sends a mail | Script output                |

## WEB tests

| ID    | Controls       | Type                         | Profiles                               | Procedure                                                                                                                                                                                              | Pass criterion                                                                                                               | Evidence                                    |
| ----- | -------------- | ---------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| AT-30 | WEB-01         | Automated (deployment smoke) | All                                    | `curl -sI http://<host>/`; `openssl s_client -connect <host>:443 -tls1_1 -cipher 'DEFAULT@SECLEVEL=0'` (OpenSSL 3 refuses TLS 1.1 itself without it) and `-tls1_2`                                     | Browser host answers 301 or 308 to https; API host serves no content over HTTP; TLS 1.1 handshake fails and TLS 1.2 succeeds | Command output                              |
| AT-31 | WEB-02, WEB-04 | Automated (deployment smoke) | P1, P2, P3 (P4: `nosniff`, no banners) | [Header probe](#header-probe) on one URL per page type                                                                                                                                                 | Every line PASS                                                                                                              | Script output                               |
| AT-32 | WEB-03         | Automated (deployment smoke) | P1, P2, P3                             | [CSP probe](#csp-probe) on one URL per page type (after roll-out phase 2)                                                                                                                              | Every line PASS                                                                                                              | Script output                               |
| AT-33 | WEB-03         | Manual                       | P1, P2, P3                             | [CSP Report-Only verification](#csp-report-only-verification) during roll-out phase 1                                                                                                                  | Canary report stored; exit criteria of [headers-csp.md](headers-csp.md#roll-out-procedure) met                               | Report export with classification; sign-off |
| AT-34 | WEB-05         | Automated (deployment smoke) | P1, P2, P3                             | `curl -sI` with a test session on an authenticated page, and on reset, invite, confirm and cancel pages; `curl -s` each token page and grep the body for `<meta name="referrer" content="no-referrer"` | `cache-control` contains `no-store`; each token page sends `referrer-policy: no-referrer` or contains that meta tag          | Script output                               |
| AT-35 | WEB-06         | Manual                       | P1, P2, P3                             | Walk the key journeys in a fresh browser profile; export all cookies; compare with the cookie inventory                                                                                                | Every cookie is in the inventory and meets WEB-06                                                                            | Cookie export                               |
| AT-36 | WEB-07         | Automated (deployment smoke) | P1, P2, P3                             | POST to each state-changing endpoint with `Origin: https://evil.example` (on staging with a test session where needed); CORS preflight from that origin                                                | Foreign origin rejected; same origin accepted; no `access-control-allow-origin` for the foreign origin                       | Script output                               |

## DAT tests

| ID    | Controls       | Type                                  | Profiles   | Procedure                                                                                                                          | Pass criterion                                                                                                            | Evidence                             |
| ----- | -------------- | ------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| AT-37 | DAT-01, DAT-02 | Manual                                | All        | List database columns and form fields; map each to an inventory row; compare processors with configured integrations               | Every field and processor mapped; every processor has a DPA link; no field without purpose                                | Mapping table in the project mapping |
| AT-38 | DAT-03         | Automated (CI) + Manual               | All        | Retention logic test on a throwaway database; check the job schedule and its last run                                              | Records past retention removed or anonymised, others kept; last run at most 7 days ago                                    | CI log URL; job log                  |
| AT-39 | DAT-04         | Manual                                | P1, P2, P3 | Fresh browser profile: record network requests and cookies before any click, after refusing, after accepting and after withdrawing | Before consent and after refusing: no third-party or analytics request, no non-essential cookie; withdrawal stops loading | Redacted HAR files; screenshots      |
| AT-40 | DAT-05         | Automated (deployment smoke) + Manual | P1, P2, P3 | Fetch every page type and form and grep for the privacy and terms links; review the request procedure                              | Both links on every page and form; procedure states the one-month limit                                                   | Script output; procedure link        |
| AT-41 | DAT-06, SUP-06 | Automated (CI)                        | All        | [Secret scan](#composition-analysis-and-secret-scan), plus a check that secret values do not occur in client build output          | No finding; no secret value in client assets                                                                              | Redacted CI log URL                  |
| AT-42 | DAT-07         | Automated (CI) + Manual               | All        | Unit tests of token-hashing and encryption helpers; code search for MD5 and SHA-1 in security code; provider settings              | Tests pass; no security use of MD5 or SHA-1; encryption at rest on for database and backups                               | CI log URL; settings screenshot      |

## SUP tests

| ID    | Controls       | Type                    | Profiles | Procedure                                                                                                             | Pass criterion                                                                                                                  | Evidence                    |
| ----- | -------------- | ----------------------- | -------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| AT-43 | SUP-01         | Automated (CI)          | All      | Read the install step of a CI run; open a test PR that changes the manifest without the lockfile                      | Exact-lockfile command used; the test PR fails                                                                                  | CI log URLs                 |
| AT-44 | SUP-02, SUP-03 | Automated (CI) + Manual | All      | [Composition-analysis gate](#composition-analysis-and-secret-scan) on every PR and daily; monthly advisory-age report | The gate exits 0 only without blocking advisories; no advisory past its SLA                                                     | CI log URL; monthly report  |
| AT-45 | SUP-04         | Manual                  | All      | Review every PR since the last assessment that added a direct dependency                                              | Each carries the completed checklist                                                                                            | PR links                    |
| AT-46 | SUP-05         | Automated (CI) + Manual | All      | [Workflow lint](#workflow-lint); export the branch protection settings                                                | Every third-party step SHA-pinned; workflow-level `permissions:`; no untrusted checkout with secrets; protection matches SUP-05 | CI log URL; settings export |
| AT-47 | SUP-07         | Automated (CI)          | All      | Check the latest release record for the SBOM                                                                          | SBOM present and valid (`bomFormat`, `specVersion`, or the SPDX equivalent)                                                     | Release artefact link       |
| AT-48 | SUP-08         | Manual                  | All      | Trace the latest production artefact to its commit and build log                                                      | The link exists; signed provenance exists if Build L2 is claimed                                                                | Build record link           |
| AT-49 | SUP-09         | Automated (CI)          | All      | Print the runtime version in CI and production; compare with the vendor schedule                                      | Version in an active or maintenance window; end of life at least 30 days away                                                   | CI log URL                  |

## LOG tests

| ID    | Controls       | Type                    | Profiles   | Procedure                                                                                                                 | Pass criterion                                                                      | Evidence                    |
| ----- | -------------- | ----------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------- |
| AT-50 | LOG-01         | Automated (CI) + Manual | P2, P3, P4 | Integration test captures logger output for every audit event; spot check on staging                                      | Every event present with all LOG-01 fields                                          | CI log URL; log excerpt     |
| AT-51 | LOG-02         | Automated (CI)          | All        | Run login, reset and form flows with canary values (password, token, e-mail, health note); search the captured logs       | No canary appears                                                                   | CI log URL                  |
| AT-52 | LOG-03, LOG-04 | Manual                  | P2, P3, P4 | Review log-store access and retention; trigger synthetic alerts (20 failed logins on a test account, a test burst of 5xx) | Access limited to named roles; retention as documented; alerts arrive within 15 min | Screenshots with timestamps |

## OPS tests

| ID    | Controls | Type                                  | Profiles   | Procedure                                                                                                             | Pass criterion                                                                            | Evidence                    |
| ----- | -------- | ------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------- |
| AT-53 | OPS-01   | Automated (deployment smoke) + Manual | All        | `curl -sI` non-production hosts; compare database and secret identifiers per environment; check the anonymisation log | Authentication required or `noindex`; identifiers differ; no unanonymised production data | Script output; review notes |
| AT-54 | OPS-02   | Manual                                | All        | Review the latest production deploy; rollback drill every 6 months                                                    | Green CI, approver and commit SHA recorded; rollback within 15 min                        | Deploy log; drill record    |
| AT-55 | OPS-03   | Automated (deployment smoke)          | All        | Request `/.git/HEAD`, `/.env`, an asset directory, a `TRACE` and a URL that raises an error                           | 404, 405 or 501; no listing; generic error page without stack trace                       | Script output               |
| AT-56 | OPS-04   | Manual                                | All        | Restore the latest backup into a scratch environment and run the smoke tests                                          | Restore within the RTO; data at most 24 h old                                             | Drill record                |
| AT-57 | OPS-05   | Manual                                | All        | Yearly tabletop: a leaked admin session exposes personal data                                                         | Roles and contacts reachable; the 72 h notification decision walked through               | Exercise notes              |
| AT-58 | OPS-06   | Automated (deployment smoke)          | P1, P2, P3 | [security.txt probe](#securitytxt-probe)                                                                              | PASS                                                                                      | Script output               |
| AT-59 | OPS-07   | Manual                                | All        | Export the members of hosting, database, DNS, CI, repository, secrets store and mail accounts                         | Individual accounts, MFA on, no leavers, review at most 6 months old                      | Access review record        |

## Runnable examples

### Header probe

```bash
#!/usr/bin/env bash
# AT-31: headers via HEAD; if HEAD differs from GET, use: curl -sS -o /dev/null -D - "$url"
set -u
url="${1:?usage: $0 <url>}"
h=$(curl -sSI "$url" | tr -d '\r' | tr 'A-Z' 'a-z')
fail=0
ok() { echo "PASS $1"; }
bad() { echo "FAIL $1"; fail=1; }
has() { if grep -qE -- "$2" <<<"$h"; then ok "$1"; else bad "$1"; fi; }
lacks() { if grep -qE -- "$2" <<<"$h"; then bad "$1"; else ok "$1"; fi; }
age=$(grep -oE '^strict-transport-security:.*max-age=[0-9]+' <<<"$h" | grep -oE '[0-9]+$')
if [ "${age:-0}" -ge 31536000 ]; then ok "HSTS max-age $age"; else bad "HSTS max-age ${age:-missing}"; fi
has "HSTS includeSubDomains" '^strict-transport-security:.*includesubdomains'
has "X-Content-Type-Options" '^x-content-type-options: *nosniff'
has "Referrer-Policy" '^referrer-policy: *([a-z-]+, *)*(strict-origin-when-cross-origin|strict-origin|same-origin|no-referrer)$'
has "Permissions-Policy" '^permissions-policy: .+'
has "COOP" '^cross-origin-opener-policy: *same-origin'
has "CORP" '^cross-origin-resource-policy: *same-(origin|site)'
has "X-Frame-Options" '^x-frame-options: *(deny|sameorigin)'
lacks "no X-Powered-By" '^x-powered-by:'
lacks "no version in Server" '^server:.*[0-9]+\.[0-9]+'
exit $fail
```

### CSP probe

```bash
#!/usr/bin/env bash
# AT-32: enforced strict CSP on an HTML page. Usage: at-32-csp.sh https://www.example.com/
set -u
url="${1:?usage: $0 <url>}"
csp() { curl -sS -o /dev/null -D - "$url" | tr -d '\r' | grep -i '^content-security-policy:' | cut -d' ' -f2-; }
a=$(csp); b=$(csp); fail=0
ok() { echo "PASS $1"; }
bad() { echo "FAIL $1"; fail=1; }
has() { if grep -qE -- "$3" <<<"$2"; then ok "$1"; else bad "$1"; fi; }
s=$(grep -oE "script-src [^;]*" <<<"$a")
has "enforced policy present" "$a" '.'
has "script-src nonce or hash" "$s" "'nonce-[A-Za-z0-9+/_-]{22,}={0,2}'|'sha(256|384|512)-"
has "script-src strict-dynamic" "$s" "'strict-dynamic'"
if grep -qE "'unsafe-(inline|eval)'" <<<"$s"; then bad "no unsafe-* in script-src"; else ok "no unsafe-* in script-src"; fi
has "object-src none" "$a" "object-src 'none'"
has "base-uri none" "$a" "base-uri 'none'"
has "frame-ancestors" "$a" "frame-ancestors '(none|self)'"
has "form-action" "$a" "form-action 'self'"
has "reporting" "$a" "report-to |report-uri "
if grep -q "'nonce-" <<<"$a"; then
  if [ "$a" != "$b" ]; then ok "nonce differs per response"; else bad "nonce reused"; fi
fi
exit $fail
```

### Cookie attributes

```bash
#!/usr/bin/env bash
# AT-15: Set-Cookie attributes. Usage: at-15-cookies.sh <headers-file> [session-cookie] [max-age]
# Capture the headers with the request your login uses, e.g. curl -sS -o /dev/null -D login.headers ...
set -u
file="${1:?usage: $0 <headers-file> [session-cookie] [max-age]}"
session="${2:-__Host-session}"; max="${3:-43200}"; fail=0
bad() { echo "FAIL $1"; fail=1; }
while IFS= read -r line; do
  c=${line#*: }; name=${c%%=*}; l=$(tr 'A-Z' 'a-z' <<<"$c")
  grep -qE '; *secure(;|$)' <<<"$l" || bad "$name: Secure"
  grep -qE '; *samesite=(lax|strict)' <<<"$l" || bad "$name: SameSite=Lax or Strict"
  grep -qE '; *httponly(;|$)' <<<"$l" || echo "WARN $name: not HttpOnly (only if script must read it)"
  if [ "$name" = "$session" ]; then
    grep -qE '; *httponly(;|$)' <<<"$l" || bad "$name: HttpOnly"
    grep -qE '; *path=/(;|$)' <<<"$l" || bad "$name: Path=/"
    if grep -qE '; *domain=' <<<"$l"; then bad "$name: Domain must be absent"; fi
    age=$(grep -oE 'max-age=[0-9]+' <<<"$l" | cut -d= -f2)
    [ -n "$age" ] && [ "$age" -le "$max" ] || bad "$name: Max-Age ${age:-missing} (limit $max)"
  fi
done < <(tr -d '\r' <"$file" | grep -i '^set-cookie:')
tr -d '\r' <"$file" | grep -qi "^set-cookie: $session=" || bad "session cookie $session not set"
[ "$fail" = 0 ] && echo PASS
exit $fail
```

### Throttling

```bash
#!/usr/bin/env bash
# AT-10 on STAGING, never production. Adapt attempt() (status, Retry-After in s); print 429 for an INP-07 equivalent.
set -u
base="${BASE:?set BASE}"; id="${TEST_ID:?set TEST_ID}"
attempt() {
  curl -sS -o /dev/null -D - -X POST "$base/api/login" -H "Origin: $base" \
    -H 'Content-Type: application/json' -d "{\"email\":\"$id\",\"password\":\"wrong-$1\"}" |
    tr -d '\r' | awk 'NR==1{c=$2} tolower($1)=="retry-after:"{r=$2} END{print c, (r==""?0:r)}'
}
fail() { echo "FAIL $1"; exit 1; }
for i in 1 2 3 4 5 6; do
  read -r code ra <<<"$(attempt "$i")"; echo "failure $i: $code"
  [ "$code" != 429 ] || fail "throttled before the 6th failure"
done
read -r code ra <<<"$(attempt 7)"; echo "immediate retry: $code Retry-After $ra"
[ "$code" = 429 ] && [ "$ra" -ge 1 ] || fail "no wait after 6 consecutive failures"
sleep "$ra"; read -r code _ <<<"$(attempt 8)"; echo "after waiting: $code (7th failure)"
read -r code ra2 <<<"$(attempt 9)"; echo "immediate retry: $code Retry-After $ra2"
[ "$code" = 429 ] && [ "$ra2" -ge $((ra * 2)) ] || fail "wait did not double"
echo "PASS (reset the counter with a successful login of the test account)"
```

### Session revocation

```bash
#!/usr/bin/env bash
# AT-16 on STAGING. Helpers print a token: ./login.sh (password + TOTP), ./change-password.sh, ./logout.sh
set -u
base="${BASE:?set BASE}"; name="${COOKIE:-__Host-session}"; probe="${PROBE:-/admin}"
code() { curl -sS -o /dev/null -w '%{http_code}' -b "$name=$1" "$base$probe"; }
fail() { echo "FAIL $1"; exit 1; }
denied() { case "$(code "$1")" in 401 | 403 | 302 | 303 | 307) return 0 ;; *) return 1 ;; esac; }
a=$(./login.sh); b=$(./login.sh)
[ -n "$a" ] && [ "$a" != "$b" ] || fail "two logins did not yield two distinct tokens"
[ "$(code "$a")" = 200 ] && [ "$(code "$b")" = 200 ] || fail "fresh sessions rejected"
b2=$(./change-password.sh "$b")
denied "$a" || fail "other session survived the password change"
denied "$b" || fail "token was not rotated on the password change"
[ "$(code "$b2")" = 200 ] || fail "rotated session rejected"
./logout.sh "$b2"
denied "$b2" || fail "session survived logout"
echo PASS
```

### User enumeration

```bash
#!/usr/bin/env bash
# AT-11 on STAGING. EXISTING = 4 test accounts with counters reset by a successful login; unknown
# addresses are new per run; 5 tries per identifier and 40 per run stay below IAM-09 limits.
set -u
base="${BASE:?set BASE}"; read -r -a known <<<"${EXISTING:?4 space-separated test accounts}"
norm="${NORMALISE:-s/[0-9a-f]{16,}//g}" # strip volatile values (request IDs, nonces)
try() {
  curl -sS -o "$2" -w '%{http_code} %{time_total}\n' -X POST "$base/api/login" -H "Origin: $base" \
    -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"Wrong-password-000\"}"
}
fail() { echo "FAIL $1"; exit 1; }
: >known.txt; : >unknown.txt
for round in 1 2 3 4 5; do
  for i in 0 1 2 3; do
    try "${known[$i]}" k.body >>known.txt
    try "nobody-$i-$$@example.invalid" u.body >>unknown.txt
    cmp -s <(sed -E "$norm" k.body) <(sed -E "$norm" u.body) || fail "bodies differ (round $round)"
  done
done
[ "$(cut -d' ' -f1 known.txt | sort -u)" = "$(cut -d' ' -f1 unknown.txt | sort -u)" ] || fail "status codes differ"
median() { cut -d' ' -f2 "$1" | sort -n | awk '{a[NR]=$1} END{print (NR%2 ? a[(NR+1)/2] : (a[NR/2]+a[NR/2+1])/2)}'; }
awk -v k="$(median known.txt)" -v u="$(median unknown.txt)" 'BEGIN{d=k-u; if (d<0) d=-d;
  printf "median known %.3f s, unknown %.3f s, difference %.0f ms\n", k, u, d*1000; exit !(d<0.050)}' ||
  fail "timing difference of 50 ms or more"
echo PASS
```

### CSP Report-Only verification

1. `curl -sSI "$BASE/" | grep -i '^content-security-policy-report-only:'` shows the target policy.
2. The endpoint accepts a synthetic report and stores it:
   `curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$BASE/csp-report" -H 'Content-Type: application/csp-report' --data '{"csp-report":{"document-uri":"https://www.example.com/","violated-directive":"connect-src","blocked-uri":"https://csp-canary.example.org/"}}'`
   prints 204, and the report appears in the store.
3. Real-browser canary in two engines: on a page under the policy, run
   `fetch('https://csp-canary.example.org/')` in the developer console. The console shows a
   Report-Only `connect-src` violation and the store receives the report within 5 min.
4. Export the phase's reports with a classification column and the page-view count; owner signs off.

### Composition analysis and secret scan

```bash
npm audit --omit=dev --json > audit.json || true # AT-44; gate script in supply-chain-ci.md
node scripts/sca-gate.mjs audit.json security-exceptions.json
gitleaks git --redact --report-format sarif --report-path gitleaks.sarif . # AT-41; exit 1 = leak or error
# Secret values must not reach client assets (names come from the secret inventory; values from CI):
for v in DATABASE_URL SESSION_SECRET MAIL_API_KEY; do
  [ -n "${!v:-}" ] && grep -rqF -- "${!v}" "${CLIENT_BUILD_DIR:?}" && { echo "FAIL $v in client build"; exit 1; }
done; echo PASS
```

### Sink search

```bash
# Adapt the patterns to your stack; reviewed lines carry a "security-reviewed:" comment.
git grep -nE 'child_process|\beval\(|new Function\(|sql\.raw\(|\.unsafe\(|dangerouslySetInnerHTML|\.innerHTML *=' -- src |
  grep -v 'security-reviewed:' && { echo "FAIL unreviewed sinks above"; exit 1; } || echo PASS
```

### Workflow lint

```bash
#!/usr/bin/env bash
set -u # AT-46 for GitHub Actions workflows (example implementation)
dir="${1:-.github/workflows}"; fail=0
unpinned=$(grep -rhoE '^\s*-?\s*uses:\s*[^ #]+' "$dir" | sed -E 's/.*uses:\s*//' |
  grep -vE '^\./|^docker://' | grep -vE '@[0-9a-f]{40}$' || true)
[ -z "$unpinned" ] || { echo "FAIL not pinned to a full commit SHA:"; echo "$unpinned"; fail=1; }
for f in "$dir"/*.y*ml; do grep -qE '^permissions:' "$f" || { echo "FAIL $f: no workflow-level permissions"; fail=1; }; done
grep -lE 'pull_request_target|workflow_run' "$dir"/*.y*ml && echo "REVIEW: no untrusted checkout with secrets in the files above"
[ "$fail" = 0 ] && echo PASS
exit $fail
```

### security.txt probe

```bash
#!/usr/bin/env bash
# AT-58: RFC 9116 security.txt. Usage: at-58-securitytxt.sh https://www.example.com (GNU date)
set -u
host="${1:?usage: $0 <origin>}"; f=$(mktemp)
ct=$(curl -sS -o "$f" -w '%{content_type}' "$host/.well-known/security.txt")
tr -d '\r' <"$f" >"$f.lf"
fail() { echo "FAIL $1"; exit 1; }
grep -qiE '^text/plain; *charset=utf-8' <<<"$ct" || fail "Content-Type: $ct"
grep -qE '^Contact: (mailto:|https://|tel:)' "$f.lf" || fail "Contact"
[ "$(grep -cE '^Expires: ' "$f.lf")" = 1 ] || fail "Expires must appear exactly once"
end=$(date -u -d "$(sed -n 's/^Expires: //p' "$f.lf")" +%s) || fail "Expires unparsable"; now=$(date -u +%s)
[ "$end" -gt "$now" ] && [ $((end - now)) -le $((365 * 86400)) ] || fail "Expires not within 365 days"
echo PASS
```

### Unit test for a pure helper

Generic `describe`/`it`/`expect` style for Vitest or Jest (Implementation choice (replaceable)).

```ts
// session-token.ts: pure helper, no database, network or framework runtime
import { createHash, randomBytes } from "node:crypto";

export const createSessionToken = (): string =>
  randomBytes(32).toString("base64url");
export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");
export const sessionCookieOptions = (opts: {
  production: boolean;
  profile: "P2" | "P3";
}) => ({
  name: opts.production ? "__Host-session" : "session",
  httpOnly: true,
  secure: opts.production,
  sameSite: opts.profile === "P2" ? ("strict" as const) : ("lax" as const),
  path: "/",
  maxAge: opts.profile === "P2" ? 12 * 60 * 60 : 24 * 60 * 60,
});

// session-token.test.ts (AT-14), a separate file in practice
import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  hashToken,
  sessionCookieOptions,
} from "./session-token";

describe("session tokens", () => {
  it("have at least 128 bits and are unique", () => {
    const a = createSessionToken();
    expect(Buffer.from(a, "base64url").length).toBeGreaterThanOrEqual(16);
    expect(a).not.toBe(createSessionToken());
  });
  it("are stored only as a SHA-256 digest", () => {
    const token = createSessionToken();
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain(token);
  });
  it("use hardened cookie options in production", () => {
    const o = sessionCookieOptions({ production: true, profile: "P2" });
    expect(o.name.startsWith("__Host-")).toBe(true);
    expect(o).toMatchObject({ httpOnly: true, secure: true, path: "/" });
    expect(["lax", "strict"]).toContain(o.sameSite);
    expect(o).not.toHaveProperty("domain");
    expect(o.maxAge).toBeLessThanOrEqual(12 * 60 * 60);
  });
});
```
