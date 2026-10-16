# Booking architecture — De Bikefit Studio

Contract document for online booking ("Maak een afspraak"), Google Calendar
sync and booking e-mail. Written by Worker A (foundation) for Workers B (admin
UI), C (public widget) and D (Google OAuth routes, analytics, QA).

**Status:** foundation complete: schema + migrations `0002`/`0003`, the
`provider` role, `src/lib/booking/**`, `src/lib/email/**`, env, bootstrap and
seed scripts, self-test sections 10–14. The admin screens, the public widget
and the OAuth routes are built on top of this by B, C and D.

The rules from [`cms-architecture.md`](./cms-architecture.md) still apply:
additive `cms_*` migrations only, every write goes through a repo function
(permission check, then audit, then cache bust), the public site reads only through a
`server-only` content module, middleware stays database-free, Dutch copy with
informal "je". Every local time is `Europe/Brussels`; every stored instant is
UTC (`timestamptz`).

---

## 1. Files

| Path | Kind | Purpose |
| --- | --- | --- |
| `src/db/cms-schema.ts` | schema | 8 new tables + `provider` in `cms_role` |
| `drizzle/0002_role_provider.sql` | migration | `ALTER TYPE cms_role ADD VALUE IF NOT EXISTS 'provider'` only |
| `drizzle/0003_booking.sql` | migration | the booking tables, FKs, indexes (all guarded) |
| `src/lib/booking/time.ts` | plain | time-zone helpers (`@date-fns/tz`) |
| `src/lib/booking/availability.ts` | plain | `computeSlots()`: pure slot engine |
| `src/lib/booking/settings.ts` | plain* | `BookingRules`, defaults, `getBookingRules()` |
| `src/lib/booking/format.ts` | plain | location/price/duration labels, `slugify` |
| `src/lib/booking/defaults.ts` | plain | bootstrap data (locations, 5 services, default hours) |
| `src/lib/booking/google.ts` | server-only | OAuth + Calendar REST via `fetch`, token encryption |
| `src/lib/booking/provider-calendar.ts` | server-only | a provider's busy times and events, degrading gracefully |
| `src/lib/booking/provider-calendar-errors.ts` | plain | `describeProviderError()`: the fixed text stored as `google_sync_error` |
| `src/lib/booking/content.ts` | server-only | public read API (cached lists, live availability) |
| `src/lib/booking/repo.ts` | server-only | admin write API (`RepoResult<T>`); re-exports the catalogue |
| `src/lib/booking/repo-services.ts` | server-only | the service catalogue: list/get/create/update/deactivate, all writes `service.manage` (§3, §14) |
| `src/lib/booking/repo-shared.ts` | server-only | `ok`/`err`/`forbidden`/`bust`/`locationExists`, shared by the two repo files |
| `src/lib/booking/phone.ts` | plain | `normalizePhone()`: Belgian numbers with one `+32`, used by the widget and the server (§9) |
| `src/lib/booking/public-booking.ts` | server-only | anonymous create / look up / cancel by token |
| `src/lib/booking/public-booking-input.ts` | plain | `publicBookingInputSchema` (raw caps) and `validateBookingFields()` (field rules, length before pattern), re-exported by `public-booking.ts` (§5) |
| `src/lib/booking/rate-limit-policy.ts` | plain | `bookingRateLimitScopes()`: the keys and limits of the public booking limit (§9 step 3) |
| `src/lib/rate-limit.ts` | plain (`db` passed in) | shared race-free reservation on `cms_rate_limits`: reserve, release, prune |
| `src/db/cms-rate-limit-schema.ts` + `drizzle/0008_cms_rate_limits.sql` | schema + migration | `cms_rate_limits` (guarded) |
| `src/lib/booking/booking-log.ts` | plain | `logBookingFailure()` (safe `[booking]` log lines) and `isUniqueViolation()` |
| `src/lib/booking/notifications.ts` | server-only | loads a booking and sends the right e-mails |
| `src/lib/email/send.ts` | server-only | Resend REST API via `fetch` |
| `src/lib/email/ics.ts` | plain | RFC 5545 `.ics` builder |
| `src/lib/email/templates.ts` | plain | Dutch confirmation / notification / cancellation mails |
| `scripts/cms-seed-booking.mts` | script | first provider + hours + subscriptions |

\* `settings.ts` imports `@/lib/cms/content` lazily inside `getBookingRules()`,
so importing the file never pulls in `server-only`.

`src/lib/booking/public-actions.ts` (server actions for the widget) belongs to
Worker C; the admin actions under `src/lib/cms/actions/*` belong to Worker B.

---

## 2. Database

### Tables (`drizzle/0003_booking.sql`)

| Table | Purpose / notable columns |
| --- | --- |
| `cms_locations` | `name`, `kind` (`studio`\|`customer`), `address_lines` jsonb, `postal_code`, `city`, `country` (`BE`), `notes`, `is_default`, `is_active`, `sort_order`. `kind = 'customer'` means "at the customer's address": the booking form asks for an address. |
| `cms_services` | The canonical catalogue (§14). `locale` (`nl`), `slug` (unique per locale), `name`, `choice_label` (0009, default `''` = the name: its label under an offer, e.g. "Volwassene"), `description`, `duration_minutes`, `buffer_after_minutes` (default 15, **null = setting default**), `price_cents` (null), `show_price` (false), `location_id` (null = provider default), `requires_guardian`, `is_active`, `sort_order`, `color`, `created_by`. |
| `cms_providers` | 1:1 with `cms_users` (`user_id` unique, cascade). `display_name`, `bio`, `phone`, `email` (public), `timezone`, `default_location_id`, Google: `google_calendar_id` (`primary` once connected), `google_refresh_token_enc`, `google_access_token` (**also encrypted**), `google_access_expires_at`, `google_email`, `google_connected_at`, `google_sync_error`; `is_active`, `sort_order`. |
| `cms_provider_services` | PK (`provider_id`, `service_id`), `location_id` = per-provider override. |
| `cms_business_hours` | `weekday` 0–6 (0 = Sunday), `start_minute`/`end_minute` = minutes since local midnight, end exclusive. Several rows per weekday. |
| `cms_availability_exceptions` | `date` (local), `kind` `closed`\|`open`, optional minutes, `note`. Unique (`provider_id`, `date`, `kind`, `start_minute`). |
| `cms_bookings` | service (restrict), provider (restrict), location (set null), `starts_at`/`ends_at` (UTC), `timezone`, `status` (`confirmed`\|`cancelled`\|`completed`\|`no_show`), customer + guardian fields, `bike_details`, `notes`, `customer_address`, `cancel_token_hash` (unique, SHA-256 hex), `cancelled_at`, `cancelled_by` (`customer`\|`provider`\|`admin`), `google_event_id`, `google_sync_status` (`pending`\|`synced`\|`failed`\|`none`), `google_sync_error`, `source` (`web`). |
| `cms_booking_rate_limit` | `ip_address`, `email`, `attempted_at`: one row per attempt (mirror of `cms_login_attempts`). Bookings wrote here, plain e-mail and IP, until 0008; since then only the gift voucher requests do (`cadeaubon:` keys, hashed e-mail; `booking-runbook.md` §12). Pruned after 1 day by those requests and by `cms:retention`. Kept unchanged (additive migrations). |

### Rate-limit counters (`drizzle/0008_cms_rate_limits.sql`)

