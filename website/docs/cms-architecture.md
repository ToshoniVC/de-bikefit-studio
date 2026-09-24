# CMS architecture — De Bikefit Studio

Contract document for the Dutch public site + admin built inside the existing
Next.js 16 app. Originally written by Worker A (foundation) for Workers B
(admin UI) and C (public site + SEO + seed); kept current since. Online
booking, Google Calendar and e-mail are documented separately in
[`booking-architecture.md`](./booking-architecture.md); the rules here apply
to them too. Repository-wide conventions: [`../../CLAUDE.md`](../../CLAUDE.md).

**Status:** implemented — schema and migrations, dual-driver DB client,
auth/roles/sessions, block registry, read and write APIs, the admin UI at
`/admin`, the public Dutch site, booking, the consent-gated GA4 tag and the
admin analytics panel. Rollout per environment: `staging-runbook.md`.

**Hard rule that never changes:** the Qarakter webshop (`users`, `products`,
`orders`, `order_items`, `/shop`, `/checkout`, `/account`, Clerk, Stripe)
stays exactly as it is. Every CMS table is prefixed `cms_`, every CMS
migration is additive, and the CMS has its own auth that shares nothing with
Clerk.

---

## 1. Layout

File ownership during parallel work comes from the work-block file (see
`CLAUDE.md` §9), not from this document.

| Area | Paths |
| --- | --- |
| Data | `src/db/cms-schema.ts` (all `cms_*` tables, CMS + booking), `src/db/cms.ts` (driver), `drizzle/**`, `drizzle.config.ts` |
| CMS core | `src/lib/cms/{auth,session,password,permissions,blocks,content,repo,repo-admin}.ts` |
| Admin | `src/app/admin/**`, `src/components/admin/**`, `src/lib/cms/actions/**` (server actions + `sanitize.ts`), `src/app/api/cms/media/**` |
| Public site | `src/app/(studio)/**`, `src/components/studio/**`, `src/lib/studio/**`, `src/app/sitemap.ts`, `src/app/robots.ts` |
| Booking | `src/lib/booking/**`, `src/lib/email/**`, `src/app/api/google/oauth/**` — see `booking-architecture.md` |
| Analytics | `src/lib/analytics/{consent,ga4-tag,ga4}.ts(x)`, `src/components/studio/{analytics,consent-banner}.tsx`, `src/components/admin/analytics-panel.tsx` |
| Scripts | `scripts/{db-migrate,cms-bootstrap,cms-seed,cms-seed-booking,cms-selftest,cms-retention}.mts` |
| Shared | `src/middleware.ts`, `src/lib/env.ts`, `.env.example`, `next.config.ts`, `package.json`, `src/app/layout.tsx` |

---

## 2. Database

### Drivers

`src/db/cms.ts` exposes one function:

```ts
import { getCmsDb, cmsDriver, type CmsDatabase } from '@/db/cms';

const db = await getCmsDb(); // Drizzle instance
cmsDriver();                 // 'neon-http' | 'pglite'
```

| Condition | Driver | Notes |
| --- | --- | --- |
| `DATABASE_URL` set | `neon-http` | Same driver the webshop uses. Staging/production. |
| `DATABASE_URL` unset, not production | `pglite` | Postgres/WASM persisted in `website/.pglite/` (gitignored). Auto-migrates on first use. |
| `DATABASE_URL` unset, production | throws | Production must have a real database. |

`getCmsDb()` is async because PGlite is loaded with a runtime `import()`.
`@electric-sql/pglite` is listed in `next.config.ts` `serverExternalPackages`,
which is what keeps the WASM out of every client/edge bundle.

**Never call `getCmsDb()` from middleware** — middleware runs on the edge
runtime. **Never call it from a client component.**

The webshop's own client (`src/db/index.ts`) and its sample-data fallback in
`src/db/queries.ts` are untouched and still work with no `DATABASE_URL`.

Verified: PGlite runs under `next dev` and under `next build` + `next start`
on Node 24.21.0. The supported minimum is Node 22.15 (`module.registerHooks()`
in the seed and self-test scripts).

### Transactions

`db.transaction()` is a real transaction on PGlite but only a batched request
on neon-http, which cannot hold a session. **Do not rely on rollback.** Order
multi-statement writes so a partial failure still leaves valid data (that is
why `publishPage()` writes the snapshot last).

### Schema

All tables in `src/db/cms-schema.ts`, all prefixed `cms_`.

| Table | Purpose |
| --- | --- |
| `cms_users` | CMS operators. `email` lower-cased + unique, `role` (`admin`\|`editor`\|`provider`), scrypt `password_hash`, `must_change_password`, `is_active`, `last_login_at`. |
| `cms_sessions` | Opaque sessions. Stores only `token_hash`, plus `expires_at`, `user_agent`, `ip_address`. |
| `cms_login_attempts` | One row per login attempt; drives rate limiting. Pruned opportunistically (>1 day). |
| `cms_pages` | Page record + all SEO fields + `published_snapshot` jsonb. Unique `(locale, slug)` and `(locale, translation_group)`. |
| `cms_blocks` | **Draft** blocks, ordered by `sort_order`. Never read by the public site. |
| `cms_navigation` | One row per `(locale, menu_key)`; `items` is an ordered jsonb array. |
| `cms_media` | Metadata + per-locale `alt` jsonb + `storage` (`db`\|`blob`) + soft-delete `deleted_at`. |
| `cms_media_blobs` | Image bytes for `storage='db'`. **Never hard-deleted.** |
| `cms_redirects` | `from_path` unique → `to_path`, 301/302, `is_enabled`. |
| `cms_site_settings` | `(locale, key)` primary key → jsonb value. |
| `cms_audit_log` | Lightweight who/what/when. Denormalised `user_email` survives user deletion. |

Booking adds eight more tables — `cms_locations`, `cms_services`,
`cms_providers`, `cms_provider_services`, `cms_business_hours`,
`cms_availability_exceptions`, `cms_bookings`, `cms_booking_rate_limit` —
described in [`booking-architecture.md`](./booking-architecture.md) §2. That
makes nineteen `cms_*` tables in total.

