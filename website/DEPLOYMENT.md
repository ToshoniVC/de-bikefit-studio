# Deployment — Staging & Production (Shopify headless)

Two environments off one repo and **one** Vercel project. Commerce lives in
Shopify; the frontend deploys on Vercel.

| Layer            | Production                | Staging                                |
| ---------------- | ------------------------- | -------------------------------------- |
| Git branch       | `main`                    | `staging`                              |
| Vercel           | Production deployment      | `Staging` custom environment          |
| Shopify          | your live store           | a free **development store**           |
| `NEXT_PUBLIC_APP_URL` | https://qarakter…    | https://staging.qarakter… (Vercel URL) |

Push to `main` → production deploy. Push to `staging` → staging deploy.

> ⚠️ **Vercel Hobby is non-commercial only.** A live shop must run on **Vercel
> Pro** (~€20/mo).

---

## 1. Shopify (two stores)

Use a **separate Shopify development store for staging** so test orders never
touch your live store. Both stores get their own custom app + tokens.

- **Production:** your live Shopify store + a custom app (Storefront API token).
- **Staging:** a free Shopify dev store + its own custom app + token. Dev stores
  run in test mode, so checkout never charges real money.

`products.csv` is the catalog source of truth. To keep a store in sync (and to
make staging "a copy of production"), point the sync script at each store and run:

```bash
# against whichever store's tokens are in .env.local
npm run shopify:sync -- --commit
```

---

## 2. Vercel (one project, two environments)

1. Import the GitHub repo into a Vercel project (Pro plan).
2. **Root Directory** → `website` (monorepo subfolder).
3. Production branch → `main`.
4. Add a **custom environment** named **`Staging`**, tracking the `staging` branch.
5. Set environment variables **per environment**:
   - `SHOPIFY_STORE_DOMAIN` → live store (Production) / dev store (Staging)
   - `SHOPIFY_STOREFRONT_API_TOKEN` → matching store's token
   - `NEXT_PUBLIC_APP_URL` → each environment's own URL
   - `SHOPIFY_ADMIN_API_TOKEN` is **not** needed at runtime (sync script only)

---

## 3. Going live checklist

- [ ] Vercel upgraded to **Pro**
- [ ] Live Shopify store: payments activated (cards + Bancontact/iDEAL), tax &
      shipping configured, legal/policy pages set
- [ ] Products loaded (`npm run shopify:sync -- --commit`)
- [ ] Production env vars point to the **live** store; Staging to the **dev** store
- [ ] Custom domain attached in Vercel
