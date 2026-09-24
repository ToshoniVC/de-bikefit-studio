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
| `src/lib/booking/content.ts` | server-only | public read API (cached lists, live availability) |
| `src/lib/booking/repo.ts` | server-only | admin write API (`RepoResult<T>`) |
| `src/lib/booking/public-booking.ts` | server-only | anonymous create / look up / cancel by token |
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
| `cms_services` | `locale` (`nl`), `slug` (unique per locale), `name`, `description`, `duration_minutes`, `buffer_after_minutes` (default 15, **null = setting default**), `price_cents` (null), `show_price` (false), `location_id` (null = provider default), `requires_guardian`, `is_active`, `sort_order`, `color`, `created_by`. |
| `cms_providers` | 1:1 with `cms_users` (`user_id` unique, cascade). `display_name`, `bio`, `phone`, `email` (public), `timezone`, `default_location_id`, Google: `google_calendar_id` (`primary` once connected), `google_refresh_token_enc`, `google_access_token` (**also encrypted**), `google_access_expires_at`, `google_email`, `google_connected_at`, `google_sync_error`; `is_active`, `sort_order`. |
| `cms_provider_services` | PK (`provider_id`, `service_id`), `location_id` = per-provider override. |
| `cms_business_hours` | `weekday` 0–6 (0 = Sunday), `start_minute`/`end_minute` = minutes since local midnight, end exclusive. Several rows per weekday. |
| `cms_availability_exceptions` | `date` (local), `kind` `closed`\|`open`, optional minutes, `note`. Unique (`provider_id`, `date`, `kind`, `start_minute`). |
| `cms_bookings` | service (restrict), provider (restrict), location (set null), `starts_at`/`ends_at` (UTC), `timezone`, `status` (`confirmed`\|`cancelled`\|`completed`\|`no_show`), customer + guardian fields, `bike_details`, `notes`, `customer_address`, `cancel_token_hash` (unique, SHA-256 hex), `cancelled_at`, `cancelled_by` (`customer`\|`provider`\|`admin`), `google_event_id`, `google_sync_status` (`pending`\|`synced`\|`failed`\|`none`), `google_sync_error`, `source` (`web`). |
| `cms_booking_rate_limit` | `ip_address`, `email`, `attempted_at`: one row per public booking attempt (mirror of `cms_login_attempts`, pruned after 1 day). |

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

Both are **additive only** and idempotent (verified by migrating a fresh
PGlite twice). Note that drizzle's migrator runs *all pending files in one
transaction*, so on a fresh database `0002` and `0003` share a transaction.
That is fine because Postgres only forbids **using** a new enum value in the transaction
that added it, and nothing in `0003` references `'provider'`. Users with that role
are created afterwards (bootstrap / seed / admin).

Generated with two `drizzle-kit generate --name=…` runs, so
`drizzle/meta/0002_snapshot.json` → `0003_snapshot.json` form a correct chain
and future `db:generate` runs diff cleanly.

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
| `service.create` | create a service | ✅ | ❌ | ✅ |
| `service.manage` | edit / deactivate any service | ❌ | ❌ | ✅ |
| `service.subscribe.own` | choose own services | ✅ | ❌ | ✅ |
| `location.read` / `location.manage` | locations | ✅ / ❌ | ✅ / ❌ | ✅ |
| `provider.read` / `provider.manage` | all providers | ❌ | ✅ / ❌ | ✅ |
| `provider.self` | own profile, hours, exceptions, Google | ✅ | ❌ | ✅ |
| `analytics.read` | GA4 dashboard panel | ❌ | ❌ | ✅ |

`ROLE_PERMISSIONS` is now exported. `ROLE_RANK = { provider: 0, editor: 1,
admin: 2 }`, so `requireCmsUser('editor')` keeps providers out of content
screens. Gate booking screens on permissions, not on rank.
`ROLE_LABELS.provider = 'Aanbieder'`.

"Own" is resolved server-side: the repo looks up the `cms_providers` row whose
`user_id` is the signed-in user (`getCurrentCmsUser()`). A provider may also edit or
deactivate **services they created themselves** (`created_by`); everything
else needs `service.manage`.

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
rate-limit key (it would lump every visitor together).

`getBookingByCancelToken()` is for the `/afspraak/annuleren/[token]` page:
show what would be cancelled on GET, cancel only on a POST/server action.

### `repo.ts` (server-only, admin)

```ts
// Services — service.read / service.create / service.manage (or creator)
listServices({ includeInactive?, locale? }): Promise<ServiceListItem[]>   // + locationName, providerCount
getService(id): Promise<CmsService | null>
createService(input: ServiceInput): Promise<RepoResult<CmsService>>       // provider creator auto-subscribed
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
setProviderServices(providerId, [{ serviceId, locationId? }]): Promise<RepoResult<true>>
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

### `src/lib/email/*`

```ts
sendEmail({ to, subject, html, text, attachments?, replyTo? })
  : Promise<{ sent: true; id } | { sent: false; reason }>   // never throws; no key → 'not_configured'
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
- Tokens are encrypted with AES-256-GCM before they touch the database. Key:
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

---

## 8. E-mail flow

Sent by `notifications.ts` through `sendEmail()` (Resend REST API,
`https://api.resend.com/emails`, `Authorization: Bearer RESEND_API_KEY`, from
`EMAIL_FROM`, optional `EMAIL_REPLY_TO`). No key → one console line (recipients masked) and
`{ sent: false, reason: 'not_configured' }`. A failing mail never fails a
booking.

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

1. zod structural parse; field rules with Dutch messages → `invalid` + `fieldErrors`.
2. Honeypot `website` non-empty → `invalid`.
3. Rate limit: ≥ 5 attempts in 15 min for this e-mail **or** this IP →
   `rate_limited`. Then the attempt is recorded (and rows > 1 day pruned).
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

---

## 10. Environment variables

All optional; defined in `src/lib/env.ts`, documented in `.env.example`.

| Variable | Used by | Notes |
| --- | --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | `google.ts` | "Web application" OAuth client. `features.googleCalendar`. |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | `google.ts` | base64 of 32 bytes (`openssl rand -base64 32`). Rotating signs providers out of Google. |
| `GA4_PROPERTY_ID`, `GA4_SERVICE_ACCOUNT_JSON` | Worker D (`src/lib/analytics`) | `features.ga4Data` = service account present. |
| `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | `email/send.ts` | `features.email`. |

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
Inspanningstest 60; prices null and hidden, buffer 15).

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
permission matrix (provider has exactly the 7 contract permissions, rank 0,
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
- **Providers can edit and deactivate services they created** (`created_by`),
  in addition to `service.manage`.
- `listPublicServices()` hides services nobody offers. After bootstrap and
  before `cms:seed-booking`, the public list is empty.
- `setAvailabilityExceptions()` replaces only today-and-later rows. Past rows
  stay as history.
- No overlap check **between providers** (one studio, two fitters at the same
  time is allowed), and no travel time for Fit aan huis.
- No reminder e-mails yet. There is no cron job; they need a scheduled job later.
