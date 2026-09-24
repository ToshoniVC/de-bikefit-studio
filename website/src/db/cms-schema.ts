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
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

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

export const cmsRoleEnum = pgEnum('cms_role', ['admin', 'editor']);
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
// Relations
// ---------------------------------------------------------------------------

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

/** Public-safe projection of a CMS user (never carries `passwordHash`). */
export type CmsUserPublic = Omit<CmsUser, 'passwordHash'>;
