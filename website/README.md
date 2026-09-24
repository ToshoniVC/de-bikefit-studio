# De Bikefit Studio — website

The Next.js app behind De Bikefit Studio: the public Dutch studio site, a custom CMS at
`/admin`, online booking with Google Calendar sync and e-mail, and GA4 behind a consent
banner. The Qarakter webshop (`/shop`, `/checkout`, `/account`, Clerk, Stripe) is a
legacy part: it still builds and runs, but is not being developed further.

Conventions for anyone changing this code (checks, architecture rules, security, git) are in
[`../CLAUDE.md`](../CLAUDE.md). Read it first.

## Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, React Server Components), React 19, strict TypeScript |
| Styling | Tailwind CSS v4 + design-system tokens (`--ds-*`); shadcn/ui (Base UI) in the admin |
| Database | Drizzle ORM. Neon (neon-http) when `DATABASE_URL` is set, embedded PGlite in `website/.pglite/` otherwise |
| CMS auth | Own sessions + scrypt passwords, roles `admin` / `editor` / `provider` (not Clerk) |
| Integrations | Google Calendar (OAuth, per provider), GA4 tag + GA4 Data API, Resend (e-mail) |
| Tests | vitest (unit), `cms:selftest` (integration on PGlite) |
| Hosting | Vercel (Root Directory `website`), Neon Postgres |

Next.js 16 differs from older docs: read [`AGENTS.md`](AGENTS.md) and the guides in
`node_modules/next/dist/docs/` before using an API you are unsure of.

## Project layout

```
website/
├── src/
│   ├── app/
│   │   ├── (studio)/        public site: home, CMS catch-all [...slug], /afspraak/bevestigd,
│   │   │                    /afspraak/annuleren/[token], /og
│   │   ├── admin/           CMS: /admin/login, /admin/password, (dashboard)/… (pages, media,
│   │   │                    bookings, agenda, services, locations, providers, settings, users, audit)
│   │   ├── api/             cms/media/[id], google/oauth/{start,callback}, checkout, webhooks/*
│   │   ├── (shop)/ (webshop)/ (content)/ (auth)/   legacy webshop
│   │   └── layout.tsx, sitemap.ts, robots.ts, not-found.tsx
│   ├── components/          studio/ (public site, blocks, booking widget, consent banner),
│   │                        admin/, ui/ (shadcn), shop/, layout/, shell/ (webshop)
│   ├── db/                  cms-schema.ts + cms.ts (CMS + booking), schema.ts + index.ts (webshop)
│   ├── lib/
│   │   ├── cms/             auth, sessions, permissions, block registry, content (read), repo (write),
│   │   │                    actions/ (server actions, sanitiser)
│   │   ├── booking/         availability engine, time zones, repo, public booking, Google Calendar
│   │   ├── email/           Resend client, ICS builder, Dutch templates
│   │   ├── analytics/       consent cookie, GA4 tag, GA4 Data API
│   │   ├── studio/          locale, SEO, JSON-LD, OG images, legal identity
│   │   └── env.ts           zod-validated env vars + `features` flags
│   └── middleware.ts        Clerk pass-through + /admin cookie redirect (no database)
├── drizzle/                 SQL migrations 0000–0003 + meta snapshots
├── scripts/                 migrate, bootstrap, seeds, self-test, retention, staging reset/anonymise
└── docs/                    architecture and runbooks (below)
```

## Setup

Requires **Node ≥ 22.15** (the seed and self-test scripts use `module.registerHooks()`).

```bash
cd website
npm ci
cp .env.example .env.local        # optional: local dev needs no variables at all
npm run db:migrate                # creates website/.pglite/ (PGlite)
CMS_BOOTSTRAP_PASSWORD='<strong password>' npm run cms:bootstrap
npm run cms:seed                  # Dutch pages, menus, redirect; published
npm run cms:seed-booking          # first provider; prints its temporary password once
npm run dev                       # http://localhost:3000, admin at /admin/login
```

PowerShell has no inline env prefix: `$env:CMS_BOOTSTRAP_PASSWORD='…'; npm run cms:bootstrap;
Remove-Item Env:CMS_BOOTSTRAP_PASSWORD`. Never store that password in `.env.local` or Vercel.

