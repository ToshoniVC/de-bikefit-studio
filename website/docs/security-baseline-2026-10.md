# Dependency security baseline — October 2026

Status of `npm audit` on `feat/security-baseline-20261013` (2026-10-13), what was
patched, and the disposition of everything that remains. Re-check with
`npm audit` inside `website/`; update this file whenever the picture changes.

## What was patched

| Package | From | To | Why |
| --- | --- | --- | --- |
| `next` | 16.2.7 | 16.4.0 | Critical advisory batch against ≤ 16.3.7: unauthenticated RCE in the Image Optimization API (AVIF) and `next/og` (GHSA-2xp9-vwfh-vxw4, GHSA-vcvr-r3jv-pc5j), SSRF in server actions/rewrites/image optimizer, SSG/ISR cache poisoning, middleware bypass, server-action DoS. |
| `eslint-config-next` | 16.2.7 | 16.4.0 | Kept in lockstep with `next`, as required. |
| `sharp`, `postcss` (under `next`) | vulnerable | 0.35.5 / 8.5.23 | Pulled in by the `next` upgrade (`next@16.4.0` pins `postcss` to exactly 8.5.23); clears the libvips/libheif CVEs and the PostCSS sourceMappingURL file-read advisories (see _PostCSS versions_ below). |
| `shadcn` | runtime dependency | development dependency | Its Tailwind stylesheet is consumed at build time; the CLI and vulnerable transitive glob tooling are not needed in the production install. |
| ~20 transitive packages | various | via `npm audit fix` | Semver-compatible fixes, notably **critical** `proxy-addr` IP spoofing (GHSA-jqcg-44mw-7w3h — relevant because login/booking rate limiting keys on client IP), `qs`, `body-parser`, `brace-expansion`, `source-map-js`, `@hono/node-server`, `@modelcontextprotocol/sdk`, `baseline-browser-mapping`. |

Result: **30 vulnerabilities (2 critical / 18 high) → 15 (0 critical / 9 high / 6 moderate)** across development and production dependencies. `npm audit --omit=dev` reports **0 findings** after moving the build-only `shadcn` package to development dependencies. This is package classification, not a fix for its open advisories; CI and build hosts still install the full dependency set.

**PostCSS versions** (checked 2026-10-13 with `npm ls postcss --all`, `package-lock.json` and `npm audit`). Two copies are installed: `node_modules/next/node_modules/postcss` **8.5.23**, pinned exactly by `next@16.4.0`, and the hoisted `node_modules/postcss` **8.5.28**, used by `sanitize-html` at runtime and by `@tailwindcss/postcss`, `vite` and `shadcn` at build and dev time. The sourceMappingURL advisories are GHSA-6g55-p6wh-862q (≤ 8.5.11), GHSA-r28c-9q8g-f849 (≤ 8.5.17) and its incomplete-fix follow-up GHSA-fxqj-rqcc-2cmp (≤ 8.5.22), so 8.5.23 is the first release outside all three; the older GHSA-7fh5-64p2-3v2j (< 8.4.31) and GHSA-qx2v-qp2m-jg93 (< 8.5.10) do not apply either. `npm audit` and `npm audit --omit=dev` report no `postcss` finding for either copy. The ranges are those of the npm advisory database on that date (queried with `npm audit` on a scratch lockfile listing postcss versions); re-check after every `next` upgrade, because `next` pins its own copy.

## Accepted (open) advisories

All 15 remaining findings are transitive and reduce to three root causes. None is
reachable from production traffic: they live in lint-, build- or dev-time tooling
only. `npm audit fix --force` would "fix" them by breaking downgrades
(`shadcn@1.0.0`, `@tailwindcss/typography@0.5.4`) and is not acceptable.