Only two real Postgres enums exist (`cms_role` = `admin`, `editor`,
`provider`; `cms_page_status`). Locale, menu key, block type, media storage and
structured-data type are plain `text` validated by zod, so adding a value later
never needs an `ALTER TYPE`.

### Multi-language

Dutch is the only locale published now, but nothing is hard-coded to it:

- every localisable row has `locale text NOT NULL DEFAULT 'nl'`;
- uniqueness is scoped by locale — `(locale, slug)`, `(locale, menu_key)`,
  `(locale, key)`;
- `cms_pages.translation_group` links the same page across locales. The Dutch
  home page and a future English home page share `translation_group = 'home'`
  but have different slugs.

`DEFAULT_LOCALE` is exported from `@/db/cms-schema`. Dutch is served without a
URL prefix (`publicPathFor()` in `repo.ts` encodes that rule).

### Migrations

| File | Contents |
| --- | --- |
| `drizzle/0000_webshop_baseline.sql` | The four existing webshop tables. Back-fills the migration history that `drizzle-kit push` never created. Fully idempotent (`CREATE TABLE IF NOT EXISTS` + `duplicate_object` guards), so it is a **no-op against the live Neon database** and creates the tables on a fresh one. |
| `drizzle/0001_cms_foundation.sql` | Two enum types + eleven `cms_*` tables + their indexes and foreign keys. **Additive only** — no `DROP`, no `TRUNCATE`, no `ALTER` of any webshop table. Also idempotent. |
| `drizzle/0002_role_provider.sql` | `ALTER TYPE cms_role ADD VALUE IF NOT EXISTS 'provider'`, nothing else. |
| `drizzle/0003_booking.sql` | The eight booking tables, FKs and indexes, all guarded. |

`drizzle.config.ts` lists both schema files and falls back to a placeholder URL
so `npm run db:generate` works without `DATABASE_URL`.

Every schema change ships as a named migration, guarded so it can run twice:

```bash
npm run db:generate -- --name=<snake_name>   # commit drizzle/*.sql + drizzle/meta/*
npm run db:migrate                           # PGlite locally, Neon when DATABASE_URL is set
```

**`db:push` is for a throwaway local database only, never for Neon** — it
diffs the live schema and can propose destructive changes.

---

## 3. Draft / publish model

```
cms_blocks  (draft)  --- publishPage() --->  cms_pages.published_snapshot (frozen JSON)
                                                          |
                                                          v
                                            the public site renders ONLY this
```

- Editors change `cms_blocks`. Nothing a visitor sees changes.
- `publishPage()` (admin only) validates **every** block against the registry.
  If any block fails, nothing is written and the issues come back in the error
  message.
- The snapshot freezes blocks **and** SEO **and** title/kind, so a page keeps
  rendering exactly as published even if a block schema later gains a field.
- `unpublishPage()` flips the status back to `draft` but **keeps** the
  snapshot, so re-publishing without edits restores exactly what was live.
- Snapshot shape: `publishedSnapshotSchema` in `blocks.ts` (`version: 1`).
  Read it back with `parsePublishedSnapshot(value)`, which returns `null` if it
  no longer validates — treat that as "not published".

---

## 4. Auth

`src/lib/cms/{password,session,auth,permissions}.ts`. Entirely separate from
Clerk: Clerk guards the webshop's `/account` and `/checkout`; this guards
`/admin`.

### Passwords

Node's built-in `crypto.scrypt` — no native dependency. Stored as a
self-describing envelope so parameters can be raised later without a
migration:

```
scrypt$32768$8$1$<salt-base64>$<hash-base64>
```

Verification is constant-time and returns `false` (never throws) on a
malformed hash. An unknown email is still verified against a dummy hash, so
login timing does not reveal which accounts exist.

Minimum 12 chars, needs lower + upper + digit (`validatePasswordStrength`).

### Sessions

- 32 random bytes, base64url, in the `cms_session` cookie.
- The database stores only `HMAC-SHA256(token, CMS_SESSION_SECRET)`.
  Rotating the secret signs everyone out; a leaked DB dump is not replayable.
- Cookie: `httpOnly`, `sameSite=lax`, `path=/`, `secure` in production.
- 14-day expiry with **sliding renewal**: once past the halfway point, using
  the session pushes expiry back to a full 14 days.
- Password change and deactivation revoke every session for that user.

### Cookies

Every cookie the CMS and the studio site set. None is used for tracking; GA4's
own `_ga*` cookies appear only after consent (§12.7).

| Cookie | Set by | Contents | Flags / lifetime |
| --- | --- | --- | --- |
| `cms_session` | login (`session.ts`) | random session token; the DB stores only its HMAC | `httpOnly`, `sameSite=lax`, `path=/`, `secure` in production; 14 days, sliding |
| `cms_google_oauth` | `GET /api/google/oauth/start` (`src/app/api/google/oauth/state.ts`) | provider id, CMS user id, nonce, return target, expiry; HMAC-SHA256 signed with `CMS_SESSION_SECRET` (domain-separated). The callback accepts only a valid signature, an unexpired state, a nonce equal to Google's `state` (constant-time) and the same signed-in user | `httpOnly`, `sameSite=lax`, `path=/api/google/oauth`, `secure` in production; 10 minutes |
| `cms_consent` | the consent banner, client-side (`src/lib/analytics/consent.ts`) | `granted` or `denied` | `SameSite=Lax`, `path=/`, `Secure` on https; 365 days. Not `httpOnly`: the banner and the GA4 loader read it in the browser |

### Rate limiting

10 failed attempts per 15 minutes, counted per **email OR IP**
(`LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_MS` in `auth.ts`). Exceeding it returns
`error: 'rate_limited'`.

### API