| Table | Purpose / notable columns |
| --- | --- |
| `cms_rate_limits` | One row per rate-limit key: `scope` (primary key, `booking:ip:<ip>` or `booking:email:<SHA-256 hex>`), `hits` (`timestamptz[]`, the attempts still inside the key's window), `updated_at` (indexed). No foreign key: the keys belong to anonymous visitors. A row untouched for a day is pruned on every booking attempt. Schema `src/db/cms-rate-limit-schema.ts`, reservation `src/lib/rate-limit.ts` (§9 step 3). |

Indexes: bookings on (`provider_id`, `starts_at`), (`starts_at`),
(`customer_email`), plus a **partial unique index**
`cms_bookings_provider_start_confirmed_key` on (`provider_id`, `starts_at`)
`WHERE status = 'confirmed'`. It stops two visitors from booking the same start at the
same moment (neon-http has no real transactions). Cancelled rows do not count,
so a freed slot can be booked again.

Closed sets are `text` validated by zod, like the CMS. The only enum change is
`cms_role`.

### Migrations

| File | Contents |
| --- | --- |
| `0002_role_provider.sql` | `ALTER TYPE "public"."cms_role" ADD VALUE IF NOT EXISTS 'provider';`, and nothing else. |
| `0003_booking.sql` | 8 `CREATE TABLE IF NOT EXISTS`, FKs in `duplicate_object` guards, `CREATE [UNIQUE] INDEX IF NOT EXISTS`. |
| `0008_cms_rate_limits.sql` | `CREATE TABLE IF NOT EXISTS "cms_rate_limits"` and `CREATE INDEX IF NOT EXISTS` on `updated_at`, nothing else: no foreign key, no data change, `cms_booking_rate_limit` untouched. **Apply before deploying the build that uses it**: until the table exists every public booking attempt fails closed (`error`, "Er ging iets mis bij het boeken", logged as `[booking] create_failed`). |
| `0009_cms_service_choice_label.sql` | `ALTER TABLE "cms_services" ADD COLUMN IF NOT EXISTS "choice_label" text DEFAULT '' NOT NULL`, nothing else: no data change (existing rows get `''`, so they keep showing their name), no price. **Apply before deploying the build that uses it**: the app selects every `cms_services` column, so until then the widget shows its "bel ons" fallback and the service screens fail. Self-test 14c re-runs it twice. |

All are **additive only** and idempotent (verified by migrating a fresh
PGlite twice). Note that drizzle's migrator runs *all pending files in one
transaction*, so on a fresh database `0002` and `0003` share a transaction.
That is fine because Postgres only forbids **using** a new enum value in the transaction
that added it, and nothing in `0003` references `'provider'`. Users with that role
are created afterwards (bootstrap / seed / admin).

Generated with two `drizzle-kit generate --name=…` runs, so
`drizzle/meta/0002_snapshot.json` → `0003_snapshot.json` form a correct chain
and future `db:generate` runs diff cleanly. `0008` was generated the same way
(`npm run db:generate -- --name=cms_rate_limits`, on top of `0007`) and then
guarded by hand; self-test 14b re-runs it twice.

---

## 3. Permissions and the `provider` role

`src/lib/cms/permissions.ts` (appended to `CMS_PERMISSIONS`):

| Permission | Meaning | Provider | Editor | Admin |
| --- | --- | :-: | :-: | :-: |
| `booking.read` | all bookings | ❌ | ✅ | ✅ |
| `booking.read.own` | own bookings | ✅ | ❌ | ✅ |
| `booking.manage` | cancel / complete any booking | ❌ | ❌ | ✅ |
| `booking.manage.own` | cancel / complete own bookings | ✅ | ❌ | ✅ |
| `service.read` | list services | ✅ | ✅ | ✅ |
| `service.create` | create a service (the repo asks `service.manage`) | ❌ (until 16 Oct 2026: ✅) | ❌ | ✅ |
| `service.manage` | create, edit, price, deactivate, reactivate any service | ❌ | ❌ | ✅ |
| `service.subscribe.own` | subscribe the own profile to active services | ✅ | ❌ | ✅ |
| `location.read` / `location.manage` | locations | ✅ / ❌ | ✅ / ❌ | ✅ |
| `provider.read` / `provider.manage` | all providers | ❌ | ✅ / ❌ | ✅ |
| `provider.self` | own profile, hours, exceptions, Google | ✅ | ❌ | ✅ |
| `analytics.read` | GA4 dashboard panel | ❌ | ❌ | ✅ |

`ROLE_PERMISSIONS` is now exported. `ROLE_RANK = { provider: 0, editor: 1,
admin: 2 }`, so `requireCmsUser('editor')` keeps providers out of content
screens. Gate booking screens on permissions, not on rank.
`ROLE_LABELS.provider = 'Aanbieder'`.

"Own" is resolved server-side: the repo looks up the `cms_providers` row whose
`user_id` is the signed-in user (`getCurrentCmsUser()`).

**The service catalogue is the admin's (16 Oct 2026, Toshoni).** Creating, editing, pricing,
deactivating and reactivating a service all need `service.manage`, checked before the row is
read (`repo-services.ts`). `created_by` grants nothing any more: a provider who created a
service before this date cannot edit it either (until then providers had `service.create` and
could edit or deactivate their own services). A provider only subscribes and unsubscribes
their **own** profile (`setProviderServices()`, `service.subscribe.own`): to active services;
a subscription to a service an admin deactivated since may be kept or dropped, never added
("Je kunt je enkel inschrijven voor actieve diensten."); their hours, exceptions, per-service
location override and Google connection are unchanged (`provider.self`). The UI follows but is
not the boundary: no "Nieuwe dienst" form under *Mijn agenda* and no *Diensten* menu item for
providers (the page itself is read-only for anyone without `service.manage`). Tested by
calling the server actions directly (`src/lib/cms/actions/services.test.ts`) and on PGlite
(self-test 14c), including the legacy `created_by` case.

---

## 4. Settings

`siteSettingSchemas.booking` in `src/lib/cms/blocks.ts` (every field has a default):

```ts
{ slotStepMinutes: 30, minNoticeHours: 24, horizonDays: 56, defaultBufferAfterMinutes: 15,
  cancelUntilHours: 48, timezone: 'Europe/Brussels', introTitle: 'Maak een afspraak', introText: '',
  confirmationText: 'Je ontvangt een uitnodiging in je mailbox. Daarin vind je alle details en een link om te annuleren.',
  showProviderChoice: true }
```

`siteSettingSchemas.analytics` gained `ga4PropertyId: ''` (GA4 Data API
property id; env `GA4_PROPERTY_ID` wins). Existing rows parse fine because the
field defaults.

```ts
import { getBookingRules, parseBookingRules, DEFAULT_BOOKING_RULES, type BookingRules } from '@/lib/booking/settings';
getBookingRules(locale = 'nl'): Promise<BookingRules>   // cached via getSiteSettings (tag cms:settings)
```

---

## 5. Module API

`RepoResult<T> = { ok: true; data: T } | { ok: false; message: string }` (Dutch
message). Instants crossing any cache or server-action boundary are ISO
strings; local dates are `YYYY-MM-DD`.

### `time.ts` (plain)

```ts
BOOKING_TIMEZONE = 'Europe/Brussels'
zoned(dateIso, tz?): TZDate
localMinutesToInstant(dateYmd, minute, tz?): Date        // minute 0–1440, DST-safe
instantToLocal(instant, tz?): { dateYmd; minute; weekday }
formatSlot(instant, tz?): string                          // 'zondag 25 oktober 2026 om 09:00'
formatTime, formatDateLong, formatDateShort, formatTimeRange, isExactLocalTime,
todayYmd, addDaysYmd, diffDaysYmd, weekdayOfYmd, eachDayYmd, isValidYmd,
minutesToHhmm, hhmmToMinutes, toIso
```

### `availability.ts` (plain, no I/O)

```ts
type Slot = { startsAt: string; endsAt: string; providerId: string };
computeSlots({ date, hours, exceptions?, busy?, bookings?, service, rules, now, tz?, providerId? }): Slot[]
mergeSlots(slots): { startsAt; endsAt; providerIds: string[] }[]    // "Iedereen"
groupSlotsByDay(slots, tz?): Record<'YYYY-MM-DD', Slot[]>
openRangesForDate(date, hours, exceptions?), normalizeRanges, subtractRanges, isSlotAvailable
```

### `content.ts` (server-only, public)

```ts
BOOKING_TAG = 'booking'
listPublicServices(locale = 'nl'): Promise<PublicService[]>          // cached, tags cms + booking
listPublicProviders(serviceId?): Promise<PublicProvider[]>            // cached, locations resolved
getAvailability({ serviceId, providerId: string | null, fromYmd, toYmd, now?, locale? })
  : Promise<{ ok: true; timezone; fromYmd; toYmd; slots: Slot[] } | { ok: false; message }>   // NOT cached
getBookingSettings(locale = 'nl'): Promise<BookingRules>
resolveLocationId({ overrideId, serviceLocationId, providerDefaultId, globalDefaultId })
```

Only **active services offered by at least one active provider (with an
active user account)** are public. `PublicService` includes `durationLabel`,
`priceLabel` (empty unless `show_price`), `requiresGuardian`, `location`
(the service's own, or `null` = depends on the provider) and `providerCount`.
`PublicProvider.services[]` carries the resolved location per service:
**provider override → service location → provider default → global default location**.

`getAvailability` clamps the range to today…today + `horizonDays` and to at
most 62 days, fetches Google free/busy **once per provider** for the whole
range, and returns slots sorted by start (ties in admin provider order). Use
`mergeSlots()` for the "Iedereen" view.

### `public-booking.ts` (server-only, anonymous)

```ts
createPublicBooking(input: unknown, context?: { ipAddress?: string | null; now?: Date })
  : Promise<
    | { ok: true; bookingId; cancelToken; cancelUrl; booking: PublicBookingSummary;
        googleSyncStatus; emailSent: { customer: boolean; provider: boolean } }
    | { ok: false; code: 'invalid' | 'rate_limited' | 'slot_taken' | 'error'; message; fieldErrors: Record<string, string> }>
getBookingByCancelToken(token, context?): Promise<{ ok: true; booking; canCancel; reason; cancelDeadline } | { ok: false; message }>
cancelBookingByToken(token, context?)
  : Promise<{ ok: true; message; booking } | { ok: false; code: 'not_found' | 'already_cancelled' | 'too_late' | 'error'; message; booking }>
summarizeBooking(bookingId), generateCancelToken(), hashCancelToken(token),
publicBookingInputSchema, validateBookingFields(), BOOKING_RATE_LIMIT_MAX = 5, BOOKING_RATE_LIMIT_WINDOW_MS = 15 min
// (re-exported: the schema and the rules from public-booking-input.ts, which also exports
//  PUBLIC_BOOKING_LIMITS and PUBLIC_BOOKING_RAW_LIMITS; the two constants from rate-limit-policy.ts)

type PublicBookingSummary = { bookingId; serviceName; providerName; startsAt; endsAt; timezone; locationLabel; status };
```

Input fields (all strings default `''`): `serviceId`, `providerId` (null/''
= first free provider), `startsAt` (ISO, exactly as returned by
`getAvailability`), `customerName`, `customerEmail`, `customerPhone`
(optional), `customerAge` (number | string | null), `guardianName` (required
when the service `requiresGuardian`), `guardianEmail`, `guardianPhone`,
`customerAddress` (required when the resolved location is `customer`),
`bikeDetails`, `notes`, `website` (honeypot, must be empty), `locale`.
`fieldErrors` keys are these names. When `context.ipAddress` is omitted the
IP is read from `x-forwarded-for` / `x-real-ip`. An unknown IP is never used as a
rate-limit key (it would lump every visitor together). After the field rules and
before the service is looked up, every attempt **reserves** one hit per key (the
IP when valid, the customer e-mail, a different guardian e-mail) on
`cms_rate_limits`; a full key answers `rate_limited` (§9 step 3).

**Validation runs first, without a query, and stays cheap** (`public-booking-input.ts`, pure;
input review 2026-10-14 §8, the booking sibling of R-1). It comes before the rate limit, so a
malformed form never costs a hit, and `createPublicBooking()` is the validation boundary for
every caller: the widget's `bookAction` caps its fields lower first (`public-actions.ts`), but
the self-tests call it directly, and a server action accepts a body of up to 6 MB
(`next.config.ts`). The order:

1. **Raw caps** (`publicBookingInputSchema`, `PUBLIC_BOOKING_RAW_LIMITS`): every string field is
   capped as sent, before trimming: `serviceId`, `providerId` and `startsAt` 64 characters, the
   names 500, the e-mails 400, the phones 100, `customerAddress` 600, `bikeDetails` 1000,
   `notes` 4000, `website` 400, `locale` 16, an age sent as text 16. Technical bounds, at least
   twice each visitor-facing limit and never below the action's caps, so only an absurd payload
   stops here: `invalid` with, per field over its cap, the message the rules give a value over
   its limit (`Maximaal N tekens.`; for a phone `Vul een geldig telefoonnummer in.`), or for
   the other fields, which the widget never sends as free text (ids, start, an age sent as
   text, honeypot, locale), `Ongeldige invoer.`, as for a value of the wrong type.
2. **Honeypot**: `website` non-empty after trimming → `invalid` (unchanged).
3. **Field rules** (`validateBookingFields()`, limits in `PUBLIC_BOOKING_LIMITS`), every
   field's message at once, **length before pattern**: the e-mail pattern backtracks
   quadratically on `a@` + dots + `@`, so it never sees more than 200 characters, and the
   phone pattern never more than 40. An e-mail over 200 gets `Maximaal 200 tekens.` even when
   it is also malformed (until 14 Oct 2026 the pattern ran first and such an address got
   `Vul een geldig e-mailadres in.`); a phone number over 40 gets
   `Vul een geldig telefoonnummer in.`, as before.
4. Only then the reservation, the service, and the fresh slot re-check (§9 steps 3–5).

**Phone numbers (16 Oct 2026).** Within its 40 characters, a phone number must also be one we
can call (`normalizePhone()`, `phone.ts`): a Belgian number of 8 (landline) or 9 (mobile,
starting with 4) digits after the trunk `0`, typed national (`0470 12 34 56`, `054/12.34.56`)
or international (`+32 470 12 34 56`, `0032…`, `32470…`, `+32 0470…`, also a full number pasted
after the field's `+32 `), or a foreign number written with `+` or `00` (8–15 digits). A
foreign mobile typed without its country code (`06 12345678`) is refused, not stored as a
Belgian number that does not exist. Otherwise `Vul een geldig telefoonnummer in.` The booking stores the
normalized form, **one** `+32` and never two: `+32 470 12 34 56` (`storedPhone()`), for the
customer and for a Jeugdfit guardian alike; a foreign number as `+<digits>`. The widget does
the same before sending: an empty phone field starts with `+32 ` when it takes focus, a lone
prefix counts as empty, and on blur the number is shown normalized. Bookings stored before
this keep what was typed.

`getBookingByCancelToken()` is for the `/afspraak/annuleren/[token]` page:
show what would be cancelled on GET, cancel only on a POST/server action.

Failures are never logged as the caught error. Every catch in `createPublicBooking()` and
`cancelBookingByToken()` binds no error (`catch {`) and calls `logBookingFailure(event,
bookingId?)` from `booking-log.ts` (§9, "What is logged"). `isUniqueViolation()` lives there
too and decides the `slot_taken` race on SQLSTATE `23505` alone, found on the error or along
its `cause` chain. It has no fallback on message text, because a Drizzle query error's message
embeds every bound value, including the visitor's notes.

### `rate-limit-policy.ts` (plain) and `src/lib/rate-limit.ts` (`db` passed in)

```ts
// rate-limit-policy.ts: pure, unit-tested (rate-limit-policy.test.ts)
BOOKING_RATE_LIMIT_MAX = 5; BOOKING_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
bookingRateLimitScopes({ email, guardianEmail?, ip }): RateLimitScope[]
  // in reservation order: booking:ip:<ip> (valid IP only), booking:email:<sha256>, a different guardian's
bookingEmailKey(email), bookingIpKey(ip)

// src/lib/rate-limit.ts: not server-only, so the self-test loads it
type RateLimitScope = { key: string; limit: number; windowMs: number }   // window at most a day
reserveRateLimit(db, scopes, nowMs?): Promise<{ ok: true; reservation: { at; scopes } } | { ok: false }>
releaseRateLimit(db, reservation): Promise<void>   // one hit back per scope (unused by booking today)
pruneRateLimits(db): Promise<void>                 // rows untouched for a day; reserveRateLimit runs it first
```

### `repo.ts` (server-only, admin)

```ts
// Services (repo-services.ts, re-exported) — service.read; every write service.manage
listServices({ includeInactive?, locale? }): Promise<ServiceListItem[]>   // + locationName, providerCount
getService(id): Promise<CmsService | null>
createService(input: ServiceInput): Promise<RepoResult<CmsService>>       // input incl. choiceLabel (≤ 40)
updateService(id, input: Partial<ServiceInput>): Promise<RepoResult<CmsService>>
deleteService(id): Promise<RepoResult<true>>                              // soft: is_active = false

// Locations — location.read / location.manage
listLocations({ includeInactive? }), createLocation(input), updateLocation(id, input), deleteLocation(id)  // soft

// Providers — provider.read / provider.manage, or own provider.self / service.subscribe.own
listProviders({ includeInactive? }): Promise<ProviderSummary[]>          // never includes token columns
getProvider(id): Promise<ProviderDetail | null>                            // + hours, upcoming exceptions
getOwnProvider(): Promise<ProviderDetail | null>
createProvider({ userId } | { newUser: { email, name } } & Partial<ProviderProfileInput>)
  : Promise<RepoResult<{ provider: ProviderSummary; temporaryPassword: string | null }>>
updateProvider(id, input: Partial<ProviderProfileInput>)                   // isActive/sortOrder ignored for self
setProviderServices(providerId, [{ serviceId, locationId? }]): Promise<RepoResult<true>>   // own: active services only
setBusinessHours(providerId, [{ weekday, startMinute, endMinute }]): Promise<RepoResult<CmsBusinessHours[]>>
setAvailabilityExceptions(providerId, [{ date, kind, startMinute?, endMinute?, note? }])
  : Promise<RepoResult<CmsAvailabilityException[]>>                        // replaces today-and-later rows
storeGoogleConnection(providerId, { accessToken, refreshToken, expiresAt }, googleEmail)
  : Promise<RepoResult<ProviderSummary>>
disconnectGoogle(providerId): Promise<RepoResult<true>>                    // revokes at Google (best effort)

// Bookings — booking.read(.own) / booking.manage(.own)
listBookings({ scope?, range? = 'upcoming', providerId?, serviceId?, status?, withinDays?, limit? })
  : Promise<BookingListItem[]>        // + serviceName, providerName, locationName, locationKind; no token hash
getBooking(id): Promise<BookingListItem | null>
cancelBooking(id, by?: 'provider' | 'admin'): Promise<RepoResult<BookingListItem>>
setBookingStatus(id, status): Promise<RepoResult<BookingListItem>>        // 'cancelled' → cancelBooking
getBookingStats(): Promise<{ scope; upcoming; today; next7Days; createdLast30Days; cancelledLast30Days; googleFailed }>

// Schemas for forms
serviceInputSchema, locationInputSchema, providerProfileSchema,
businessHoursRowSchema, availabilityExceptionRowSchema
```

Scope rules: `listBookings` defaults to `all` with `booking.read`, else `own`;
asking for `all` without `booking.read` throws `CmsAuthError('forbidden')`.
`range: 'upcoming'` means "not yet ended" (ascending); `past` and `all` sort
descending. `cancelBooking` defaults `by` to `provider` for one's own booking
and `admin` otherwise. A cancelled booking cannot be revived. Every write
audits (`service.*`, `location.*`, `provider.*`, `booking.cancel`,
`booking.status`) and calls `revalidateContent({ tags: [BOOKING_TAG] })`.
`CMS_TAGS` in `src/lib/cms/content.ts` is **not** changed.

### `google.ts` (server-only)

```ts
GOOGLE_SCOPES   // calendar.events, calendar.freebusy, openid, email
isGoogleConfigured(): boolean
buildAuthUrl({ state, redirectUri, loginHint? }): string        // access_type=offline, prompt=consent
exchangeCode(code, redirectUri): Promise<GoogleTokens>          // { accessToken, refreshToken, expiresAt, scope, idToken, email }
refreshAccessToken(refreshToken): Promise<{ accessToken; expiresAt; scope }>
getFreeBusy({ accessToken, calendarId, timeMin, timeMax }): Promise<{ start; end }[]>
insertEvent({ accessToken, calendarId, event, sendUpdates = 'none' }): Promise<{ id; htmlLink }>
deleteEvent({ accessToken, calendarId, eventId, sendUpdates? }): Promise<void>   // 404/410 = success
revokeToken(token), fetchGoogleEmail(accessToken), emailFromIdToken(idToken)
encryptSecret(plain): string          // 'v1.<iv>.<tag>.<ciphertext>' (AES-256-GCM, base64url)
decryptSecret(value): string | null   // null when malformed or the key changed
GoogleApiError { status; code }       // code 'invalid_grant' = revoked
```

### `provider-calendar.ts` (server-only)

```ts
getProviderBusy(provider: CmsProvider, timeMin, timeMax): Promise<{ start; end }[]>   // [] when not connected or failing
createProviderEvent(provider, booking): Promise<{ status; eventId; error }>           // writes google_* on the booking
cancelProviderEvent(provider, booking): Promise<{ status; eventId; error }>
getProviderAccessToken(provider): Promise<string | null>, isProviderConnected(provider)
```

`error`, and whatever `recordProviderError()` stores on the provider, is always the fixed text
from `describeProviderError()` in `provider-calendar-errors.ts` (§7), never the caught error's
own message.

### `src/lib/email/*`

```ts
sendEmail({ to, subject, html, text, attachments?, replyTo? })
  : Promise<{ sent: true; id } | { sent: false; reason }>   // never throws; no key → 'not_configured'
  // reason: 'no_recipient' | 'not_configured' | 'missing_from' | 'HTTP <status>[: <Resend code>]' | 'request_failed: <ErrorName>'
buildIcs({ uid, startsAt, endsAt, summary, description?, location?, url?, method?: 'PUBLISH'|'CANCEL', sequence?, reminderMinutes? })
icsUidFor(bookingId, host?), icsDate, icsEscape, icsFold
bookingConfirmationEmail(data), providerNotificationEmail(data), bookingCancellationEmail(data, 'customer'|'provider')
  → { subject, html, text }
```

---

## 6. Availability algorithm

For one provider and one local date `D` (`computeSlots`):

1. **Window.** `D` must lie between today and today + `horizonDays` (local
   dates in the booking time zone).
2. **Open ranges.** Business hours for `D`'s weekday; a `closed` exception
   without minutes removes them all; `open` exceptions add ranges (also on a
   closed day); `closed` exceptions with minutes cut ranges out. Ranges are
   merged and clamped to the day.
3. **Grid.** Candidate starts are local minutes `m` with `m % slotStepMinutes
   === 0` counted **from local midnight** (a 09:15 opening with a 30 min grid
   starts at 09:30). A local time that does not exist (spring forward) or
   exists twice (fall back, 02:00–03:00) is skipped.
4. **Fit.** `[start, start + duration)` must lie inside one open range. The
   **buffer may run past closing** (a 90 min fit at 16:30 is fine with hours
   until 18:00).
5. **Conflicts.** `[start, start + duration + buffer)` must not overlap any
   Google busy interval or any non-cancelled booking extended by *its* own
   buffer. Intervals are half-open (inclusive start, exclusive end), so a slot
   may start exactly when a busy block ends. `buffer = service.bufferAfterMinutes ??
   rules.defaultBufferAfterMinutes`.
6. **Notice.** `start >= now + minNoticeHours`.

Conversions use `localMinutesToInstant` (two-pass `tzOffset`) and `TZDate`,
so every slot is exactly `duration` real minutes long, also on 2026-10-25.
"Iedereen" = run per provider, then `mergeSlots()`. When the customer books
"Iedereen", `createPublicBooking` picks the first free provider in admin order.

---

## 7. Google Calendar flow

```
/admin/agenda ── Verbind ──► GET /api/google/oauth/start?provider=<id>      (Worker D)
                               signed state cookie, buildAuthUrl({ state, redirectUri })
Google consent ────────────► GET /api/google/oauth/callback                 (Worker D)
                               verify state → exchangeCode() → tokens.email (id_token)
                               → repo.storeGoogleConnection(providerId, tokens, email)
                               → /admin/agenda?google=connected|error
```

- Redirect URI: `${siteUrl()}/api/google/oauth/callback`.
- Scopes: `calendar.events`, `calendar.freebusy` + `openid email` (so the
  callback can read the account e-mail from the `id_token` without an extra
  call). `access_type=offline` + `prompt=consent` → Google always returns a
  refresh token. Publish the consent screen ("In production") or refresh tokens
  expire after 7 days (see `booking-runbook.md`).
- Tokens are encrypted with AES-256-GCM (`src/lib/sealed-box.ts`, shared with
  the e-mail API key and the TOTP secrets) before they touch the database. Key:
  `GOOGLE_TOKEN_ENCRYPTION_KEY` (base64, 32 bytes), else HKDF-SHA256 of
  `CMS_SESSION_SECRET` (info `google-token`). **Rotating either value makes
  the stored tokens unreadable: every provider must reconnect Google.** The
  admin card then shows the recorded `google_sync_error`.
- Reading: `getProviderBusy()` refreshes the access token when it expires
  within 60 s, calls `freeBusy` on `google_calendar_id` (default `primary`),
  and on any failure returns `[]` and records `google_sync_error`.
  Availability then still honours business hours and bookings.
- Writing: after a booking is inserted, `createProviderEvent()` creates an
  event **without attendees** (summary "Dienst — Klant", contact details and
  notes in the description, `extendedProperties.private.bookingId`) and sets
  `google_sync_status` to `synced`, `failed` (+ error) or `none` (not
  connected). Cancelling deletes the event (404/410 count as done).
- **What `google_sync_error` holds.** Only the fixed text from `describeProviderError()`
  (`provider-calendar-errors.ts`), on the provider and on the booking. A revoked or expired
  grant (`invalid_grant`) gives "Google-toegang is ingetrokken of verlopen. Verbind Google
  Agenda opnieuw."; another Google refusal gives "Google Agenda gaf een fout (HTTP 503,
  invalid_client)." with at most an HTTP error status (400–599) and a short lower-case code;
  anything else (a failed query, a network error) gives "De synchronisatie met Google Agenda
  is mislukt (TypeError)." with at most the error's class name. Never Google's own message
  (it can echo the event, so the customer's details), a query's SQL or bound values (the
  token update binds the encrypted access token), or a stack. Rows written before
  14 Oct 2026 may still hold older text until the next sync write for that provider or
  booking replaces or clears it.
- **What the OAuth callback logs.** Fixed codes only: `[google-oauth] code_exchange_failed`
  when `exchangeCode()` throws, `[google-oauth] store_refused` when `storeGoogleConnection()`
  answers `ok: false` (provider missing, no refresh token, key problem) and
  `[google-oauth] store_failed` when it throws. Never Google's `error_description` (the
  `GoogleApiError` message) or a failed query's text, which binds the encrypted tokens and the
  account e-mail; Google's own `?error=` value is not logged either. The `reason` in the
  redirect is unchanged (`booking-runbook.md` §10).

---

## 8. E-mail flow

Sent by `notifications.ts` through `sendEmail()` (Resend REST API,
`https://api.resend.com/emails`). Key, sender and reply-to come from `loadEmailSettings()`
(`src/lib/email/settings.ts`): per field `RESEND_API_KEY` / `EMAIL_FROM` / `EMAIL_REPLY_TO`
win over what an admin stored in `/admin/email` (see `cms-architecture.md`, "Site settings
keys"). No key → one console line (only the number of recipients) and
`{ sent: false, reason: 'not_configured' }`. A failing mail never fails a
booking.

**What is logged.** `sendEmail()`'s log lines and its `reason` carry only the number of
recipients, the HTTP status, Resend's error code (its `name`, only when it is a plain code such
as `validation_error`) and the name of a thrown error (`TimeoutError`, `TypeError`): a refusal is
`HTTP 422: validation_error` (or just `HTTP 502`), a request without a response
`request_failed: TimeoutError`. Never logged or returned: the subject (booking subjects hold the
customer's name), any address (not even masked), the body, Resend's error `message` (it can echo
the request) or an error's message, and never the key; `redactSecrets()` still runs on top. The
admin test mail shows that reason; its audit entry and the gift voucher log keep only a code
(`provider_error` / `provider`). The full refusal text is in Resend's own dashboard. The
settings store logs fixed codes only: `[email] api_key_store_failed` when the key could not be
written, `[email] stored_settings_unreadable` when the row could not be read (usually migration
0004 not applied; the environment variables still apply). Neither carries anything of the
error: the driver error's text and `params` hold the ciphertext and the hint.

The gift voucher order form (`src/lib/gift-voucher/`, `booking-runbook.md` §12) uses the same
`sendEmail()` with the opposite rule: there the mail *is* the order, so a skipped or failed send
is reported to the visitor as "niet verstuurd" and only a provider-accepted send counts as
success. It mails the studio's order inbox (env `GIFT_VOUCHER_RECIPIENT`, else `/admin/email` →
*Ontvanger cadeaubonbestellingen*; never `contact.email`, `src/lib/gift-voucher/recipient.ts`)
with the visitor as Reply-To, never the visitor. Its server action logs
`[cadeaubon] order_action_failed` and nothing else when anything throws (a failed rate-limit
query binds the client IP); the delivery helper's own lines,
`[cadeaubon] aanvraag niet verstuurd (<code>)`, carry one of four fixed reason codes
(`reasonCode()` in `delivery.ts`), never the provider's text.

| Event | Customer (+ guardian e-mail if different) | Provider (`cms_providers.email` or login e-mail) |
| --- | --- | --- |
| Booked | "Je afspraak is bevestigd" + `afspraak.ics` (`METHOD:PUBLISH`, UTC times, `UID <bookingId>@<site host>`, 24 h reminder) + cancel link `${siteUrl()}/afspraak/annuleren/<token>` + deadline | "Nieuwe afspraak" with all details, reply-to = customer |
| Cancelled by customer (link) | "Je afspraak is geannuleerd" + `.ics` `METHOD:CANCEL` | notified |
| Cancelled by admin | same, "we moesten je afspraak helaas annuleren" | notified |
| Cancelled by provider | same | not notified (they did it) |

Templates are plain text + inline-styled HTML in the studio palette (bone
`#fdfbf7`, ink `#2a1219`, burgundy `#3e1420`), no images, all user input
HTML-escaped. Reminder mails are not built yet; they can hang off the same
module later.

---

## 9. Public booking flow

`createPublicBooking(input)`:

1. Validation, without a query (§5, `public-booking.ts`): the zod parse caps every raw field,
   then the honeypot (step 2), then the field rules with Dutch messages, length before
   pattern → `invalid` + `fieldErrors`.
2. Honeypot `website` non-empty → `invalid` (checked between the parse and the field rules).
3. Rate limit, **reserve then check** (`rate-limit-policy.ts`, `src/lib/rate-limit.ts`,
   table `cms_rate_limits`): at most 5 attempts per 15 minutes for **each** key on its own,
   in this order:
   - the client IP, `booking:ip:<ip>`, only when it parses as an IPv4/IPv6 address
     (`normalizeIp()`). An unknown or malformed IP is never a shared key; the e-mail rule
     then applies alone;
   - the customer's e-mail and, when given and different, the guardian's (who gets the
     confirmation too), both `booking:email:<SHA-256 hex of the trimmed, lower-cased
     address>`. One namespace, so an address gets 5 attempts whether it is typed as
     customer or as guardian. The counters store the hash, never the address (the old
     `cms_booking_rate_limit` rows held it in plain text); a hash is a pseudonym, kept at
     most a day.

   Rows untouched for a day are pruned first. Then each key gets one hit in ONE statement,
   `INSERT … ON CONFLICT (scope) DO UPDATE SET hits = <hits in the window> || now WHERE
   <hits in the window> < 5 RETURNING`, decided on the key's own row. A full key: the hits
   already taken are given back (one `UPDATE` per key, removing exactly one occurrence of
   this attempt's timestamp) and the answer is `rate_limited` ("Te veel boekingen op korte
   tijd. Probeer het over een kwartier opnieuw of bel ons."). Only then are the service and
   the slot looked at. An attempt that got past the limit **keeps** its hits whatever
   happens next (`slot_taken`, a later `invalid`, `error`, a booking): every attempt
   counts, as before.

   *Why one statement per key.* Until 0008 the check counted rows (`SELECT count(*) … WHERE
   email = $e OR ip_address = $ip`) and recorded the attempt in a second statement.
   neon-http has no interactive transactions (every statement is its own READ COMMITTED
   transaction, and drizzle-orm 0.45.2 throws on `db.transaction()` there), so a parallel
   burst (one HTTP/2 connection is enough) read the same count before any insert landed:
   self-test 14b let 20 of 20 parallel attempts from one IP through with that code, each of
   which could have been a confirmed booking, a Google event and mail from the studio's
   verified sender to an address of the attacker's choosing. The upsert cannot be raced: Postgres
   locks the conflicting row and evaluates the `WHERE` and `SET` on its latest committed
   version, so parallel reservations of one key queue on that row (the same pattern as the
   second-step limits, `cms-architecture.md` §4, Rate limiting).

   *Failure modes.* A database error in the prune or a reservation ends in the catch-all
   (`error`, `[booking] create_failed`, nothing of the error logged). A hit taken before
   such an error, or one whose give-back failed, stays until it leaves the 15-minute window:
   that request is refused, nobody is locked out beyond the window. Without the table (0008
   not applied) every attempt fails closed this way.
4. Service must be active; guardian required for `requiresGuardian`.
5. **Fresh** `getAvailability()` for that day (live bookings + Google). The
   exact start must be offered → otherwise `slot_taken`.
6. Location resolved (§5); address required for `customer` locations.
7. Insert (`status confirmed`, `google_sync_status pending`, token hash). A
   unique-index race → `slot_taken`.
8. Google event → e-mails → `recordAudit(db, null, { action: 'booking.create' })`.

Cancel token: 32 random bytes, base64url (43 chars); only `sha256(token)` hex
is stored. `cancelBookingByToken()` allows cancelling until `cancelUntilHours`
(48 h) before the start, then deletes the Google event, mails both parties and
audits `booking.cancel` with no actor.

**What is logged.** Nothing of a caught error, anywhere on the booking path. A failed query
arrives as Drizzle's `DrizzleQueryError`, whose message and `params` carry every bound value
(names, e-mail addresses, phone numbers, notes, address, the cancel-token hash, the client IP
of the rate-limit query, an encrypted Google token), and the Neon or PGlite driver error
behind it repeats them; even its `name` or `code` is decided by the thrower, so no field of it
is kept. Instead each catch binds no error (`catch {`) and calls
`logBookingFailure(event, bookingId?)` (`booking-log.ts`), which writes one line,
`[booking] <event>`, followed by `{ event, bookingId? }`:

| Event | Where |
| --- | --- |
| `create_failed` | the `createPublicBooking()` catch-all; no booking id, the insert may not have happened |
| `google_event_failed`, `confirmation_mail_failed` | after the insert, with the booking id |
| `cancel_failed` | the `cancelBookingByToken()` catch-all |
| `google_delete_failed`, `cancellation_mail_failed` | after the status update, with the booking id |
| `availability_action_failed`, `book_action_failed`, `cancel_action_failed` | the catch-alls of the widget's server actions (`public-actions.ts`); no booking id |
| `confirmation_ref_unsigned` | `bookAction()`: the booking stands, only the signed confirmation URL is skipped; with the booking id |
| `admin_google_delete_failed`, `admin_cancellation_mail_failed` | `cancelBooking()` in `repo.ts` (admin and provider cancellations), with the booking id |

`bookingId` is included only when it is a UUID. `BookingLogEvent` is a closed union: every
call site passes a literal, and `booking-log.test.ts` lists all twelve, so a new event is a
type error until that list is updated. The cancel page logs
`[booking] cancel_page_lookup_failed` and nothing else when the look-up throws. An error
nobody catches (a page's own read) is still printed by Next in full (§13).

---

## 10. Environment variables

All optional; defined in `src/lib/env.ts`, documented in `.env.example`.

| Variable | Used by | Notes |
| --- | --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | `google.ts` | "Web application" OAuth client. `features.googleCalendar`. |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | `google.ts` | base64 of 32 bytes (`openssl rand -base64 32`). Rotating signs providers out of Google. |
| `GA4_PROPERTY_ID`, `GA4_SERVICE_ACCOUNT_JSON` | Worker D (`src/lib/analytics`) | `features.ga4Data` = service account present. |
| `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | `email/settings.ts` → `email/send.ts` | Optional: the same values can be stored in `/admin/email`; env wins per field. `features.email` = env key present only. |

Secrets are read through `src/lib/env.ts` (zod-validated, read at call time so
scripts and the self-test can set them before use) and derived through
`src/lib/secrets.ts`, which holds the single dev-pepper fallback and throws in
production when `CMS_SESSION_SECRET` is missing. No module reads `process.env`
directly (CLAUDE.md §3).

---

## 11. Seeding and running

```bash
npm run db:migrate                                    # applies 0002 + 0003
CMS_BOOTSTRAP_PASSWORD='…' npm run cms:bootstrap      # + booking setting, 2 locations, 5 services
npm run cms:seed-booking                              # provider toshoni@gmail.com, hours, subscriptions
PROVIDER_EMAIL=x@y.be PROVIDER_NAME='X' npm run cms:seed-booking   # another provider
```

Bootstrap adds (idempotent, never overwrites): the `booking` setting, the
default location **"De Bikefit Studio, Ninove"** (studio, no street address,
`is_default`), a second location **"Bij jou thuis"** (kind `customer`, which
the Fit aan huis service needs) and the five services (Volwassenenfit 90,
Jeugdfit 60 + guardian, Gezinspakket 150, Fit aan huis 120 → "Bij jou thuis",
Inspanningstest 60; prices null and hidden, buffer 15). Choice labels "Volwassene" and
"Jeugd" go on the first two; on a database that already has them (migration 0009 added the
column empty), bootstrap fills only a label that is still empty and touches nothing else on
the row (`~ service nl/jeugdfit: empty choice label set to “Jeugd”`).

`cms:seed-booking` (idempotent): user with role `provider` and
`must_change_password`, temporary password **printed once**; profile at the
default location; Mon–Fri 09:00–18:00 + Sat 09:00–13:00 (only when the
provider has no hours yet); subscriptions to the five services. It never
touches Google.

---

## 12. Testing

```bash
npm run cms:selftest
```

Sections 10–14 cover: the 8 booking tables + `provider` enum value; the
permission matrix (provider has exactly the 6 contract permissions, no `service.create` since
16 Oct 2026, rank 0,
label); `computeSlots` (hours incl. several ranges per day, busy overlap
edges, buffer incl. null fallback and past-closing, min notice, horizon,
closed/partial/open exceptions, step grid, DST 2026-10-25 and 2027-03-28,
merge); `sendEmail` without a key; ICS (UTC `DTSTART`/`DTEND`, `UID`, CRLF,
75-octet folding, escaping, `METHOD:CANCEL`); templates (escaping, no
images); token encryption (round trip, tamper, wrong key); and the full flow
on PGlite with a provider without Google: repo CRUD as admin and as provider
(scope checks), public lists, availability, validation, honeypot, create,
token hash, `google_sync_status = 'none'`, audit, re-check → `slot_taken`,
the partial unique index, rate limit, admin/provider lists and stats,
look-up / too late / cancel / already cancelled, provider cancel, no revival.

Section **14c** (`scripts/selftest/service-catalogue.mts`): migration 0009 (column, one guarded
statement, re-run twice); as the provider, `createService()` and `createServiceAction` refused
(no row); on a service whose `created_by` is that provider, `updateService()`,
`deleteService()` and the update / deactivate / reactivate actions refused, the row unchanged,
nothing audited; subscribing the own profile to an active service, never to an inactive one
(repo and action), keeping a since-deactivated subscription, unsubscribing, another
provider's profile forbidden; the admin edits, prices, deactivates and reactivates, and
`choice_label` round-trips. Section 14 also checks that `0470 12 34 56` is stored as
`+32 470 12 34 56`.

Section **14b** (`scripts/selftest/booking-rate-limit.mts`) tests the rate limit under
parallel requests through the real `createPublicBooking()` (a throwaway service, a start in
2020, so an attempt that passes the limit stops at the slot check as `slot_taken`; nothing is
booked or mailed): migration 0008 (columns, index, additive, `cms_booking_rate_limit`
unchanged, re-run twice); the helper on its own (12 parallel reservations in one millisecond →
exactly 5, a release frees exactly one of five equal timestamps, a full later scope keeps
nothing in the earlier one, hits older than the window do not count, a row untouched for a day
is pruned); then four bursts of 20 parallel attempts, each with exactly 5 passing: one IP with
20 e-mails (the IP key holds 5 hits), one e-mail from 20 IPs (5 hits; every refused attempt
gave its IP hit back), no usable IP (missing or malformed: no IP key written) and one guardian
e-mail for 20 customers and IPs (both earlier hits of a refused attempt given back); the stored
keys hold no address; bookings no longer write `cms_booking_rate_limit`; with the table renamed
away (a database without 0008) an attempt answers `error` with one `[booking] create_failed`
line. Against the old count-then-insert code the same bursts let 20, 20, 10 and 20 of 20
through (in the third, all ten without an IP passed; the ten with the malformed IP `unknown`
were refused only because the old code matched them against every stored `'unknown'` row, one
shared bucket). The sequential check in section 14 (5 attempts reach the slot check, the 6th is
`rate_limited`) is unchanged. PGlite has one connection, so this proves the interleaving of
separate awaits, which is what defeated the old check; the row lock under truly concurrent
Neon sessions is Postgres' documented `ON CONFLICT DO UPDATE` behaviour, not exercised here.

Unit tests (vitest, next to the modules) cover the pure parts. For logging and error
persistence: `booking-log.test.ts` builds Drizzle-, Neon- and PGlite-shaped failures with a
distinctive dummy value in every field the flow binds (customer and guardian data, notes,
address, raw token, hash, client IP, encrypted Google token, an HTTP body), offers them to
`logBookingFailure()` in the old `(event, error, id)` call shape behind a proxy that records
every read, and asserts that nothing was read and that none of it reaches what
`console.error` receives or prints, plus the twelve event codes and the `isUniqueViolation()`
rules; `public-booking.test.ts` drives `createPublicBooking()` and `cancelBookingByToken()`
into their catch-alls against a database mock whose queries fail (a failed prune, a failed
reservation of the first or second key, a failed give-back: each the generic error and one
`[booking] create_failed` line without the IP, the address or its hash) and checks the
`rate_limited` answer of a full key, before the service is looked up;
`rate-limit-policy.test.ts` checks the keys (known, unknown, malformed and IPv6 addresses, a
port, the hashed and lower-cased e-mail, the guardian, the order, the limits);
`public-actions.test.ts` does the same for the three server actions and the unsigned
confirmation ref, with what they call mocked to reject with such a failure; and
`provider-calendar-errors.test.ts` checks `describeProviderError()` with the real
`GoogleApiError` and a Drizzle-shaped failure.

For input size (input review 2026-10-14 §8): `public-booking-input.test.ts` pins the limits and
raw caps, checks every field at and one over its cap (the cap's message equals the rule's),
every field's message at once, the unchanged messages for ordinary input, and, with a spy on
`RegExp.prototype.exec` (which every pattern method calls), that no pattern ever sees more than
a field's limit, even when the rules get a value the schema would have refused;
`public-booking.test.ts` sends over-long e-mails and phone numbers (just over the limit, at and
just over the raw cap, 1000 characters) through `createPublicBooking()`: each is answered
`invalid` with the field's message, no pattern beyond the limit, zero queries, nothing logged.

For the offer step and the phone (16 Oct 2026): `phone.test.ts` (national, international,
`0032`, `+32 0…`, landlines, never a second prefix, idempotent, foreign, rejects);
`public-booking-input.test.ts` (both phones accepted and refused, `storedPhone()`);
`src/components/studio/booking/details.test.ts` (adult and Jeugdfit guardian phone sent
normalized, the lone `+32 ` counts as empty); `catalogue.test.ts` (`groupBookingChoices()`:
the seeded offers give "Bikefit – huidige fiets" once with Volwassenenfit and Jeugdfit and the
other three services directly, every service reachable exactly once, order, unbookable slugs,
two offers on one service, gift voucher, labels); `service-choice.test.ts` (open offer, meta
and summary lines, "Prijs op aanvraag"); `src/lib/cms/actions/services.test.ts` (the four
service actions called directly as a provider, also on a service with their `created_by`, and
as an editor: refused before the row is read, nothing written; the admin succeeds; the
subscription action: active only, kept inactive, other provider refused).

---

## 13. Decisions and open points

- **Extra scopes `openid email`**: needed for the account e-mail in the
  OAuth callback; both are non-sensitive.
- **`google_access_token` is encrypted too**, although the contract only
  required the refresh token to be.
- **Partial unique index** on confirmed (`provider_id`, `starts_at`), which
  the contract did not list.
- **`buffer_after_minutes` is nullable** (default 15): null = the setting's
  default, matching `service.bufferAfterMinutes ?? rules.default`.
- **`buildIcs(event)`** takes an explicit `IcsEventInput`, not a DB row;
  `notifications.ts` maps the booking.
- **`insertEvent` defaults to `sendUpdates: 'none'`**. With no attendees the
  value has no effect.
- **The service catalogue is admin-only** (16 Oct 2026, replacing "providers can edit and
  deactivate services they created"): §3. `created_by` stays as a record of who created a
  row, nothing more.
- `listPublicServices()` hides services nobody offers. After bootstrap and
  before `cms:seed-booking`, the public list is empty.
- `setAvailabilityExceptions()` replaces only today-and-later rows. Past rows
  stay as history.
- No overlap check **between providers** (one studio, two fitters at the same
  time is allowed), and no travel time for Fit aan huis.
- No reminder e-mails yet. There is no cron job; they need a scheduled job later.
- **Booking logs and `google_sync_error` carry no personal data** (14 Oct 2026, §7 and §9).
  The public flows, the widget's server actions, the admin cancel path in `repo.ts`, the
  OAuth callback, the e-mail settings store and the server-action wrapper
  `src/lib/cms/actions/run.ts` log fixed codes only. Still open: an error nobody catches (a
  page's own read, `getCurrentCmsUser()` in the callback) is printed by Next with its full
  message, and a Drizzle query error's message holds the SQL and every bound value. Closing
  that needs a change at the query layer (strip `params` from what it throws), not more catch
  blocks. `describeProviderError()` still keeps a validated Google code and an error's class
  name in `google_sync_error` (§7); dropping those too is an owner decision.
- **The public booking limit is one race-free reservation per key** (14 Oct 2026, review
  finding R-2; §9 step 3, migration 0008). A new table, `cms_rate_limits`, rather than
  `cms_mfa_rate_limits` with a null user (that table belongs to the second step: its schema,
  `clearMfaAttempts()` and the MFA self-test's clean-up own its rows) or the old
  `cms_booking_rate_limit` (a log of rows cannot express an atomic per-key reservation, and the
  gift voucher store still uses it, so it is neither dropped nor altered; the booking rows left
  in it age out through the voucher requests' prune and `cms:retention`).
  **Semantics changed slightly:** the old rule counted the attempts of "this e-mail OR this IP"
  together against one limit of 5; now each key has its own 5 (5 per IP **and** 5 per e-mail).
  The bound per IP and per address is the same; an attempt whose IP and e-mail each have fewer
  than 5 but together 5 or more is now allowed. **Stricter:** the guardian e-mail, which
  receives the confirmation as well, is a key too. Only a valid IP is a key (the old code used
  whatever text it was handed; through `public-actions.ts` that was already a validated address
  or null). **Unchanged on purpose:** every attempt that passes keeps its hits,
  including `slot_taken` and successes (no give-back on outcome: review R-4/R-11 left open);
  the gift voucher limit (R-3) still counts and inserts on `cms_booking_rate_limit`; the
  second-step limiter keeps its own copy of the same statements in
  `src/lib/cms/mfa/rate-limit.ts` and can move onto `src/lib/rate-limit.ts` later (its
  `user_id` column serves `clearMfaAttempts()`). Not covered: an IPv6 visitor who rotates
  addresses inside their /64 counts as many IPs (the e-mail key still holds per address).

---

## 14. Offer ↔ booking catalogue and service preselection (13 Oct 2026)

The public site now speaks in **offers** (`/aanbod/<slug>`, `cms-architecture.md` §14); booking
still speaks in **services** (`cms_services`). The two are linked explicitly, never by renaming.

**What did not change.** No migration. No `cms_services` row was created, renamed, re-priced or
deactivated; no `cms_provider_services` row was added; existing bookings keep their service id
and name. The staging rollout verifies this (`guardCounts()`: booking count, service ids/slugs/
durations/active flags hashed, provider and provider-service counts — before and after).

**The link.** Each `offer` block has `bookingServiceSlugs` (editable, one `cms_services.slug`
per line). The decisions for the five existing services, with reasons, are in
`BOOKING_RECONCILIATION` (`src/lib/offers/defaults.ts`) and tested in
`src/lib/offers/catalogue.test.ts`:

| Booking service | Decision | Offer |
| --- | --- | --- |
| `volwassenenfit` (90 min) | linked | Bikefit – huidige fiets |
| `jeugdfit` (60 min, guardian) | linked | Bikefit – huidige fiets |
| `gezinspakket` | kept, not in the offer | — |
| `fit-aan-huis` | kept, not in the offer | — |
| `inspanningstest` | kept, **not** equated with Lactaattest | — |

"Kept" services stay active and bookable from `/afspraak` without a preselection until Toshoni
decides otherwise (Admin → Diensten; deactivating is soft). Open decisions:
`content-placeholders.md` §6.

**Preselection.** The offer page's button goes to `/afspraak?dienst=<offer slug>#boeken`. The
catch-all route validates `dienst` (`parseServiceParam`: a lower-case slug, ≤ 80 chars, else
ignored) and the `booking` block resolves it on the server with `resolveBookingSelection()`:

| `?dienst=` | Result |
| --- | --- |
| absent / malformed | the normal widget |
| an offer linked to ≥ 1 bookable service | the widget **narrowed** to those services in the offer's order (preselected when exactly one), with "Je boekt voor <offer>" above the steps |
| an offer with no bookable service (none linked, inactive, or nobody offers it) | **no widget**: a contact prompt naming the offer (phone; e-mail with the offer in the subject once *Instellingen → Contact → e-mail* is set; links back to the offer and the full offer). Never another service, never invented availability |
| a booking-service slug (`?dienst=jeugdfit`) | the widget with that service preselected |
| an unknown slug | the normal widget with "We vonden de gekozen dienst niet terug." |

An offer slug wins over a service slug with the same name. "Opnieuw" after a booking returns to
the same preselection. The widget's other rules (provider choice, availability, guardian,
address) are unchanged.

**Making another offer bookable** (once its duration and the people who offer it are
confirmed): an **admin** creates the service in Admin → Diensten with the real duration (and
price, if it should show in the widget; and a *Keuzelabel* if the offer will link several
services); the provider subscribes to it themself (or an admin does so on their confirmed
behalf); then put the service's slug in the offer block's *Online boeken via dienst(en)* field
and publish the offer page. No deploy, no migration.

### One offer, its services underneath (16 Oct 2026)

Toshoni's decision for `/afspraak`: **one** "Bikefit – huidige fiets" choice with
**Volwassene / Jeugd** underneath, not two top-level fits; every other active, bookable
service stays directly selectable (Gezinspakket, Fit aan huis, Inspanningstest), until Max or
Toshoni decide otherwise.

*Data model, no duplication.* Three things, each kept in one place:

| What | Where | Managed by |
| --- | --- | --- |
| The canonical service: name, **choice label**, duration, buffer, **price** (`price_cents` + `show_price`), location, guardian rule, active | `cms_services` (0009 added `choice_label`) | admin only (§3) |
| Which services an offer is booked as, in order | the offer block's `bookingServiceSlugs` (*Online boeken via dienst(en)*), on the published offer page | editor / admin, in the page editor |
| Who offers a service, with an optional location override | `cms_provider_services` (no price, no duration) | the provider for their own profile, or an admin |

No service price is copied to an offer or provider, and no new price exists:
both services keep `price_cents = null`, `show_price = false`, so the widget
says "Prijs op aanvraag" until an admin sets and shows an approved amount on
**that service**. The offer block still stores legacy editorial `priceCents`
and `priceLabel`, but for any offer linked to booking services the public
catalogue and detail page ignore those independent fields and show "Prijs op
aanvraag". Otherwise a CMS editor could disclose a numeric offer price while
the linked service's `show_price` is false. Once approved prices and their
presentation are decided, offer-page variants must be derived from the linked
service rows; no `vanaf` amount is inferred now. Unlinked enquiry offers keep
their editorial price behavior (`content-placeholders.md` P-02). Admin →
Diensten shows per service which published offer links to it.

*The widget.* The `booking` block always reads the published offers (cached; on failure the
widget is the flat list it was) and passes `groupBookingChoices({ offers, services })`
(`src/lib/offers/catalogue.ts`) to the widget: a service a published offer links to appears
once, under that offer, in the offer's order; the offer takes the place of its first service;
an offer with one bookable service selects it straight away; a service two offers link
belongs to the first offer in catalogue order. Step 1 then shows the offer's button
(`aria-expanded`), and under it "Voor wie?" with one button per service, labelled with its
choice label (else its name), its own duration, "met ouder of voogd" for Jeugdfit and its own
price or "Prijs op aanvraag". **Only a service is ever selected**: its id is what availability
is fetched for and what `bookAction` books, so its duration, buffer, guardian form, location
and booking row follow; the done-line reads "Bikefit – huidige fiets · Jeugd · 60 minuten ·
met ouder of voogd · Prijs op aanvraag"; *Wijzigen* reopens the offer so switching is one tap;
the confirmation and the e-mails name the booked service ("Jeugdfit"), as the server stores
it. The server needs no offer: `createPublicBooking()` re-reads the service by id (§9).

*`?dienst=`, unchanged in meaning.* An offer slug narrows to its bookable services (now shown
as that offer with its choices, nothing preselected when there are two); a service slug
(`?dienst=jeugdfit`) preselects it, with its offer open; an offer without a bookable service
still gets the named contact prompt; an unknown slug the normal widget and the notice.