| Root cause | Advisory | Affected chains | Disposition |
| --- | --- | --- | --- |
| `braces` (all versions) stack-exhaustion DoS | GHSA-vfj7-8cjw-p6xm | `micromatch` → `fast-glob` → `@next/eslint-plugin-next` (via `eslint-config-next`), `shadcn`/`@shadcn/registry`, `ts-morph` | **Accepted.** No fixed `braces` release exists (range is `*`). Only exploitable by feeding adversarial glob patterns to our own dev tools; never runs in the deployed app. Revisit when upstream ships a fix. |
| `esbuild` dev-server request forwarding | GHSA-67mh-4wv8-2f99 | `@esbuild-kit/*` → `drizzle-kit` | **Accepted.** Dev-time only (`drizzle-kit` migration generation); the esbuild dev server is never exposed. Fix arrives when drizzle-kit drops the deprecated `@esbuild-kit` loader. |
| `postcss-selector-parser` < 7.1.6 quadratic parsing | GHSA-rj75-hqrm-r3gf | `@tailwindcss/typography` | **Accepted.** Build-time only, parses our own stylesheets, no untrusted input. Suggested "fix" is a breaking downgrade of `@tailwindcss/typography`. Candidate for an `overrides` pin once `@tailwindcss/typography` accepts ≥ 7.1.6. |

## Server-side `mustChangePassword` enforcement

Shipped in the same branch: temporary-password sessions are now rejected at the
auth-guard layer (`requireCmsUser` / `requirePermission`), not only by the admin
layout redirect. Details in `docs/cms-architecture.md` (auth section).

## Admin two-step verification (TOTP) and its one new dependency

Shipped in the same branch: mandatory TOTP two-step verification for CMS admins, migration
`0005_cms_admin_mfa` (design in `docs/cms-architecture.md` §4, rollout in
`docs/staging-runbook.md` §14; together with the e-mail settings from `staging` and block 3:
§16). It adds exactly one runtime package:

| Package | Version | Why | Supply-chain notes |
| --- | --- | --- | --- |
| `uqr` | 0.1.3 (pinned exactly) | Draws the enrolment QR code on our own server, so the TOTP secret never reaches an image service or any third party. | MIT, unjs; **zero dependencies**, no install scripts, ~740 lines of plain JS. Its matrix was checked once against an independent decoder (jsQR, outside the repository): the decoded text equals the `otpauth://` URI. |

TOTP, base32, recovery codes and encryption use only `node:crypto` (no OTP library). After
the change `npm audit` is unchanged: **15 findings (0 critical / 9 high / 6 moderate)** in
development tooling, the same three accepted root causes as above, and
`npm audit --omit=dev` reports **0 findings**.


## Admin session limits, step-up, scrypt cost and admin CSP (block 3)

Shipped in the same branch, no new dependency (`node:crypto`, Web Crypto and Next's own
`connection()` only):

- **Admin sessions** end after 15 minutes without a request and 8 hours after sign-in at the
  latest, enforced on the server (`src/lib/cms/session-policy.ts`); editors and providers keep
  14 days, sliding. Migration `0006_cms_session_limits` (two nullable columns).
- **Step-up**: user management, an admin's own password change and, since the merge with
  `staging`, changes to the e-mail service settings in `/admin/email` need a full
  re-authentication (password + code) within 5 minutes, checked inside the library functions
  (`recentReauthentication` in `src/lib/cms/guard.ts`).
- **scrypt** N = 2^17, r = 8, p = 1 for new hashes (~128 MiB each), legacy hashes verified and
  upgraded at the next successful sign-in, stored parameters bounded before use, at most two
  hashes at a time per instance.
- **Admin Content-Security-Policy**, nonce per request, report-only until validated on
  staging (`docs/admin-csp.md`). Public pages unchanged (no CSP).

Design in `docs/cms-architecture.md` §4, rollout in `docs/staging-runbook.md` §15 (combined
order with 0004 and 0005: §16). After the change `npm audit` is unchanged: **15 findings
(0 critical / 9 high / 6 moderate)**, the same three accepted root causes (`braces`, `esbuild`
via drizzle-kit, `postcss-selector-parser`); `npm audit --omit=dev` reports **0 findings**.
The merge with `staging` (site content, `/admin/email`, gift voucher) added no dependency.
