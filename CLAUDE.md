# De Bikefit Studio — engineering conventions

This file is the contract for anyone (human or agent) changing this repository. It says how
the code is organised, which checks must pass, and which practices are not negotiable.
Longer explanations live in the docs it points to; do not duplicate them here.

## 1. What is in this repo

| Path | What it is | Deployed? |
|---|---|---|
| `website/` | The product: a Next.js 16 / React 19 / TypeScript app with a custom CMS (`/admin`), the public studio site, the booking flow and a legacy webshop. Vercel Root Directory = `website`. | Yes (Vercel + Neon) |
| `prototype/` | Static HTML prototype and the design-system source (`design-system/tokens.css`, `DESIGN-SYSTEM.md`). Reference only. | GitHub Pages hub |
| `brand/`, `content/` | Brand book and Dutch copy drafts. Reference only. | GitHub Pages hub |
| `index.html`, `logo.svg` | The project hub page. | GitHub Pages |

Read before changing the app: `website/README.md` (setup and scripts), `website/DEPLOYMENT.md`
(environments, env var contract), `website/docs/cms-architecture.md` (CMS data model, auth,
blocks, caching), `website/docs/booking-architecture.md` (booking, availability, Google
Calendar, e-mail), `website/docs/staging-runbook.md` and `website/docs/booking-runbook.md`
(operations). Next.js 16 differs from older training data: read `website/AGENTS.md` and the
guides under `website/node_modules/next/dist/docs/` before using a Next API you are unsure of.

## 2. Commands (run inside `website/`)

```bash
npm ci                      # install exactly what the lockfile says
npm run dev                 # local dev on PGlite (no DATABASE_URL needed)
npm run typecheck           # tsc --noEmit
npm run lint                # eslint (next/core-web-vitals + typescript)
npm run format:check        # prettier; `npm run format` to fix
npm test                    # vitest unit tests (pure modules)
npm run cms:selftest        # integration checks on a throwaway PGlite database
npm run build               # production build; must succeed without any env vars
npm run db:generate -- --name=<snake_name>   # new migration from the Drizzle schema
npm run db:migrate          # apply migrations (PGlite locally, Neon when DATABASE_URL is set)
npm run cms:bootstrap       # idempotent first admin, settings, menus, locations, services
npm run cms:seed            # idempotent Dutch content; `-- --refresh-slug <slug>` re-seeds one page
npm run cms:seed-booking    # idempotent first provider
npm run cms:retention       # GDPR purge, dry-run; `-- --apply` to execute
```

**Definition of done for any change:** `typecheck`, `lint`, `format:check`, `test`,
`cms:selftest` and `build` all exit 0, the relevant doc is updated, and the change is on a
feature branch. CI runs the same six steps; a red CI is never merged.

## 3. Architecture rules

- **Layers:** page/route → server action (`src/lib/**/actions/*.ts`, `'use server'`) → repo
  (`src/lib/*/repo.ts`) → Drizzle. Pages and actions never call `getCmsDb()` directly.
  Read paths go through the cached readers in `src/lib/cms/content.ts` and
  `src/lib/booking/content.ts`; writes invalidate through `revalidateContent({ tags })`.
- **Server by default.** Components are React Server Components unless they need state,
  effects or browser APIs; then a small `'use client'` leaf. Server-only modules import
  `server-only` at the top. Use `force-dynamic` only when the page must read the database or
  cookies on every request, and say why in a comment.
- **Env vars** are read only through `src/lib/env.ts` (zod-validated) and its `features`
  flags. No `process.env.X` elsewhere in `src/`. Every variable is listed in `.env.example`
  with a one-line comment; missing optional integrations degrade gracefully (feature off), they
  never crash a page.
- **Validation at every boundary:** zod schemas for form data, JSON bodies, query strings and
  third-party responses. The schema lives next to the repo function that consumes it.
- **Database:** schema in `src/db/*.ts`; every schema change ships as a named Drizzle
  migration in `drizzle/` generated with `db:generate`, guarded so it can run twice, and
  applied with `db:migrate`. `db:push` is for a throwaway local database only, never for
  Neon. Seeds and bootstrap scripts are idempotent. Money is stored in cents, times in UTC
  (`timestamptz`), and shown in `Europe/Brussels`.
- **Design system:** all colours, type, radius and spacing come from the `--ds-*` /
  `--color-ds-*` tokens in `src/app/globals.css` (source of truth:
  `prototype/design-system/tokens.css`). No ad-hoc hex values or Tailwind palette colours in
  components. The admin re-maps the shadcn variables inside `.admin-root`; it never forks the
  palette.
- **Language:** all user-facing copy is Dutch (Belgium), informal "je", in the CMS where the
  visitor can edit it, in code only as sensible defaults. Error messages shown to visitors
  are short, Dutch and never leak internals.
- **File size:** keep modules under ~500 lines. When you touch a file that is over that,
  split the part you are working on rather than adding to it.