```ts
import {
  login, logout, changePassword, createUser,
  getCurrentCmsUser, requireCmsUser, requirePermission,
  CmsAuthError, verifyCredentials,
  listCmsUsers, setUserRole, setUserActive, resetUserPassword,
} from '@/lib/cms/auth';

type AuthResult<T> = { ok: true; data: T } | { ok: false; error: AuthError; message: string };

login(input: { email: string; password: string; context?: { userAgent?, ipAddress? } })
  : Promise<AuthResult<CmsUserPublic>>            // verifies + sets the cookie
logout(): Promise<void>                           // always succeeds
getCurrentCmsUser(): Promise<CmsUserPublic | null> // React.cache'd, one lookup per request
requireCmsUser(role?: CmsRole): Promise<CmsUserPublic>  // rank check, throws CmsAuthError
requirePermission(permission: CmsPermission): Promise<CmsUserPublic>
changePassword(input: { currentPassword: string; newPassword: string }): Promise<AuthResult<true>>
createUser(input: { email; name; role; password? }): Promise<AuthResult<{ user; temporaryPassword: string | null }>>
```

`CmsAuthError.code` is `'unauthenticated' | 'forbidden'`. The dashboard layout
`src/app/admin/(dashboard)/layout.tsx` calls `requireCmsUser()` and redirects
to `/admin/login` on a `CmsAuthError`; each page then checks its own
permission.

`getCurrentCmsUser()` never returns `passwordHash` (the type is
`CmsUserPublic`). All messages are Dutch and safe to show to the user.

Users with `mustChangePassword === true` must be forced onto a change-password
screen before anything else — the bootstrap admin is created that way.

### Permission matrix

`src/lib/cms/permissions.ts` is the single source of truth. Use
`can(user.role, permission)` for UI visibility and `requirePermission()` in
every server action. **Hiding a button is not enforcement.**

Three roles (Dutch labels in `ROLE_LABELS`): `admin` (Beheerder) has every
permission; `editor` (Redacteur) does content work and may read booking data;
`provider` (Aanbieder) is a bookable person who sees only their own bookings,
profile, hours and Google connection and has **no access to pages, media,
navigation, redirects or settings**.

| Capability | Permission | Provider | Editor | Admin |
| --- | --- | :-: | :-: | :-: |
| View pages | `page.read` | ❌ | ✅ | ✅ |
| Create page | `page.create` | ❌ | ✅ | ✅ |
| Edit page + SEO | `page.update` | ❌ | ✅ | ✅ |
| Delete page | `page.delete` | ❌ | ✅ | ✅ |
| **Publish page** | `page.publish` | ❌ | ❌ | ✅ |
| **Unpublish page** | `page.unpublish` | ❌ | ❌ | ✅ |
| Edit / add / delete blocks | `block.update` | ❌ | ✅ | ✅ |
| Reorder blocks | `block.reorder` | ❌ | ✅ | ✅ |
| Browse media | `media.read` | ❌ | ✅ | ✅ |
| Upload media | `media.create` | ❌ | ✅ | ✅ |
| Edit alt text | `media.update` | ❌ | ✅ | ✅ |
| Delete media (soft) | `media.delete` | ❌ | ✅ | ✅ |
| View navigation | `navigation.read` | ❌ | ✅ | ✅ |
| Edit navigation | `navigation.update` | ❌ | ✅ | ✅ |
| View redirects | `redirect.read` | ❌ | ✅ | ✅ |
| **Manage redirects** | `redirect.manage` | ❌ | ❌ | ✅ |
| View site settings | `settings.read` | ❌ | ✅ | ✅ |
| **Change site settings** | `settings.update` | ❌ | ❌ | ✅ |
| **Manage users** | `user.read`, `user.manage` | ❌ | ❌ | ✅ |
| **Read audit log** | `audit.read` | ❌ | ❌ | ✅ |
| All bookings | `booking.read` | ❌ | ✅ | ✅ |
| Own bookings | `booking.read.own` | ✅ | ❌ | ✅ |
| Cancel / complete any booking | `booking.manage` | ❌ | ❌ | ✅ |
| Cancel / complete own bookings | `booking.manage.own` | ✅ | ❌ | ✅ |
| List services | `service.read` | ✅ | ✅ | ✅ |
| Create a service | `service.create` | ✅ | ❌ | ✅ |
| Edit / deactivate any service | `service.manage` | ❌ | ❌ | ✅ |
| Choose own services | `service.subscribe.own` | ✅ | ❌ | ✅ |
| View locations | `location.read` | ✅ | ✅ | ✅ |
| Manage locations | `location.manage` | ❌ | ❌ | ✅ |
| View all providers | `provider.read` | ❌ | ✅ | ✅ |
| Manage providers | `provider.manage` | ❌ | ❌ | ✅ |
| Own profile, hours, exceptions, Google | `provider.self` | ✅ | ❌ | ✅ |
| GA4 dashboard panel | `analytics.read` | ❌ | ❌ | ✅ |

The provider set is exactly `booking.read.own`, `booking.manage.own`,
`service.read`, `service.create`, `service.subscribe.own`, `location.read`,
`provider.self` (the self-test checks this). `*.own` is resolved server-side
from the signed-in user's `cms_providers` row; a provider may also edit or
deactivate services they created themselves. Details:
[`booking-architecture.md`](./booking-architecture.md) §3.

`ROLE_RANK = { provider: 0, editor: 1, admin: 2 }`, so
`requireCmsUser('editor')` keeps providers out of the content screens. Gate
booking screens on permissions, not on rank. The admin sidebar
(`src/components/admin/shell.tsx`) shows each entry only with its permission.

Admins cannot deactivate themselves or drop their own admin role.

Changing the **slug of an already-published page** additionally requires
`page.publish`. Renaming a live page takes its old URL offline immediately and
moves the content elsewhere, which is a publishing act — without this rule an
editor could pull a page off the public site without the publish permission,
contradicting §3's "editors change nothing a visitor sees". Renaming a *draft*
page stays an ordinary `page.update`. Enforced in `updatePageMeta()`
(`repo-admin.ts`).

### Middleware

`src/middleware.ts` does two independent things and **no database work**:

1. Clerk pass-through for the webshop, unchanged (`/account`, `/checkout`).
2. If the path is under `/admin` and is not `/admin/login`, and the
   `cms_session` cookie is absent → redirect to
   `/admin/login?next=<original path>`.

