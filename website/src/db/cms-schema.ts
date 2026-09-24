/**
 * CMS schema — De Bikefit Studio public site + admin.
 *
 * Every table is prefixed `cms_` and lives in this file, separate from the
 * Qarakter webshop schema in `./schema.ts`. Nothing here touches, alters or
 * references the webshop tables (`users`, `products`, `orders`, `order_items`),
 * so migrations generated from this file are purely additive.
 *
 * Multi-language by design, Dutch-only in practice for now:
 *  - every localisable row carries a `locale` text column defaulting to `'nl'`;
 *  - pages that are translations of one another share a `translation_group` key;
 *  - uniqueness is always scoped by locale, e.g. unique `(locale, slug)`.
 *
 * Draft/publish model: `cms_blocks` holds the *draft* block list for a page.
 * Publishing freezes the rendered blocks + SEO into `cms_pages.published_snapshot`.
 * The public site reads ONLY `published_snapshot` — never `cms_blocks`.
 */
import {
  pgTable,
  pgEnum,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
  customType,
  date,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Raw binary column for image bytes stored in Postgres (staging fallback). */
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType: () => 'bytea',
});

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).defaultNow().notNull();

/** Default (and, for now, only published) locale. */
export const DEFAULT_LOCALE = 'nl' as const;

// ---------------------------------------------------------------------------
// Enums
//
// Only genuinely closed sets are real Postgres enums. Open-ended sets (locale,
// menu key, block type, media storage backend, structured-data type) are plain
// `text` validated by zod in `src/lib/cms/*`, so adding a value later never
// needs an `ALTER TYPE` migration.
// ---------------------------------------------------------------------------

/**
 * `provider` (Aanbieder) was added by `drizzle/0002_role_provider.sql`, in a
 * migration file of its own: Postgres cannot use a freshly added enum value in
 * the transaction that added it.
 */
export const cmsRoleEnum = pgEnum('cms_role', ['admin', 'editor', 'provider']);
export const cmsPageStatusEnum = pgEnum('cms_page_status', ['draft', 'published']);

export type CmsRole = (typeof cmsRoleEnum.enumValues)[number];
export type CmsPageStatus = (typeof cmsPageStatusEnum.enumValues)[number];

// ---------------------------------------------------------------------------
// Auth: users, sessions, rate limiting
// ---------------------------------------------------------------------------

/**
 * CMS operators. Completely separate from the webshop's Clerk-backed `users`
 * table: the shop's customers must never be able to reach /admin.
 *
 * `email` is always stored lower-cased and trimmed (normalised by
 * `src/lib/cms/auth.ts`); the unique constraint therefore behaves
 * case-insensitively in practice.
 */
export const cmsUsers = pgTable(
  'cms_users',
  {
    id: id(),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    role: cmsRoleEnum('role').default('editor').notNull(),
    passwordHash: text('password_hash').notNull(),
    mustChangePassword: boolean('must_change_password').default(false).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (t) => [index('cms_users_role_idx').on(t.role)],
);

/**
 * Opaque server-side sessions. The raw token only ever exists in the
 * `cms_session` cookie; the database stores a SHA-256 hash of it, so a database
 * leak does not hand out live sessions.
 */
export const cmsSessions = pgTable(
  'cms_sessions',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => cmsUsers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).defaultNow().notNull(),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
  },
  (t) => [
    index('cms_sessions_user_id_idx').on(t.userId),
    index('cms_sessions_expires_at_idx').on(t.expiresAt),
  ],
);

/**
 * One row per login attempt, used for simple rate limiting
 * (see `CMS_LOGIN_*` in `src/lib/cms/auth.ts`). Rows older than the window are
 * pruned opportunistically on each login.
 */
export const cmsLoginAttempts = pgTable(
  'cms_login_attempts',
  {
    id: id(),
    email: text('email').notNull(),
    ipAddress: text('ip_address').default('unknown').notNull(),
    successful: boolean('successful').default(false).notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('cms_login_attempts_email_time_idx').on(t.email, t.attemptedAt),
    index('cms_login_attempts_ip_time_idx').on(t.ipAddress, t.attemptedAt),
  ],
);

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/**
 * Media metadata. `storage` selects where the bytes live:
 *  - `'db'`   → `cms_media_blobs.data` (default; works on staging with no
 *               Vercel Blob credentials), served by an admin/public route.
 *  - `'blob'` → Vercel Blob; `storage_key` holds the blob pathname and `url`
 *               the public CDN URL. See docs/cms-architecture.md § Media.
 *
 * `alt` is per-locale, e.g. `{"nl": "Rutger meet de zadelhoogte"}`.
 * Deletion is always soft (`deleted_at`); blob rows are never hard-deleted.
 */
