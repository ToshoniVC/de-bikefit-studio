# Deployment — Staging & Production

Two environments off one repo and **one** Vercel project. Only **data** is ever
copied from production to staging; secrets are always per-environment.

| Layer            | Production            | Staging                                  |
| ---------------- | --------------------- | ---------------------------------------- |
| Git branch       | `main`                | `staging`                                |
| Vercel           | Production deployment  | `Staging` custom environment            |
| Neon             | primary branch        | `staging` branch (resettable from prod)  |
| Clerk            | Production instance   | Development instance                     |
| Stripe / Mollie  | Live keys             | Test keys                                |
| `NEXT_PUBLIC_APP_URL` | https://qarakter… | https://staging.qarakter… (Vercel URL)  |

Push to `main` → production deploy. Push to `staging` → staging deploy.

---

## 1. Neon (database branching)

The whole reason "staging is periodically a copy of production" is cheap:

1. Create one Neon **project**. Its default/primary branch is **production**.
2. Create a branch named **`staging`** off production (copy-on-write, instant).
3. Each branch has its own pooled connection string → that's the per-environment
   `DATABASE_URL`.

Apply the schema to **both** branches once:

```bash
# production
DATABASE_URL="<prod pooled url>" npm run db:push
# staging
DATABASE_URL="<staging pooled url>" npm run db:push
```

To refresh staging from production later, see [§4](#4-refresh-staging-from-production).

---

## 2. Vercel (one project, two environments)

1. Import the GitHub repo into a new Vercel project.
2. **Root Directory** → `website` (this is a monorepo; the app is in a subfolder).
3. Production branch → `main`.
4. Add a **custom environment** named `Staging`, tracking the `staging` branch.
5. Set environment variables **per environment** (Production vs Staging) — see
   `.env.example` for the full list. The values that differ:
   - `DATABASE_URL` → the matching Neon branch URL
   - Clerk keys → Production vs Development instance
   - Stripe / Mollie keys → Live vs Test
   - `NEXT_PUBLIC_APP_URL` → each environment's own URL

---

## 3. Per-service test vs live

- **Clerk:** use a **Development** instance for staging and a **Production**
  instance for prod. Configure each instance's webhook to the matching
  `/api/webhooks/clerk` URL, and put its signing secret in that environment.
- **Stripe:** use **test mode** keys + a test webhook (`stripe listen` locally,
  a test endpoint for staging) and **live** keys only in production.
- **Mollie:** use a **test** API key for staging, live for production.

> Because staging always runs in these test/dev modes, refreshing its database
> from production never causes real emails or charges to fire.

---

## 4. Refresh staging from production

Reset the staging Neon branch so it mirrors production again:

```bash
./scripts/reset-staging.sh
```

This resets the `staging` branch from its parent (production) and then runs
`scripts/anonymize-staging.sql` to scrub customer PII (see §5). Requires the
Neon CLI (`neonctl`) authenticated, and `NEON_PROJECT_ID` set.

---

## 5. GDPR / PII caveats (important)

A prod→staging copy brings **real customer data** (emails, names, shipping
addresses) into a lower-trust environment. Two mitigations, both applied by the
refresh script:

1. **Anonymize on refresh** — `scripts/anonymize-staging.sql` masks emails,
   names and addresses in the staging copy.
2. **Test/dev modes everywhere** — staging's Clerk/Stripe/Mollie are non-live,
   so copied rows can't trigger real-world side effects.

Also note: the DB stores **Clerk user IDs** and **Stripe session IDs** that
reference production's Clerk/Stripe. After a copy these point at prod systems, so
test *new* auth/checkout flows in staging rather than replaying copied rows.