- **No duplicate helpers.** Shared ones: `escapeHtml` (`src/lib/html.ts`), client IP
  (`src/lib/request-ip.ts`), dev pepper / derived secrets (`src/lib/secrets.ts`), price
  formatting (`src/lib/booking/format.ts`), time zone checks (`src/lib/booking/time.ts`).
  Search before you write a new one.

## 4. Security and privacy (not negotiable)

- Secrets never enter the repo, chat logs, screenshots or docs. `.env*` stays ignored;
  1Password is the source of truth; Vercel and the OpenClaw secret store hold runtime copies.
- Never weaken a security control to make a check pass (auth, Origin checks, cookie flags,
  headers, rate limits, sanitisation). If a control blocks legitimate work, say so and stop.
- All HTML that reaches `dangerouslySetInnerHTML` is either generated from trusted code
  (JSON-LD, gtag) or passed through the rich-text sanitiser in
  `src/lib/cms/actions/sanitize.ts` on the write path, seeds included. Allowlist only.
- Server actions rely on Next's Origin/Host check; API routes that mutate state verify a
  signature (webhooks) or an HMAC-signed state cookie (OAuth). Add the same to anything new.
- Cookies: `httpOnly`, `sameSite: 'lax'`, `secure` outside development, shortest sensible
  lifetime. Tokens stored in the database are hashed or encrypted, never plain.
- Rate limit every unauthenticated write (login, booking, contact) with the database-backed
  pattern already in use; key on IP and on the identifying field.
- Passwords: scrypt via `src/lib/cms/password.ts`; no other hashing anywhere.
- Logging: prefixed `console.error('[area] …')` on the server, never PII, tokens or full
  request bodies. No `console.log` left in committed code.
- GDPR: no non-essential script or cookie before consent (the banner in
  `src/components/studio/consent-banner.tsx`); privacy and terms pages linked from every page
  and every form; data minimisation on forms; retention enforced by `cms:retention`; staging
  data anonymised by `scripts/anonymize-staging.sql` before anyone else sees it.

## 5. Testing

Three layers, all in CI:

1. **Unit tests (vitest, `*.test.ts` next to the module).** Required for every pure module in
   `src/lib/**` (availability maths, time zones, parsing, sanitising, formatting, permission
   matrix, token helpers) and for every bug fix (a failing test first). No database, no
   network, no Next runtime: if a module needs those, extract the pure part and test that.
2. **Integration (`scripts/cms-selftest.mts`).** Runs migrations, bootstrap, auth, publish
   and the full booking flow on a throwaway PGlite. Add a section when you add a flow that
   crosses the repo layer. Keep it deterministic and under a minute.
3. **Smoke on a deployment.** The DevOps agent runs `site-health` against every preview and
   staging deployment (status, robots, noindex, key paths). A feature is "done" when it
   passes there too.

Component and e2e browser tests are welcome but not required; do not add a browser runner
without agreeing where it runs.

## 6. Accessibility, SEO, performance

- Semantic HTML first; every input has a label; dialogs trap and return focus; a skip link in
  every shell; images through `StudioImage`/`next/image` with real `alt` or `decorative`.
- `generateMetadata` on every public page, `robots: noindex` on admin, confirmation and
  token pages; the sitemap lists only published, indexable pages.
- Fonts via `next/font`; no layout shift from late-loading assets; no client-side data
  fetching where a server component can render it; cache tags instead of `force-dynamic`
  when the data changes rarely.

## 7. Git and delivery

- Branches: `feat/<topic>` → `staging` → `main`. Never commit directly on `main` or `staging`.
- Commits: Conventional Commits (`feat(scope): …`, `fix(scope): …`, `docs: …`, `chore: …`),
  small and self-contained, `-s`-free, no force-push, no history rewriting on shared branches.
- Pull requests use the template in `.github/`; CI must be green; the PR description says
  what to click on the preview to verify.
- Deployments are done by the DevOps agent (Arend) following `website/docs/staging-runbook.md`:
  previews and staging are automatic after the release gate; production, production database
  changes and DNS need an explicit go from Toshoni.
- Line endings are LF (`.gitattributes`); shell scripts must stay LF or they break under WSL.

## 8. Docs are part of the change

When behaviour changes, update the doc that describes it in the same branch: README for
setup and scripts, `DEPLOYMENT.md` for env vars, `docs/cms-architecture.md` for the CMS,
`docs/booking-architecture.md` for booking, the runbooks for operations. A doc that says
"out of scope" about something that now exists is a bug.

## 9. Working as an agent in this repo

- Before editing, run the checks in §2 to know the baseline; after editing, run them again and
  report exit codes, not impressions.
- Respect file ownership when several agents work in parallel (the work-block file names the
  owner); make additive edits to shared files and re-read before editing.
- Do not run `git` commands, deploy, or touch env vars unless the task explicitly assigns it.
- Never delete data, branches or files you did not create in the same task without saying so
  first.
- Report deviations from this file explicitly; do not quietly work around a rule.