export const cmsMedia = pgTable(
  'cms_media',
  {
    id: id(),
    filename: text('filename').notNull(),
    mimeType: text('mime').notNull(),
    sizeBytes: integer('size_bytes').default(0).notNull(),
    width: integer('width'),
    height: integer('height'),
    alt: jsonb('alt').$type<Record<string, string>>().default({}).notNull(),
    storage: text('storage').$type<'db' | 'blob'>().default('db').notNull(),
    storageKey: text('storage_key'),
    url: text('url'),
    createdBy: text('created_by').references(() => cmsUsers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('cms_media_deleted_at_idx').on(t.deletedAt),
    index('cms_media_created_at_idx').on(t.createdAt),
  ],
);

/** Image bytes for `storage = 'db'` media. Separate table so metadata queries stay cheap. */
export const cmsMediaBlobs = pgTable('cms_media_blobs', {
  mediaId: text('media_id')
    .primaryKey()
    .references(() => cmsMedia.id, { onDelete: 'cascade' }),
  data: bytea('data').notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Pages + blocks
// ---------------------------------------------------------------------------

export const cmsPages = pgTable(
  'cms_pages',
  {
    id: id(),
    locale: text('locale').default(DEFAULT_LOCALE).notNull(),
    /** URL path without a leading slash; the home page uses the empty string. */
    slug: text('slug').notNull(),
    /** Links the same page across locales. Stable, never shown to visitors. */
    translationGroup: text('translation_group').notNull(),
    title: text('title').notNull(),
    /** Rendering template, e.g. 'default' | 'home' | 'landing'. */
    kind: text('kind').default('default').notNull(),
    status: cmsPageStatusEnum('status').default('draft').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    /**
     * Frozen `{ blocks, seo, title, kind, publishedAt }` captured at publish
     * time. The public site renders this and nothing else.
     */
    publishedSnapshot: jsonb('published_snapshot').$type<unknown>(),

    // --- SEO ---
    metaTitle: text('meta_title'),
    metaDescription: text('meta_description'),
    canonicalOverride: text('canonical_override'),
    ogTitle: text('og_title'),
    ogDescription: text('og_description'),
    ogImageMediaId: text('og_image_media_id').references(() => cmsMedia.id, {
      onDelete: 'set null',
    }),
    noIndex: boolean('no_index').default(false).notNull(),
    /** e.g. 'WebPage' | 'LocalBusiness' | 'FAQPage' | 'Service' | 'none'. */
    structuredDataType: text('structured_data_type'),
    structuredDataOverrides: jsonb('structured_data_overrides').$type<Record<string, unknown>>(),

    updatedBy: text('updated_by').references(() => cmsUsers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('cms_pages_locale_slug_key').on(t.locale, t.slug),
    uniqueIndex('cms_pages_locale_translation_group_key').on(t.locale, t.translationGroup),
    index('cms_pages_status_idx').on(t.status),
    index('cms_pages_translation_group_idx').on(t.translationGroup),
  ],
);

/**
 * Draft content blocks for a page, ordered by `sort_order`.
 * `type` matches a key of `blockRegistry` in `src/lib/cms/blocks.ts`;
 * `data` is validated against that block's zod schema before it is written.
 */
export const cmsBlocks = pgTable(
  'cms_blocks',
  {
    id: id(),
    pageId: text('page_id')
      .notNull()
      .references(() => cmsPages.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').default(0).notNull(),
    type: text('type').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('cms_blocks_page_id_sort_order_idx').on(t.pageId, t.sortOrder)],
);

// ---------------------------------------------------------------------------
// Navigation, redirects, settings, audit
// ---------------------------------------------------------------------------

/**
 * One row per (locale, menu). `items` is an ordered JSON array:
 *   [{ "label": "Bikefit", "href": "/bikefit", "external": false,
 *      "children": [{ "label": "Jeugdfit", "href": "/bikefit#jeugd" }] }]
 *
 * Chosen over normalised rows deliberately: menus are small, always read and
 * written whole, and drag-to-reorder in the admin becomes a single UPDATE.
 * Shape is validated by `navigationItemsSchema` in `src/lib/cms/blocks.ts`.
 */
export const cmsNavigation = pgTable(
  'cms_navigation',
  {
    id: id(),
    locale: text('locale').default(DEFAULT_LOCALE).notNull(),
    /** 'main' | 'footer' (open set — validated in zod, not by a PG enum). */
    menuKey: text('menu_key').notNull(),
    items: jsonb('items').$type<unknown[]>().default([]).notNull(),
    updatedBy: text('updated_by').references(() => cmsUsers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('cms_navigation_locale_menu_key_key').on(t.locale, t.menuKey)],
);

export const cmsRedirects = pgTable(
  'cms_redirects',
  {
    id: id(),
    /** Absolute path with a leading slash, no origin, no query string. */
    fromPath: text('from_path').notNull().unique(),
    toPath: text('to_path').notNull(),
    statusCode: integer('status_code').default(301).notNull(),
    isEnabled: boolean('is_enabled').default(true).notNull(),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('cms_redirects_enabled_idx').on(t.isEnabled)],
);

/**
 * Key/value site settings per locale. Keys are declared in
 * `SITE_SETTING_KEYS` (`src/lib/cms/blocks.ts`) and each value is a JSON blob
 * validated by its own zod schema.
 */
export const cmsSiteSettings = pgTable(
  'cms_site_settings',
  {
    locale: text('locale').default(DEFAULT_LOCALE).notNull(),
    key: text('key').notNull(),
    value: jsonb('value').$type<unknown>().notNull(),
    updatedBy: text('updated_by').references(() => cmsUsers.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ name: 'cms_site_settings_pkey', columns: [t.locale, t.key] })],
);

/** Lightweight "who did what when". Never deleted by the app. */
export const cmsAuditLog = pgTable(
  'cms_audit_log',
  {
    id: id(),
    userId: text('user_id').references(() => cmsUsers.id, { onDelete: 'set null' }),
    /** Kept denormalised so the trail survives user deletion. */
    userEmail: text('user_email'),
    /** e.g. 'page.publish', 'user.create', 'media.delete'. */
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    summary: text('summary'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index('cms_audit_log_created_at_idx').on(t.createdAt),
    index('cms_audit_log_entity_idx').on(t.entityType, t.entityId),
  ],
);

// ---------------------------------------------------------------------------
// Booking (drizzle/0003_booking.sql) — see docs/booking-architecture.md
//
// Instants are `timestamptz` (UTC); local wall-clock values (business hours,
// exceptions) are minutes since local midnight in the provider's time zone,
// Europe/Brussels by default. Closed sets (location kind, booking status, …)
// are plain `text` validated by zod in `src/lib/booking/*`, like the CMS.
// ---------------------------------------------------------------------------

export type CmsLocationKind = 'studio' | 'customer';
export type CmsBookingStatus = 'confirmed' | 'cancelled' | 'completed' | 'no_show';
export type CmsBookingCancelledBy = 'customer' | 'provider' | 'admin';
export type CmsGoogleSyncStatus = 'pending' | 'synced' | 'failed' | 'none';
export type CmsAvailabilityExceptionKind = 'closed' | 'open';

/**
 * Where a service takes place. `kind = 'customer'` means "at the customer's
 * address" (Fit aan huis): the booking form then asks for an address.
 */
export const cmsLocations = pgTable(
  'cms_locations',
  {
    id: id(),
    name: text('name').notNull(),
    kind: text('kind').$type<CmsLocationKind>().default('studio').notNull(),
    addressLines: jsonb('address_lines').$type<string[]>().default([]).notNull(),
    postalCode: text('postal_code').default('').notNull(),
    city: text('city').default('').notNull(),
    country: text('country').default('BE').notNull(),
    notes: text('notes'),
    isDefault: boolean('is_default').default(false).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('cms_locations_active_sort_idx').on(t.isActive, t.sortOrder)],
);

/**
 * A bookable service. `location_id` null means "the provider's default
 * location" (or the per-provider override in `cms_provider_services`).
 * `buffer_after_minutes` null falls back to the `booking` setting's default.
 */
export const cmsServices = pgTable(
  'cms_services',
  {
    id: id(),
    locale: text('locale').default(DEFAULT_LOCALE).notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').default('').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    bufferAfterMinutes: integer('buffer_after_minutes').default(15),
    priceCents: integer('price_cents'),
    showPrice: boolean('show_price').default(false).notNull(),
    locationId: text('location_id').references(() => cmsLocations.id, { onDelete: 'set null' }),
    /** Jeugdfit: the form asks for a parent/guardian. */
    requiresGuardian: boolean('requires_guardian').default(false).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    color: text('color'),
    createdBy: text('created_by').references(() => cmsUsers.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('cms_services_locale_slug_key').on(t.locale, t.slug),
    index('cms_services_active_sort_idx').on(t.isActive, t.sortOrder),
  ],
);

/**
 * Bookable person, 1:1 with a `cms_users` row (usually role `provider`).
 * Google tokens are AES-256-GCM encrypted by `src/lib/booking/google.ts`;
 * `google_access_token` is encrypted too, although it lives only an hour.
 */
export const cmsProviders = pgTable(
  'cms_providers',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .unique()
      .references(() => cmsUsers.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    bio: text('bio').default('').notNull(),
    phone: text('phone'),
    /** Public contact address; may differ from the login e-mail. */
    email: text('email'),
    timezone: text('timezone').default('Europe/Brussels').notNull(),
    defaultLocationId: text('default_location_id').references(() => cmsLocations.id, {
      onDelete: 'set null',
    }),
    googleCalendarId: text('google_calendar_id'),
    googleRefreshTokenEnc: text('google_refresh_token_enc'),
    googleAccessToken: text('google_access_token'),
    googleAccessExpiresAt: timestamp('google_access_expires_at', { withTimezone: true }),
    googleEmail: text('google_email'),
    googleConnectedAt: timestamp('google_connected_at', { withTimezone: true }),
    googleSyncError: text('google_sync_error'),
    isActive: boolean('is_active').default(true).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('cms_providers_active_sort_idx').on(t.isActive, t.sortOrder)],
);

/** Which provider offers which service, with an optional location override. */
export const cmsProviderServices = pgTable(
  'cms_provider_services',
  {
    providerId: text('provider_id')
      .notNull()
      .references(() => cmsProviders.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => cmsServices.id, { onDelete: 'cascade' }),
    locationId: text('location_id').references(() => cmsLocations.id, { onDelete: 'set null' }),
  },
  (t) => [
    primaryKey({ name: 'cms_provider_services_pkey', columns: [t.providerId, t.serviceId] }),
    index('cms_provider_services_service_idx').on(t.serviceId),
  ],
);

/**
 * Weekly opening hours. `weekday` 0 = Sunday … 6 = Saturday; minutes since
 * local midnight, `end_minute` exclusive. Several rows per weekday allowed.
 */
export const cmsBusinessHours = pgTable(
  'cms_business_hours',
  {
    id: id(),
    providerId: text('provider_id')
      .notNull()
      .references(() => cmsProviders.id, { onDelete: 'cascade' }),
    weekday: integer('weekday').notNull(),
    startMinute: integer('start_minute').notNull(),
    endMinute: integer('end_minute').notNull(),
  },
  (t) => [index('cms_business_hours_provider_idx').on(t.providerId)],
);

/**
 * Date-specific overrides: `closed` (whole day when the minutes are null,
 * otherwise only that range) or `open` (an extra open range on that date).
 */
export const cmsAvailabilityExceptions = pgTable(
  'cms_availability_exceptions',
  {
    id: id(),
    providerId: text('provider_id')
      .notNull()
      .references(() => cmsProviders.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    kind: text('kind').$type<CmsAvailabilityExceptionKind>().notNull(),
    startMinute: integer('start_minute'),
    endMinute: integer('end_minute'),
    note: text('note'),
  },
  (t) => [
    uniqueIndex('cms_availability_exceptions_key').on(t.providerId, t.date, t.kind, t.startMinute),
  ],
);

/**
 * A booking. The raw cancel token only ever exists in the customer's e-mail;
 * the database stores its SHA-256 (`cancel_token_hash`).
 *
 * The partial unique index on (provider_id, starts_at) WHERE status =
 * 'confirmed' is a last line of defence against two visitors grabbing the same
 * slot at the same moment (neon-http cannot hold a transaction).
 */
export const cmsBookings = pgTable(
  'cms_bookings',
  {
    id: id(),
    serviceId: text('service_id')
      .notNull()
      .references(() => cmsServices.id, { onDelete: 'restrict' }),
    providerId: text('provider_id')
      .notNull()
      .references(() => cmsProviders.id, { onDelete: 'restrict' }),
    locationId: text('location_id').references(() => cmsLocations.id, { onDelete: 'set null' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    timezone: text('timezone').default('Europe/Brussels').notNull(),
    status: text('status').$type<CmsBookingStatus>().default('confirmed').notNull(),
    customerName: text('customer_name').notNull(),
    customerEmail: text('customer_email').notNull(),
    customerPhone: text('customer_phone'),
    customerAge: integer('customer_age'),
    guardianName: text('guardian_name'),
    guardianEmail: text('guardian_email'),
    guardianPhone: text('guardian_phone'),
    bikeDetails: text('bike_details'),
    notes: text('notes'),
    /** Only for locations of kind `customer`. */
    customerAddress: text('customer_address'),
    cancelTokenHash: text('cancel_token_hash').unique(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: text('cancelled_by').$type<CmsBookingCancelledBy>(),
    googleEventId: text('google_event_id'),
    googleSyncStatus: text('google_sync_status')
      .$type<CmsGoogleSyncStatus>()
      .default('pending')
      .notNull(),
    googleSyncError: text('google_sync_error'),
    source: text('source').default('web').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('cms_bookings_provider_starts_idx').on(t.providerId, t.startsAt),
    index('cms_bookings_starts_idx').on(t.startsAt),
    index('cms_bookings_customer_email_idx').on(t.customerEmail),
    uniqueIndex('cms_bookings_provider_start_confirmed_key')
      .on(t.providerId, t.startsAt)
      .where(sql`status = 'confirmed'`),
  ],
);

/** One row per public booking attempt; mirrors `cms_login_attempts`. */
export const cmsBookingRateLimit = pgTable(
  'cms_booking_rate_limit',
  {
    id: id(),
    ipAddress: text('ip_address').default('unknown').notNull(),
    email: text('email').default('').notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('cms_booking_rate_limit_email_time_idx').on(t.email, t.attemptedAt),
    index('cms_booking_rate_limit_ip_time_idx').on(t.ipAddress, t.attemptedAt),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const cmsProvidersRelations = relations(cmsProviders, ({ one, many }) => ({
  user: one(cmsUsers, { fields: [cmsProviders.userId], references: [cmsUsers.id] }),
  defaultLocation: one(cmsLocations, {
    fields: [cmsProviders.defaultLocationId],
    references: [cmsLocations.id],
  }),
  services: many(cmsProviderServices),
  hours: many(cmsBusinessHours),
  exceptions: many(cmsAvailabilityExceptions),
  bookings: many(cmsBookings),
}));

export const cmsServicesRelations = relations(cmsServices, ({ one, many }) => ({
  location: one(cmsLocations, { fields: [cmsServices.locationId], references: [cmsLocations.id] }),
  providers: many(cmsProviderServices),
  bookings: many(cmsBookings),
}));

export const cmsProviderServicesRelations = relations(cmsProviderServices, ({ one }) => ({
  provider: one(cmsProviders, {
    fields: [cmsProviderServices.providerId],
    references: [cmsProviders.id],
  }),
  service: one(cmsServices, {
    fields: [cmsProviderServices.serviceId],
    references: [cmsServices.id],
  }),
  location: one(cmsLocations, {
    fields: [cmsProviderServices.locationId],
    references: [cmsLocations.id],
  }),
}));

export const cmsBusinessHoursRelations = relations(cmsBusinessHours, ({ one }) => ({
  provider: one(cmsProviders, {
    fields: [cmsBusinessHours.providerId],
    references: [cmsProviders.id],
  }),
}));

export const cmsAvailabilityExceptionsRelations = relations(
  cmsAvailabilityExceptions,
  ({ one }) => ({
    provider: one(cmsProviders, {
      fields: [cmsAvailabilityExceptions.providerId],
      references: [cmsProviders.id],
    }),
  }),
);

export const cmsBookingsRelations = relations(cmsBookings, ({ one }) => ({
  service: one(cmsServices, { fields: [cmsBookings.serviceId], references: [cmsServices.id] }),
  provider: one(cmsProviders, { fields: [cmsBookings.providerId], references: [cmsProviders.id] }),
  location: one(cmsLocations, { fields: [cmsBookings.locationId], references: [cmsLocations.id] }),
}));

export const cmsUsersRelations = relations(cmsUsers, ({ many }) => ({
  sessions: many(cmsSessions),
  auditEntries: many(cmsAuditLog),
}));

export const cmsSessionsRelations = relations(cmsSessions, ({ one }) => ({
  user: one(cmsUsers, { fields: [cmsSessions.userId], references: [cmsUsers.id] }),
}));

export const cmsPagesRelations = relations(cmsPages, ({ one, many }) => ({
  blocks: many(cmsBlocks),
  ogImage: one(cmsMedia, { fields: [cmsPages.ogImageMediaId], references: [cmsMedia.id] }),
  updatedByUser: one(cmsUsers, { fields: [cmsPages.updatedBy], references: [cmsUsers.id] }),
}));

export const cmsBlocksRelations = relations(cmsBlocks, ({ one }) => ({
  page: one(cmsPages, { fields: [cmsBlocks.pageId], references: [cmsPages.id] }),
}));

export const cmsMediaRelations = relations(cmsMedia, ({ one }) => ({
  blob: one(cmsMediaBlobs, { fields: [cmsMedia.id], references: [cmsMediaBlobs.mediaId] }),
  createdByUser: one(cmsUsers, { fields: [cmsMedia.createdBy], references: [cmsUsers.id] }),
}));

export const cmsMediaBlobsRelations = relations(cmsMediaBlobs, ({ one }) => ({
  media: one(cmsMedia, { fields: [cmsMediaBlobs.mediaId], references: [cmsMedia.id] }),
}));

export const cmsAuditLogRelations = relations(cmsAuditLog, ({ one }) => ({
  user: one(cmsUsers, { fields: [cmsAuditLog.userId], references: [cmsUsers.id] }),
}));

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type CmsUser = typeof cmsUsers.$inferSelect;
export type NewCmsUser = typeof cmsUsers.$inferInsert;
export type CmsSession = typeof cmsSessions.$inferSelect;
export type NewCmsSession = typeof cmsSessions.$inferInsert;
export type CmsLoginAttempt = typeof cmsLoginAttempts.$inferSelect;
export type CmsPage = typeof cmsPages.$inferSelect;
export type NewCmsPage = typeof cmsPages.$inferInsert;
export type CmsBlock = typeof cmsBlocks.$inferSelect;
export type NewCmsBlock = typeof cmsBlocks.$inferInsert;
export type CmsNavigation = typeof cmsNavigation.$inferSelect;
export type CmsMedia = typeof cmsMedia.$inferSelect;
export type NewCmsMedia = typeof cmsMedia.$inferInsert;
export type CmsMediaBlob = typeof cmsMediaBlobs.$inferSelect;
export type CmsRedirect = typeof cmsRedirects.$inferSelect;
export type NewCmsRedirect = typeof cmsRedirects.$inferInsert;
export type CmsSiteSetting = typeof cmsSiteSettings.$inferSelect;
export type CmsAuditLogEntry = typeof cmsAuditLog.$inferSelect;

export type CmsLocation = typeof cmsLocations.$inferSelect;
export type NewCmsLocation = typeof cmsLocations.$inferInsert;
export type CmsService = typeof cmsServices.$inferSelect;
export type NewCmsService = typeof cmsServices.$inferInsert;
export type CmsProvider = typeof cmsProviders.$inferSelect;
export type NewCmsProvider = typeof cmsProviders.$inferInsert;
export type CmsProviderService = typeof cmsProviderServices.$inferSelect;
export type CmsBusinessHours = typeof cmsBusinessHours.$inferSelect;
export type NewCmsBusinessHours = typeof cmsBusinessHours.$inferInsert;
export type CmsAvailabilityException = typeof cmsAvailabilityExceptions.$inferSelect;
export type NewCmsAvailabilityException = typeof cmsAvailabilityExceptions.$inferInsert;
export type CmsBooking = typeof cmsBookings.$inferSelect;
export type NewCmsBooking = typeof cmsBookings.$inferInsert;
export type CmsBookingRateLimitEntry = typeof cmsBookingRateLimit.$inferSelect;

/** Public-safe projection of a CMS user (never carries `passwordHash`). */
export type CmsUserPublic = Omit<CmsUser, 'passwordHash'>;