Sign in as `contact@toshoni.be` with the bootstrap password; the first login forces a new one.
Reset the local database by deleting `website/.pglite/` and repeating the commands.

With no variables set: the CMS and booking run on PGlite, availability uses business hours
and existing bookings only (no Google), booking e-mails are logged and skipped, no analytics
script or banner loads, and the webshop serves sample products. Each integration switches on
when its variables are present; the full list is in [`DEPLOYMENT.md`](DEPLOYMENT.md) §5.

## Scripts

Run inside `website/`. Scripts that touch a database use PGlite unless `DATABASE_URL` is set.

| Script | What it does |
| --- | --- |
| `npm run dev` | Next dev server on PGlite |
| `npm run build` | Production build; must succeed without any env vars |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint (next/core-web-vitals + TypeScript) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run format` | Prettier, write fixes |
| `npm run format:check` | Prettier, check only (CI) |
| `npm test` | vitest unit tests, once |
| `npm run test:watch` | vitest in watch mode |
| `npm run db:generate -- --name=<snake_name>` | New migration in `drizzle/` from the Drizzle schema |
| `npm run db:migrate` | Apply pending migrations (PGlite, or Neon when `DATABASE_URL` is set) |
| `npm run db:push` | Push the schema without a migration: throwaway local database only, **never Neon** |
| `npm run db:studio` | Drizzle Studio |
| `npm run cms:bootstrap` | Idempotent: first admin, site settings, menus, locations, services (`CMS_BOOTSTRAP_PASSWORD` inline) |
| `npm run cms:seed` | Idempotent Dutch content, published. `-- --only-missing` leaves existing pages/menus alone; `-- --refresh-slug <slug>` re-seeds and republishes one page |
| `npm run cms:seed-booking` | Idempotent first provider, hours and service subscriptions (`PROVIDER_EMAIL` / `PROVIDER_NAME` for another) |
| `npm run cms:selftest` | Integration checks on a throwaway PGlite in `.pglite-selftest/` |
| `npm run cms:retention` | GDPR retention purge, dry run; `-- --apply` deletes, `-- --json` for a report |

## Testing

Three layers, all in CI ([`../CLAUDE.md`](../CLAUDE.md) §5):

1. **Unit** — `npm test`. vitest, `*.test.ts` next to the module. Pure modules only: no
   database, no network, no Next runtime. Every bug fix starts with a failing test.
2. **Integration** — `npm run cms:selftest`. Migrations, schema, passwords, sessions,
   permissions, block registry, publish, the booking schema, the provider role,
   `computeSlots()`, e-mail/ICS/token encryption and the full booking flow, on a throwaway
   PGlite. Section list in the header of `scripts/cms-selftest.mts`.
3. **Smoke** — after every preview and staging deployment the DevOps agent (Arend) runs
   `site-health` (status codes, `robots.txt`, `noindex`, key paths).

## Definition of done

`typecheck`, `lint`, `format:check`, `test`, `cms:selftest` and `build` all exit 0, the
relevant doc is updated, and the change is on a feature branch. CI
(`.github/workflows/ci.yml`) runs the same six steps on every push and pull request; a red CI
is never merged. Branch flow: `feat/<topic>` → `staging` → `main`.

## Documentation

| Doc | Covers |
| --- | --- |
| [`../CLAUDE.md`](../CLAUDE.md) | Engineering conventions, checks, security rules, git flow |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Environments, who deploys, Neon/Vercel setup, env var contract, GDPR caveats |
| [`docs/cms-architecture.md`](docs/cms-architecture.md) | CMS data model, auth, roles and permissions, blocks, caching, public site |
| [`docs/booking-architecture.md`](docs/booking-architecture.md) | Booking schema, availability, Google Calendar, e-mail |
| [`docs/staging-runbook.md`](docs/staging-runbook.md) | Staging deploy procedure, rollback, production checklist |
| [`docs/booking-runbook.md`](docs/booking-runbook.md) | Google Cloud, GA4, Resend setup; GDPR and retention (§11) |
| [`AGENTS.md`](AGENTS.md) | Next.js 16 warning for agents |
| `../prototype/design-system/` | Design-system source (`tokens.css`, `DESIGN-SYSTEM.md`) |