That cookie check is a convenience redirect, **not** the security boundary.
The real check is `requireCmsUser()` in the `/admin` layout, which hits the
database. A forged cookie gets past middleware and is rejected by the layout.

---

## 5. Block registry

`src/lib/cms/blocks.ts`. Twelve block types: eleven derived from the real
prototype (`prototype/index.html`, `prototype/bikefit.html`) and copy decks
(`content/index.html`, `content/about.html`, `content/booking.html`), plus
`booking` for the online booking widget.

```ts
import { blockRegistry, BLOCK_TYPES, defaultDataFor, validateBlock, validateBlocks } from '@/lib/cms/blocks';

blockRegistry.hero.label        // 'Hero'
blockRegistry.hero.description  // Dutch, for the block picker
blockRegistry.hero.schema       // zod schema
blockRegistry.hero.defaultData  // real Dutch copy, ready to insert
defaultDataFor('hero')          // deep clone of the above
```

| Type | Label | Source section |
| --- | --- | --- |
| `hero` | Hero | `.hero` (home) and `.page-head` (subpages) via `variant: 'full' \| 'pageHead'`. `titleEmphasis` reproduces the `<em>` in "Fiets met *comfort.*" |
| `richText` | Tekst | free prose; `html` passes the allowlist sanitiser on every write (see *Rich-text sanitiser* below) |
| `services` | Diensten | "Vier dingen, één positie" and "Vier manieren om te boeken" |
| `process` | Werkwijze | "Hoe verloopt een bikefit?", 4 numbered steps |
| `audience` | Voor wie | "Voor wie is dit?", 5 personas, `featured` for jeugd |
| `faq` | Veelgestelde vragen | 8 Q&A; `emitStructuredData` drives FAQPage JSON-LD |
| `cta` | Oproep | the accent callout, "Comfort is een keuze. Maak ze." |
| `imageText` | Beeld + tekst | `#verhaal`, `#waarom`, `#aan-huis`, `#jeugd` — `imagePosition`, `variant`, optional `quote`/`bullets`/`facts` |
| `pricing` | Prijzen | **no amounts exist anywhere in the source material** — see below |
| `contact` | Contact | phone, city, "Op afspraak" — no street address or e-mail is known |
| `testimonial` | Ervaringen | 4 reviews from the copy deck, all marked placeholder |
| `booking` | Afspraak boeken | the booking widget on `/afspraak` (service → provider → day → slot → details → confirmation). Carries copy and a filter only: `serviceIds` (empty = every active service), `showProviderChoice` (AND-ed with the `booking.showProviderChoice` setting), `successTitle`, `successText` (empty → `booking.confirmationText`). Services, providers and live availability are read at render time through `@/lib/booking/content`, so nothing in the block goes stale. |

Most blocks share `variant: 'default' | 'gray' | 'dark'`, matching the
prototype's white / `--gray` / `--dark` section backgrounds.

**Two blocks ship with `isPlaceholder: true` and are not rendered publicly
while that flag is set:**

- `pricing` — the prototype and copy decks contain **no prices at all**. Only
  durations are known (90 min adult, ~60 min youth, up to two hours for
  complex fits). `content/booking.html` explicitly records "prijzen tonen?" as
  an open question. Default plans carry `priceCents: null`.
- `testimonial` — the four reviews are illustrative copy from
  `content/index.html`, explicitly flagged to be replaced before launch.

A published snapshot that contains a block type the running code does not
know fails `parsePublishedSnapshot()` and the page is treated as unpublished.
Deploy code that adds a block type **before** publishing pages that use it
(this is why `/afspraak` is refreshed after the booking deploy, see the
staging runbook).

### Rich-text sanitiser

`src/lib/cms/actions/sanitize.ts` is the one place that decides which markup
may reach `dangerouslySetInnerHTML` on the public site (besides code-generated
JSON-LD and gtag). `repo.updateBlock()` runs `sanitizeBlockData()` on every
block write before validation, so the admin action and `scripts/cms-seed.mts`
(which writes through the repo) store exactly the same thing;
`rich-text.tsx` renders the stored HTML as-is.

`sanitizeRichTextHtml()` is an **allowlist** built on `sanitize-html`, applied
to every `html` field:

- Tags: `p`, `br`, `h2`, `h3`, `h4`, `ul`, `ol`, `li`, `a`, `strong`, `b`,
  `em`, `i`, `blockquote`. Any other element is unwrapped (its text kept);
  `script`, `style`, `iframe`, `svg`, `template` and similar are removed
  together with their content.
- Attributes: only `href`, `title`, `rel`, `target` on `a`; none elsewhere, no
  classes, no styles. `href` must be relative, an anchor, or `http`, `https`,
  `mailto`, `tel` (protocol-relative `//…` is refused).
  `target="_blank"` always gets `rel="noopener noreferrer"`; any other
  `target` is dropped.
- Empty `p` and `h2`–`h4` are dropped. The function is idempotent.

Link-ish fields in any block (`href`, `url`, `mapEmbedUrl`, `phoneHref`,
`website`, `canonicalOverride`) are rejected with a Dutch message when they use
`javascript:`, `data:`, `vbscript:` or `file:`.

The admin's rich-text field has two modes, both storing HTML: **Tekst** (a
plain textarea; `plainTextToHtml` in `src/lib/cms/rich-text-plain.ts` turns
blank-line separated text into escaped `<p>` paragraphs) and **HTML** (the
source itself, for pages that need headings, lists and links, such as the
privacy statement and the terms). A block whose stored HTML already uses more
than `<p>`/`<br>` opens in HTML mode, so saving it never flattens it; switching
it to Tekst asks for confirmation because that conversion is lossy. The
client-side helpers never import `sanitize-html`; the allowlist runs on the
server only. Change the allowlist only together with a test in
`sanitize.test.ts`.

### Validation

```ts
validateBlock(type: string, data: unknown): { ok: true; data } | { ok: false; message }
validateBlocks(blocks: { id?; type; data }[])
  : { ok: true; blocks: BlockInstance[] } | { ok: false; issues: BlockValidationIssue[] }
```

