## What and why

<!-- What changes, and why. Link the issue or work block if there is one. -->

## How to verify on the preview

<!-- The exact pages to open and what to click, e.g. "/afspraak → kies Jeugdfit → ...". -->

1.

## Definition of done (CLAUDE.md §2)

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm run format:check` exits 0
- [ ] `npm test` exits 0 (new pure logic and every bug fix have a unit test)
- [ ] `npm run cms:selftest` exits 0
- [ ] `npm run build` exits 0 without any env vars
- [ ] The change is on a feature branch (`feat/<topic>` → `staging` → `main`)

## Docs updated?

- [ ] Not needed: no behaviour, setup, env var or operations change
- [ ] Updated: <!-- README / DEPLOYMENT.md / docs/cms-architecture.md / docs/booking-architecture.md / runbooks -->
