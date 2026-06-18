# Setup To-Do — Qarakter Webshop (Shopify headless)

Your checklist to get staging + production live. Architecture: **Next.js on
Vercel + Shopify headless** (Shopify owns products, checkout, payments, tax,
shipping, orders).

---

## ⚠️ How to give me secrets (read first)

- **For anything I run locally** (product sync, dev): paste values into
  **`website/.env.local`** (gitignored, never committed). I read from it —
  **don't paste secrets into chat.**
- **For staging/production runtime:** enter values in the **Vercel dashboard**,
  per environment. I don't need those copies.

---

## 1. Shopify — store + custom app  ☐

- [ ] Create your Shopify store (this becomes **production**)
- [ ] Create a free **development store** (this becomes **staging**)
- [ ] In **each** store: Settings → Apps → **Develop apps** → create an app
- [ ] Enable **Storefront API** access → copy the **public access token**
- [ ] Enable **Admin API** with `write_products` → copy the **Admin API token**
- [ ] Paste the **production** store's values into `website/.env.local`:
  - `SHOPIFY_STORE_DOMAIN=your-store.myshopify.com`
  - `SHOPIFY_STOREFRONT_API_TOKEN=…`
  - `SHOPIFY_ADMIN_API_TOKEN=…` (for the product sync)
- [ ] Then tell me — I'll load products from `products.csv` into the store

**Still manual in Shopify admin (needs your identity/decisions):** payment
activation (cards + Bancontact/iDEAL), tax/VAT, shipping rates, legal pages.

---

## 2. Vercel — hosting  ☐

- [ ] **Upgrade to Pro** (~€20/mo — required; Hobby is non-commercial only)
- [x] Import the GitHub repo
- [x] Root Directory = `website`
- [x] Production branch = `main`
- [ ] Add a **custom environment** named **`Staging`** tracking the `staging` branch
- [ ] Set env vars **per environment** (see cheat sheet) — Production → live store,
      Staging → dev store

---

## 3. App URL  ☐

- [ ] Set `NEXT_PUBLIC_APP_URL` per environment (prod domain / staging URL).
      Local is already `http://localhost:3000` in `.env.local`.

---

## Env var → environment cheat sheet

| Variable                        | Production       | Staging         | Need locally?      |
| ------------------------------- | ---------------- | --------------- | ------------------ |
| `SHOPIFY_STORE_DOMAIN`          | live store       | dev store       | ✅ (to sync/preview) |
| `SHOPIFY_STOREFRONT_API_TOKEN`  | live store token | dev store token | ✅                  |
| `SHOPIFY_ADMIN_API_TOKEN`       | — (sync only)    | — (sync only)   | ✅ (to sync)        |
| `NEXT_PUBLIC_APP_URL`           | prod domain      | staging URL     | ✅ (set)            |

> `SHOPIFY_ADMIN_API_TOKEN` is **never** used at runtime or in Vercel — only by
> `scripts/shopify-sync.mts` locally.

---

## What I'll do once you've filled things in

- **Shopify creds in `.env.local`** → I verify the connection, run
  `npm run shopify:sync -- --commit` to load `products.csv`, and confirm the
  storefront reads live data.
- **Vercel Staging env added** → I help verify per-environment config.
- Then: wire up Shopify metaobjects/MDX for the broader site content.

> Tell me when Shopify is ready (or just "Shopify's connected") and I'll pick up.