`validateBlocks` applies zod defaults, so the normalised output is what gets
frozen into a snapshot. `publishPage()` calls it; nothing can be published
without passing.

### Navigation shape

`cms_navigation.items` is an ordered jsonb array — chosen over normalised rows
because menus are small, always read and written whole, and drag-to-reorder
becomes a single `UPDATE`.

```jsonc
[
  { "label": "Bikefit", "href": "/bikefit", "external": false, "group": "",
    "children": [{ "label": "Jeugdfit", "href": "/bikefit#jeugd", "external": false }] }
]
```

`group` exists for the footer's labelled columns (Studio / Bikefits / Contact
in the prototype). Validate with `validateNavigationItems(items)`.

### Site settings keys

`cms_site_settings` values are validated per key by `siteSettingSchemas`:

| Key | Contents |
| --- | --- |
| `site` | `name`, `tagline`, `strapline`, `mission`, `logoMediaId` |
| `contact` | `phoneLabel`, `phoneHref`, `email`, `addressLines`, `postalCode`, `city`, `country`, `hours`, `website` |
| `seo` | `defaultMetaTitle`, `titleTemplate`, `defaultMetaDescription`, `defaultOgImageMediaId`, `allowIndexing` |
| `organization` | `type`, `legalName`, `vatNumber`, `sameAs`, `priceRange`, `areaServed`, `latitude`, `longitude` — the Organization / LocalBusiness JSON-LD source |
| `analytics` | `ga4MeasurementId` (reference only; the tag reads `NEXT_PUBLIC_GA4_MEASUREMENT_ID`), `ga4PropertyId` (numeric GA4 property for the admin panel; env `GA4_PROPERTY_ID` wins), `enabled` (default **false**; the tag and banner load only when true) |
| `booking` | `slotStepMinutes` (30), `minNoticeHours` (24), `horizonDays` (56), `defaultBufferAfterMinutes` (15), `cancelUntilHours` (48), `timezone` (`Europe/Brussels`), `introTitle`, `introText`, `confirmationText`, `showProviderChoice` (true) — the booking rules, see `booking-architecture.md` §4 |

Admin → Instellingen has one form per key: Site, Contact, SEO, Organisatie
(JSON-LD), Afspraken, Analytics.

`getSiteSettings()` always returns every key with schema defaults filled in, so
it never throws and never returns `undefined` fields.

**`seo.allowIndexing` defaults to `false`.** Worker C: `robots.ts` must emit
`Disallow: /` while it is false. Staging must not be indexed.

---

## 6. Content read API (Worker C)

`src/lib/cms/content.ts` — `server-only`. Together with its booking
counterpart `src/lib/booking/content.ts` (services, providers, live
availability; `booking-architecture.md` §5), this is the **only** way the
public site reaches the database. Do not import `@/db/cms` directly.

```ts
import {
  getPublishedPage, listPublishedPages, getNavigation, getSiteSettings,
  findRedirect, listRedirects, getMedia, getMediaBytes,
  mediaUrl, mediaAlt, normalizeSlug, normalizeRedirectPath, CMS_TAGS,
} from '@/lib/cms/content';

getPublishedPage(locale: string, slug: string): Promise<PublishedPage | null>
listPublishedPages(locale?: string): Promise<PublishedPageSummary[]>   // for sitemap.ts
getNavigation(locale: string, key: 'main' | 'footer'): Promise<NavigationItem[]>
getSiteSettings(locale?: string): Promise<SiteSettings>
findRedirect(path: string): Promise<{ toPath: string; statusCode: number } | null>
getMedia(id: string): Promise<CmsMediaItem | null>
getMediaBytes(id: string): Promise<{ data: Buffer; mimeType: string; filename: string } | null>
mediaUrl(media): string   // '/api/cms/media/<id>' for db-stored, the CDN URL for blob
mediaAlt(media, locale): string
```

Home page slug is the empty string; `normalizeSlug()` strips leading/trailing
slashes, so `'/'`, `''` and `'/bikefit/'` all behave.

### Caching

Every reader is wrapped in `unstable_cache` with tags from `CMS_TAGS` and a
300-second fallback revalidation. `cacheComponents` / `use cache` is **not**
enabled in this app, so `unstable_cache` is the supported API here (see
`node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`).

Values crossing that boundary are serialised, so **every date in these return
types is an ISO string, not a `Date`**.

`findRedirect()` is for a `not-found` boundary or a route handler — **not**
middleware, which must stay database-free.

---

## 7. Write API (Worker B)

`src/lib/cms/repo.ts` (plus `repo-admin.ts`) — `server-only`. Wrap these in
`'use server'` actions under `src/lib/cms/actions/**`. Do not call
`getCmsDb()` from an action directly; going through the repo is what
guarantees the permission check, the audit entry and the cache bust all
happen. Booking writes go through `src/lib/booking/repo.ts` the same way
(`booking-architecture.md` §5).

