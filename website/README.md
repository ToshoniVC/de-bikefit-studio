# Qarakter — Bike Webshop (Shopify headless)

A custom Next.js website for the Qarakter boutique bike store, with **Shopify
headless** powering commerce. Your site is the whole experience — homepage,
content, blog, brand — and Shopify handles products, cart, checkout, payments,
tax and orders.

## Stack

| Concern        | Choice                                                       |
| -------------- | ----------------------------------------------------------- |
| Framework      | **Next.js 16** (App Router, RSC-first, strict TypeScript)   |
| Styling        | **Tailwind CSS v4** + **shadcn/ui** (Base UI, `base-nova`)  |
| Commerce       | **Shopify** via the **Storefront API** (headless)           |
| Checkout       | **Shopify Checkout** (hosted — PCI, tax, shipping, payments)|
| Content / blog | **MDX** (`next-mdx-remote`); optional Shopify metaobjects   |
| Deploy         | **Vercel** (Pro — required for commercial use)              |

What Shopify owns: products, inventory, cart, checkout, payments (cards +
Bancontact/iDEAL), tax, shipping, orders, the admin UI. What this repo owns:
the entire storefront UI, brand, content and routing.

## Getting started

```bash
npm install
cp .env.example .env.local   # add Shopify creds when ready
npm run dev
```

The site **runs with no environment variables**, serving the catalog from
`src/lib/sample-products.ts` so you can build the UI before the store exists.
Add Shopify creds to `.env.local` to switch to live data; checkout returns `501`
until then.

## Connecting Shopify

1. Create the store, then a **custom app** (Settings → Apps → Develop apps).
2. Enable **Storefront API** access → copy the public access token.
3. Put it in `.env.local`:
   ```
   SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
   SHOPIFY_STOREFRONT_API_TOKEN=...
   ```
4. (To bulk-load products) enable **Admin API** `write_products`, copy that
   token to `SHOPIFY_ADMIN_API_TOKEN`, edit `products.csv`, then:
   ```bash
   npm run shopify:sync            # dry run
   npm run shopify:sync -- --commit  # write to Shopify
   ```

## Project layout

```
src/
├── app/
│   ├── (shop)/          # shop listing, product pages, checkout
│   ├── (content)/       # blog (MDX), about, policies
│   ├── api/checkout/    # creates a Shopify cart, returns hosted checkout URL
│   ├── layout.tsx       # root layout (brand fonts, header/footer)
│   └── page.tsx         # landing page
├── components/
│   ├── ui/              # shadcn/ui (Base UI) primitives
│   ├── shop/            # ProductCard, CartSheet, AddToCartButton
│   └── layout/          # Header, Footer, MobileNav
├── content/blog/        # .mdx blog posts
└── lib/                 # shopify (Storefront client), cart store, types, mdx
products.csv             # catalog source of truth for shopify:sync
scripts/shopify-sync.mts # pushes products.csv → Shopify Admin API
```

## Notes

- **Next 16 / Tailwind v4** (CSS config in `globals.css`, no `tailwind.config.ts`).
  shadcn's `base-nova` style uses **Base UI** → components take `render={<El/>}`,
  not Radix `asChild`.
- No database, no custom auth, no custom payment integration — Shopify owns all
  of that. Customer accounts can be added later via Shopify customer accounts.
