# Qarakter — Bike Webshop

A serverless, edge-friendly e-commerce site for the Qarakter boutique bike store:
shop + cart + checkout, Clerk auth, and an MDX-driven content/blog engine.

## Stack

| Concern   | Choice                                                        |
| --------- | ------------------------------------------------------------ |
| Framework | **Next.js 16** (App Router, RSC-first, strict TypeScript)    |
| Styling   | **Tailwind CSS v4** + **shadcn/ui** (Base UI, `base-nova`)   |
| Database  | **Neon** serverless Postgres via **Drizzle ORM** (neon-http) |
| Auth      | **Clerk** (`@clerk/nextjs`)                                  |
| Payments  | **Stripe** (cards) + **Mollie** (Bancontact / iDEAL)        |
| Content   | **MDX** via `next-mdx-remote` (RSC)                          |
| Deploy    | **Vercel**                                                   |

> **Deviations from the original spec:** it called for Next.js 15 and Tailwind v3
> with a `tailwind.config.ts`. The current toolchain ships **Next 16** and
> **Tailwind v4** (CSS-based config in `globals.css`, no JS config file). The
> architecture (RSC, neon-http, route groups) is unchanged. shadcn's current
> default style (`base-nova`) is built on **Base UI**, so components use a
> `render={<El />}` prop instead of Radix's `asChild`.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in as you wire up each service
npm run dev
```

The app **runs with no environment variables**. Without them it:

- serves the catalog from `src/lib/sample-products.ts` (no DB needed),
- hides auth UI and makes `middleware.ts` a pass-through,
- returns `501` from checkout / webhook endpoints.

Add credentials to `.env.local` to switch each integration on — see `.env.example`.

## Database

```bash
npm run db:generate   # generate SQL migrations from src/db/schema.ts
npm run db:push       # push the schema to Neon (needs DATABASE_URL)
npm run db:studio     # browse data in Drizzle Studio
```

Schema lives in [`src/db/schema.ts`](src/db/schema.ts); read access goes through
[`src/db/queries.ts`](src/db/queries.ts), which falls back to sample data when
`DATABASE_URL` is unset.

## Project layout

```
src/
├── app/
│   ├── (auth)/          # Clerk sign-in / sign-up (catch-all routes)
│   ├── (shop)/          # shop listing, product pages, checkout
│   ├── (content)/       # blog (MDX), about, policies
│   ├── account/         # protected account page
│   ├── api/             # checkout + Clerk/Stripe webhooks
│   ├── layout.tsx       # root layout (conditional ClerkProvider, brand fonts)
│   └── page.tsx         # landing page
├── components/
│   ├── ui/              # shadcn/ui (Base UI) primitives
│   ├── shop/            # ProductCard, CartSheet, AddToCartButton
│   └── layout/          # Header, Footer, MobileNav, HeaderAuth
├── db/                  # Drizzle schema, neon-http client, queries
├── content/blog/        # .mdx blog posts
└── lib/                 # env (zod), stripe, mollie, cart store, mdx, format
```

## Webhooks

- **Clerk → Neon** user sync: `POST /api/webhooks/clerk` (set `CLERK_WEBHOOK_SECRET`).
- **Stripe → Neon** order status: `POST /api/webhooks/stripe` (set `STRIPE_WEBHOOK_SECRET`).

## Status

Phase 1 (foundation + schema + styling) is complete and runnable. Phases 2–4
(auth, payments, content) are scaffolded with working code paths that activate
once their credentials are present.