```ts
type RepoResult<T> = { ok: true; data: T } | { ok: false; message: string };  // message is Dutch

// Pages
listPages(locale?): Promise<PageListItem[]>
getPageForEdit(pageId): Promise<{ page: CmsPage; blocks: CmsBlock[] } | null>   // DRAFT blocks
createPage({ locale?, slug, title, kind?, translationGroup? }): Promise<RepoResult<CmsPage>>
updatePage(pageId, { slug?, title?, kind?, translationGroup?, ...PageSeo }): Promise<RepoResult<CmsPage>>
deletePage(pageId): Promise<RepoResult<true>>

// Blocks (draft)
addBlock(pageId, type: BlockType, position?): Promise<RepoResult<CmsBlock>>
updateBlock(blockId, data: unknown): Promise<RepoResult<CmsBlock>>   // validated against the registry
deleteBlock(blockId): Promise<RepoResult<true>>
reorderBlocks(pageId, orderedBlockIds: string[]): Promise<RepoResult<true>>

// Publishing (admin only)
publishPage(pageId): Promise<RepoResult<CmsPage>>     // freezes the snapshot
unpublishPage(pageId): Promise<RepoResult<CmsPage>>   // keeps the snapshot

// Navigation
updateNavigation(locale, menuKey, items: unknown): Promise<RepoResult<true>>

// Media
createMedia({ filename, mimeType, data, width?, height?, alt?, storage?, storageKey?, url? })
listMedia(includeDeleted?): Promise<CmsMedia[]>
updateMediaAlt(mediaId, alt: Record<string, string>): Promise<RepoResult<true>>
deleteMedia(mediaId): Promise<RepoResult<true>>   // SOFT delete only
restoreMedia(mediaId): Promise<RepoResult<true>>

// Redirects / settings / audit (admin only)
listAllRedirects(): Promise<CmsRedirect[]>
createRedirect({ fromPath, toPath, statusCode?, isEnabled?, notes? })
updateRedirect(redirectId, partial)
deleteRedirect(redirectId)
updateSiteSetting(locale, key: SiteSettingKey, value: unknown)
listAuditLog(limit?): Promise<CmsAuditLogEntry[]>
getAdminStats(): Promise<{ pages; published; media; redirects }>

// Users (re-exported from auth.ts)
createUser, listCmsUsers, setUserRole, setUserActive, resetUserPassword

// Cache
revalidateContent({ tags?: string[]; paths?: string[] }): void
publicPathFor(locale, slug): string
```

Media limits enforced in `createMedia`: 8 MB, and
`image/jpeg|png|webp|avif|svg+xml` only.

**Media deletion is always soft.** `cms_media_blobs` rows are never removed, so
an image still referenced by an older published snapshot can always be
recovered.

### `revalidateContent()` and the Next 16 cache API

Two things changed in Next 16 that will bite you:

- `revalidateTag(tag)` with **one** argument is deprecated and fails
  typechecking. The signature is `revalidateTag(tag, profile)`, e.g.
  `revalidateTag('cms:pages', 'max')`.
- `updateTag(tag)` is the server-action-only variant that gives
  read-your-own-writes — the editor sees the published page immediately.

`revalidateContent()` already handles both: it tries `updateTag` and falls back
to `revalidateTag(tag, 'max')` outside a server action. Use it rather than
calling the Next APIs yourself.

---

## 8. Media storage: Postgres now, Vercel Blob later

Default is `storage: 'db'` — bytes in `cms_media_blobs.data` (`bytea`). That
works on staging with no Vercel Blob credentials, which is the whole point.

Serve them from a route handler (**Worker B owns this file**):

```ts
// src/app/api/cms/media/[id]/route.ts
import { getMediaBytes } from '@/lib/cms/content';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;                     // Next 16: params is a Promise
  const media = await getMediaBytes(id);
  if (!media) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(media.data), {
    headers: {
      'Content-Type': media.mimeType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
```

Driver gotcha: PGlite returns `bytea` as a `Uint8Array`, neon-http returns the
hex-escape string `\x89504e47…`. `toBuffer()` in `content.ts` normalises both —
always go through `getMediaBytes()`.

**Switching to Vercel Blob later** (no migration needed):

1. `npm i @vercel/blob`, set `BLOB_READ_WRITE_TOKEN` in Vercel.
2. In the upload action, `put()` the file, then call `createMedia({ …,
   storage: 'blob', storageKey: <pathname>, url: <blob url> })` and skip the
   `cms_media_blobs` insert.
3. `mediaUrl()` already returns `media.url` for `storage: 'blob'`, so nothing
   else changes.
4. Existing `db` rows keep working — the two backends coexist per row.

---

## 9. Environment variables

The full contract (every variable, per environment, secret or not) is in
[`../DEPLOYMENT.md`](../DEPLOYMENT.md) §5. The ones the CMS itself reads:

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | deployed envs | Neon pooled URL. Unset locally → PGlite. |
| `CMS_SESSION_SECRET` | deployed envs | Pepper for session-token hashing; also signs the `cms_google_oauth` cookie and the booking confirmation link. `openssl rand -base64 48`. Rotating it signs everyone out. |
| `CMS_BOOTSTRAP_PASSWORD` | bootstrap only | Pass inline to `npm run cms:bootstrap`. Never store it in `.env.local` or in Vercel. |
| `NEXT_PUBLIC_SITE_URL` | deployed envs | Canonical origin for canonicals, sitemap, OG, e-mail links and the Google OAuth redirect URI. `siteUrl()` in `src/lib/env.ts` falls back to `NEXT_PUBLIC_APP_URL`, then `VERCEL_URL`, then localhost. |
| `NEXT_PUBLIC_GA4_MEASUREMENT_ID` | no | GA4 tag id. Loaded only when valid, `analytics.enabled` is true and the visitor consented (§12.7). Build-time. |
| `GA4_PROPERTY_ID`, `GA4_SERVICE_ACCOUNT_JSON` | no | Admin analytics panel (GA4 Data API). |
| `CMS_PGLITE_DIR` | no | Override the local PGlite directory. |
| `CMS_PGLITE_AUTO_MIGRATE` | no | `"false"` disables auto-migration on first PGlite use. |

Booking variables (Google OAuth, token encryption key, Resend): see
`booking-architecture.md` §10. New code reads variables through
`src/lib/env.ts` only (`CLAUDE.md` §3). `.env.example` has a placeholder and a
one-line comment for every variable and is tracked (`!.env.example` in
`.gitignore`) while real `.env*` files are not.

---

## 10. Running it

### Local (PGlite, zero credentials)

```bash
cd website
npm ci
npm run db:migrate                                      # creates website/.pglite/
CMS_BOOTSTRAP_PASSWORD='<strong password>' npm run cms:bootstrap
npm run cms:seed                                        # Dutch pages, menus, redirect
npm run cms:seed-booking                                # first provider (temp password printed once)
npm run dev
```

`cms:bootstrap` is idempotent — it creates the admin `contact@toshoni.be`
(role `admin`, `must_change_password = true`), the six default `nl` site
settings (`site`, `contact`, `seo`, `organization`, `analytics`, `booking`),
empty `main` + `footer` menus, the two locations and the five services.
Running it twice changes nothing.

