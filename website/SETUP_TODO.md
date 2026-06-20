# Setup To-Do — Qarakter Webshop (fully custom)

Architecture: **Next.js on Vercel + Neon (Postgres/Drizzle)**. We own the
storefront, cart, orders, admin and content.

**Current phase = design validation on staging.** To move fast we run with
*temporary stand-ins*, with the whole staging site locked behind a login:

- 🔓 **Login:** email only — type an email, you're in (no password, no magic link)
- 💳 **Payments:** "approve all" — checkout marks the order paid, no real charge
- 🛡️ **Whole site gated** behind a username/password (the "firewall")

> ⚠️ These stand-ins are intentionally insecure and exist ONLY because staging is
> behind the gate. Real **Stripe** + **Auth.js magic links** get added once the
> design is validated (see "Phase 2" at the bottom).

---

## ⚠️ How to give me secrets (read first)

- **Local work:** paste into **`website/.env.local`** (gitignored). I read from
  it — **don't paste secrets in chat.**
- **Staging runtime:** enter in the **Vercel dashboard**, Staging environment.

---

## 1. Production database — ✅ done

- [x] Neon project connected, schema applied, 5 sample products seeded.

---

## 2. Staging database  ☐  *(I need this from you)*

- [x] In Neon, use the **`staging` branch** of the project (a copy of prod)
- [x] Paste its **pooled** connection string into `website/.env.local` as:
      `STAGING_DATABASE_URL=`
- [x] Tell me → I migrate + seed the staging branch

---

## 3. The site access gate / "firewall"  ☐  *(I need this from you)*

What I need: **a username and a password you choose** for the gate. Set them as:

```
SITE_GATE_USER=...
SITE_GATE_PASSWORD=...
```

- [x] Add those to `website/.env.local` (so I can test the gate locally), and
- [ ] Add the same two to the **Vercel → Staging** environment (NOT Production —
      prod must stay public). I can generate a strong password if you'd like.

The gate turns on automatically wherever `SITE_GATE_PASSWORD` is set, so:
**Staging = locked, Production = open, Local = open** (unless you add it locally).

---

## 4. Vercel — get staging online  ☐

- [ ] **Upgrade to Pro** (~€20/mo — required for commercial + custom environments)
- [x] Repo imported, Root Directory = `website`, Production branch = `main`
- [ ] Add a **custom environment** `Staging` tracking the `staging` branch
- [ ] Set Staging env vars: the `STAGING_DATABASE_URL` value as `DATABASE_URL`,
      `SITE_GATE_USER`, `SITE_GATE_PASSWORD`, `NEXT_PUBLIC_APP_URL` (the staging URL)

---

## What I'll build now (no account needed from you)

- The **access gate** (middleware) — staging locked behind your username/password
- **Email-only login** (temporary) — replaces Clerk for now
- **Approve-all checkout** (temporary) — creates a paid order without Stripe
- Then: the **admin panel** (manage products/orders) + the rest of the storefront

I can start the moment you give me the **staging DB** + **gate username/password**
(or just say "use a generated password" and I'll make one).

---

## Phase 2 — before real launch (later, once design is validated)

- [ ] **Stripe** — real checkout (test + live keys, webhook) → replaces approve-all
- [ ] **Auth.js + email magic links** (via Resend) → replaces email-only login
- [ ] VAT calculation + invoices, GDPR tools (cookie consent, data export/delete)
- [ ] Remove the staging gate from production (prod goes public)

(`AUTH_SECRET` is already generated in `.env.local` for when we add Auth.js.)