Reset the local database by deleting `website/.pglite/` and re-running the
commands.

Checks (all six are the Definition of Done in `CLAUDE.md` §2):

```bash
npm run typecheck && npm run lint && npm run format:check
npm test               # vitest unit tests
npm run cms:selftest   # 14 sections: migrations … full booking flow, on a throwaway PGlite
npm run build
```

### Staging and production (Neon + Vercel)

Environments, the Hobby-plan staging setup (previews of the `staging` branch
with branch-scoped variables) and the env var contract are in
[`../DEPLOYMENT.md`](../DEPLOYMENT.md). The step-by-step procedure — migrate,
bootstrap, seed, env vars, deploy, first login, rollback and the production
checklist — is [`staging-runbook.md`](./staging-runbook.md). Deployments are
executed by the DevOps agent Arend; production needs an explicit go.

Keep `seo.allowIndexing = false` on staging.

### Rollback

Baseline tag: **`webshop-baseline-2026-09-23`**
(`a793d1e8105bf125087fd3e78660eb5010726b8d`), plus a full-history bundle at
`.winston/repos/de-bikefit-studio/baselines/webshop-baseline-2026-09-23.bundle`.

```bash
# revert the app code only
git checkout webshop-baseline-2026-09-23 -- website

# or restore the whole repository from the bundle
git clone .winston/repos/de-bikefit-studio/baselines/webshop-baseline-2026-09-23.bundle restored
```

Database rollback: nothing needs undoing. All four migrations are additive, so
the webshop tables and data are byte-identical before and after. If you want
the CMS gone from a database, drop the nineteen `cms_*` tables and the two
`cms_*` enum types — no webshop object references them.

---

## 11. Next 16 notes that will trip you up

1. **`middleware.ts` is deprecated** in favour of `proxy.ts`; every build prints
   a warning. We keep `middleware.ts` because Clerk's `clerkMiddleware`
   expects that filename. Do not rename it. (The build output labels it
   `ƒ Proxy (Middleware)`.)
2. **`revalidateTag(tag)` needs a second argument** — see §7.
3. **`cookies()`, `headers()` and route `params` are async.** `await cookies()`,
   `const { id } = await params`.
4. Cookie writes are only legal in a server action or route handler. The
   sliding-session cookie refresh in `getCurrentCmsUser()` is wrapped in
   try/catch for exactly that reason — during a plain render the session is
   still extended in the database, just not in the cookie.
5. **Turbopack is the default builder.** `serverExternalPackages` is what keeps
   `@electric-sql/pglite` out of the bundles.
6. Folders starting with `_` are private and are **not** routed.
7. `React.cache` is used for per-request dedupe (`getCurrentCmsUser`);
   `unstable_cache` for cross-request caching. They are not interchangeable.

---

## 12. The public site (Worker C)

Added with the Dutch public site. Nothing in `src/lib/cms/*` changed.

### 12.1 Routing

| URL | File | Notes |
| --- | --- | --- |
| `/` | `src/app/(studio)/page.tsx` | Dutch home page, slug `''` |
| `/<anything>` | `src/app/(studio)/[...slug]/page.tsx` | published page → redirect → 404, in that order. Includes the seeded `/afspraak` (booking block), `/privacy` and `/algemene-voorwaarden` |
| `/afspraak/bevestigd` | `src/app/(studio)/afspraak/bevestigd/page.tsx` | booking confirmation; `?ref=` is an HMAC-signed summary without personal data; `noindex` |
| `/afspraak/annuleren/[token]` | `src/app/(studio)/afspraak/annuleren/[token]/page.tsx` | customer cancellation by e-mailed token; `noindex` |
| `/og` | `src/app/(studio)/og/route.tsx` | generated 1200×630 share card |
| `/sitemap.xml`, `/robots.txt` | `src/app/{sitemap,robots}.ts` | from the CMS |
| `/api/cms/media/[id]` | `src/app/api/cms/media/[id]/route.ts` | media bytes stored in Postgres |
| `/api/google/oauth/start`, `/api/google/oauth/callback` | `src/app/api/google/oauth/*/route.ts` | Google Calendar connect flow for providers (`booking-architecture.md` §7) |
| `/webshop` | `src/app/(webshop)/webshop/page.tsx` | the old Qarakter home page, moved verbatim |

Dutch is served from the root with no locale prefix. Nothing hard-codes `'nl'`:
`locale` is an explicit argument everywhere and the routes pass
`defaultLocale` from `src/lib/studio/locale.ts`, which also owns `localePath()`,
`localeTag()` (`nl-BE`) and `ogLocale()` (`nl_BE`). Adding `/en` later means
adding a locale to `LOCALES` and a `[locale]` segment — not a rewrite.

A catch-all is the lowest-priority match in Next's routing table, so every
webshop and admin route still wins: `/shop`, `/checkout`, `/account`, `/blog`,
`/policies/*`, `/sign-in`, `/sign-up`, `/webshop`, `/admin/*`, `/api/*`.

Redirects are resolved in the catch-all (301 → `permanentRedirect` → HTTP 308,
302 → `redirect` → HTTP 307), **not** in middleware, which must stay
database-free.

### 12.2 Layout split

`src/app/layout.tsx` is now a bare document shell (`<html lang="nl">`, both
fonts, `ClerkProvider` when Clerk is configured, `metadataBase`). The two sites
bring their own chrome:

- Studio → `src/app/(studio)/layout.tsx` + `src/components/studio/*`
- Webshop → `src/components/shell/webshop-chrome.tsx`, mounted by a `layout.tsx`
  in `(shop)`, `(auth)`, `(content)`, `(webshop)` and `/account`, which also
  re-declare the `%s · Qarakter` title template.

### 12.3 Design system

`prototype/design-system/*` is ported into `src/app/globals.css`, additively:
raw values as `--color-ds-*` in `@theme`, the semantic tier as `--ds-*` on
`.studio-root`, and every component rule prefixed `studio-` and scoped under
`.studio-root`. The webshop's own tokens and classes are untouched.

### 12.4 Rendering and caching

Every CMS-backed route is `export const dynamic = 'force-dynamic'`. The data
reads are still tag-cached by `content.ts`, so a page render is a thin shell
around a cached read, but publishing goes live immediately instead of at the
next deploy. It also keeps `next build` free of any database requirement, which
matters because `src/db/cms.ts` refuses PGlite when `NODE_ENV=production`.

### 12.5 Structured data

`src/lib/studio/jsonld.ts` builds one `@graph` per page. The layout emits
`LocalBusiness` (type from `organization.type`) + `WebSite`; each page emits
`WebPage`/`AboutPage`/`ContactPage`, `BreadcrumbList` (non-home), `FAQPage`
when a `faq` block has `emitStructuredData`, and `Service` nodes for bookable
fits. Empty values are dropped rather than guessed, so no street address,
e-mail, VAT number, price or rating is ever emitted.

A `services` block counts as bookable when at least one of its cards has a
`duration` — that is what separates "Vier manieren om te boeken" from "Vier
dingen, één positie" without adding a field.

`pricing` and `testimonial` blocks with `isPlaceholder: true` render nothing and
appear in no structured data.

### 12.6 Seeding

`npm run cms:seed` creates, fills and **publishes** the eight Dutch pages
(`/`, `/bikefit`, `/over-ons`, `/veelgestelde-vragen`, `/contact`, `/afspraak`,
`/privacy`, `/algemene-voorwaarden`) through `repo.ts`, so the snapshots, audit
entries and permission checks are the real ones. It does that by giving the
write API the request context it expects: `module.registerHooks()` stubs for
`server-only`, `next/headers` and `next/cache`, plus a genuine `cms_sessions`
row for an existing admin (revoked again on exit).

- `--only-missing` leaves every page and menu that already exists alone.
- `--refresh-slug <slug>` (also `--refresh-slug=<slug>`; `/` or `home` for the
  home page) replaces one page's draft blocks with the seed definition and
  republishes it; its title/SEO fields, all other pages, menus, settings and
  redirects stay as they are. A missing page is created in full. Used to roll
  out the `booking` block on `/afspraak` and the legal texts on `/privacy` and
  `/algemene-voorwaarden` to an existing database. Cannot be combined with
  `--only-missing`.

The legal texts (`PRIVACY_HTML` / `TERMS_HTML` in `scripts/cms-seed.mts`) take
their e-mail address from *Instellingen → Contact → e-mail* at seed time;
see `booking-runbook.md` §11.2.

### 12.7 Analytics — consent-gated GA4 tag and admin panel

**Public tag.** `src/components/studio/analytics.tsx` (`StudioAnalytics`,
mounted once by the studio layout) renders nothing unless **both**
`NEXT_PUBLIC_GA4_MEASUREMENT_ID` is set and well-formed **and**
`cms_site_settings.analytics.enabled` is `true` (`resolveMeasurementId()` in
`src/lib/analytics/consent.ts`). When both hold it mounts two client
components:

- `ConsentBanner` (`src/components/studio/consent-banner.tsx`) asks once and
  stores the choice in the `cms_consent` cookie (`granted` | `denied`, 365
  days; §4 *Cookies*). *Weigeren* is as prominent as *Accepteren* and also
  removes any `_ga*` cookies left from an earlier acceptance. The footer link
  *Cookies* reopens the banner; the banner links to `/privacy` once published.
- `Ga4Tag` (`src/lib/analytics/ga4-tag.tsx`) loads `gtag/js` only after
  `granted` and sends a `page_view` on every route change.

Before consent there is no analytics script, no request to Google and no
analytics cookie. When the guard fails there is no banner either and no
footer *Cookies* link (there is no choice to make).

**Admin panel.** `src/components/admin/analytics-panel.tsx` on the dashboard,
visible only with `analytics.read` (admins). It reads the GA4 Data API through
`src/lib/analytics/ga4.ts` with a service account (`GA4_SERVICE_ACCOUNT_JSON`;
property id from `GA4_PROPERTY_ID` or the `analytics.ga4PropertyId` setting),
cached for one hour, and shows setup steps when not connected.

Setup of the GA4 property, stream and service account:
`booking-runbook.md` §5. GDPR rules for the banner: `booking-runbook.md` §11.1.

### 12.8 Security headers

`next.config.ts` `headers()` sets `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin` and
`Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()` on
every route, and `X-Frame-Options: DENY` on `/admin` and below. There is no
Content-Security-Policy yet (see §13). How to verify after a deploy:
`booking-runbook.md` §11.4.

---

## 13. Known gaps and open questions

- **Booking** is built: schema, availability, admin screens, the public widget
  on `/afspraak`, Google Calendar sync and e-mail. It is documented in
  [`booking-architecture.md`](./booking-architecture.md) (design) and
  [`booking-runbook.md`](./booking-runbook.md) (setup, GDPR, retention).
- **No prices exist.** Nothing in `prototype/`, `content/` or `brand/` names an
  amount. The `pricing` block is placeholder-flagged and hidden; services carry
  `price_cents = null` and `show_price = false`.
- **Studio contact details are incomplete.** The legal identity (company,
  registered office, enterprise/VAT number) is fixed in
  `src/lib/studio/legal.ts` for the footer and the transactional e-mails, but
  `cms_site_settings.contact` (street, e-mail) and `organization.vatNumber`
  are still empty, so the `LocalBusiness` JSON-LD stays incomplete until they
  are filled in. The public contact e-mail is also what the legal texts use.
- **Testimonials are illustrative copy** from the copy deck, not real reviews.
- **The legal texts are templates** until a lawyer has reviewed them
  (`booking-runbook.md` §11.5).
- **No Content-Security-Policy yet** (`next.config.ts` sets the other security
  headers); the GA4 tag and Next's inline scripts would need nonces.
- Session rows are only pruned opportunistically. If volume ever matters, add a
  scheduled `pruneExpiredSessions()` call.
