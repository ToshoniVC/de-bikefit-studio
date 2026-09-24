import 'server-only';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { unstable_cache } from 'next/cache';
import { getCmsDb } from '@/db/cms';
import {
  cmsMedia,
  cmsMediaBlobs,
  cmsNavigation,
  cmsPages,
  cmsRedirects,
  cmsSiteSettings,
  DEFAULT_LOCALE,
} from '@/db/cms-schema';
import {
  defaultSiteSettings,
  isSiteSettingKey,
  parsePublishedSnapshot,
  parseSiteSetting,
  validateNavigationItems,
  type NavigationItem,
  type NavigationKey,
  type PublishedSnapshot,
  type SiteSettings,
} from './blocks';

/**
 * Public content read API — the ONLY module the public site uses to reach the
 * database. Worker C: import from here, never from `@/db/cms` directly.
 *
 * Two rules that make the public site fast and predictable:
 *
 *  1. **Published snapshots only.** `getPublishedPage()` reads
 *     `cms_pages.published_snapshot`, never `cms_blocks`. Draft edits are
 *     therefore invisible until someone presses Publish.
 *  2. **Everything is tag-cached.** Each reader is wrapped in `unstable_cache`
 *     with the tags in {@link CMS_TAGS}; `revalidateContent()` in `repo.ts`
 *     busts them on write. (`cacheComponents` / `use cache` is not enabled in
 *     this app, so `unstable_cache` is the supported API here — see
 *     `next/dist/docs/01-app/02-guides/caching-without-cache-components.md`.)
 *
 * Values crossing an `unstable_cache` boundary are serialised, so every date in
 * these return types is an ISO string, never a `Date`.
 */

export const CMS_TAGS = {
  /** Everything content-ish; used as a blunt "publish happened" bust. */
  all: 'cms',
  pages: 'cms:pages',
  page: (locale: string, slug: string) => `cms:page:${locale}:${slug}`,
  navigation: 'cms:navigation',
  settings: 'cms:settings',
  redirects: 'cms:redirects',
  media: 'cms:media',
  mediaItem: (id: string) => `cms:media:${id}`,
} as const;

/** Short revalidation window so a missed tag bust self-heals. */
const REVALIDATE_SECONDS = 300;

export type PublishedPage = {
  id: string;
  locale: string;
  slug: string;
  translationGroup: string;
  title: string;
  kind: string;
  /** ISO 8601. */
  publishedAt: string | null;
  updatedAt: string;
  snapshot: PublishedSnapshot;
};

export type PublishedPageSummary = {
  id: string;
  locale: string;
  slug: string;
  translationGroup: string;
  title: string;
  publishedAt: string | null;
  updatedAt: string;
  noIndex: boolean;
};

export type CmsMediaItem = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  alt: Record<string, string>;
  storage: 'db' | 'blob';
  storageKey: string | null;
  url: string | null;
};

export type CmsRedirectMatch = {
  toPath: string;
  statusCode: number;
};

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

/** Normalises a public path to the form stored in `cms_pages.slug`. */
export function normalizeSlug(slug: string): string {
  return slug.replace(/^\/+/, '').replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/**
 * A single published page. `slug` may be given with or without a leading
 * slash; the home page is the empty string (or `'/'`).
 *
 * Returns null when the page does not exist, is still a draft, or has a
 * snapshot that no longer validates against the block registry.
 */
export async function getPublishedPage(
  locale: string,
  slug: string,
): Promise<PublishedPage | null> {
  const normalizedSlug = normalizeSlug(slug);
  const load = unstable_cache(
    async () => {
      const db = await getCmsDb();
      const [row] = await db
        .select()
        .from(cmsPages)
        .where(
          and(
            eq(cmsPages.locale, locale),
            eq(cmsPages.slug, normalizedSlug),
            eq(cmsPages.status, 'published'),
          ),
        )
        .limit(1);

      if (!row) return null;

      const snapshot = parsePublishedSnapshot(row.publishedSnapshot);
      if (!snapshot) return null;

      return {
        id: row.id,
        locale: row.locale,
        slug: row.slug,
        translationGroup: row.translationGroup,
        title: row.title,
        kind: row.kind,
        publishedAt: iso(row.publishedAt),
        updatedAt: iso(row.updatedAt)!,
        snapshot,
      } satisfies PublishedPage;
    },
    ['cms-published-page', locale, normalizedSlug],
    { tags: [CMS_TAGS.all, CMS_TAGS.pages, CMS_TAGS.page(locale, normalizedSlug)], revalidate: REVALIDATE_SECONDS },
  );
  return load();
}

/** Every published page for a locale — the source for `sitemap.ts`. */
export async function listPublishedPages(
  locale: string = DEFAULT_LOCALE,
): Promise<PublishedPageSummary[]> {
  const load = unstable_cache(
    async () => {
      const db = await getCmsDb();
      const rows = await db
        .select({
          id: cmsPages.id,
          locale: cmsPages.locale,
          slug: cmsPages.slug,
          translationGroup: cmsPages.translationGroup,
          title: cmsPages.title,
          publishedAt: cmsPages.publishedAt,
          updatedAt: cmsPages.updatedAt,
          noIndex: cmsPages.noIndex,
        })
        .from(cmsPages)
        .where(and(eq(cmsPages.locale, locale), eq(cmsPages.status, 'published')))
        .orderBy(asc(cmsPages.slug));

      return rows.map((row) => ({
        ...row,
        publishedAt: iso(row.publishedAt),
        updatedAt: iso(row.updatedAt)!,
      })) satisfies PublishedPageSummary[];
    },
    ['cms-published-pages', locale],
    { tags: [CMS_TAGS.all, CMS_TAGS.pages], revalidate: REVALIDATE_SECONDS },
  );
  return load();
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/** Ordered menu items. Returns `[]` for an unknown or unset menu. */
export async function getNavigation(
  locale: string,
  key: NavigationKey | string,
): Promise<NavigationItem[]> {
  const load = unstable_cache(
    async () => {
      const db = await getCmsDb();
      const [row] = await db
        .select({ items: cmsNavigation.items })
        .from(cmsNavigation)
        .where(and(eq(cmsNavigation.locale, locale), eq(cmsNavigation.menuKey, key)))
        .limit(1);

      if (!row) return [];
      const parsed = validateNavigationItems(row.items);
      return parsed.ok ? parsed.items : [];
    },
    ['cms-navigation', locale, key],
    { tags: [CMS_TAGS.all, CMS_TAGS.navigation], revalidate: REVALIDATE_SECONDS },
  );
  return load();
}

// ---------------------------------------------------------------------------
// Site settings
// ---------------------------------------------------------------------------

/**
 * All site settings for a locale, with schema defaults filled in for any key
 * that is missing or invalid — so this never throws and never returns
 * `undefined` fields.
 */
export async function getSiteSettings(locale: string = DEFAULT_LOCALE): Promise<SiteSettings> {
  const load = unstable_cache(
    async () => {
      const db = await getCmsDb();
      const rows = await db
        .select({ key: cmsSiteSettings.key, value: cmsSiteSettings.value })
        .from(cmsSiteSettings)
        .where(eq(cmsSiteSettings.locale, locale));

      const settings = defaultSiteSettings();
      for (const row of rows) {
        if (isSiteSettingKey(row.key)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (settings as any)[row.key] = parseSiteSetting(row.key, row.value);
        }
      }
      return settings;
    },
    ['cms-site-settings', locale],
    { tags: [CMS_TAGS.all, CMS_TAGS.settings], revalidate: REVALIDATE_SECONDS },
  );
  return load();
}

// ---------------------------------------------------------------------------
// Redirects
// ---------------------------------------------------------------------------

/**
 * Looks up an enabled redirect for a path. Matching is exact on the path with
 * a leading slash and no query string; trailing slashes are ignored.
 *
 * Intended for a `not-found` boundary or a route handler — NOT for middleware,
 * which must stay database-free.
 */
export async function findRedirect(path: string): Promise<CmsRedirectMatch | null> {
  const normalized = normalizeRedirectPath(path);
  const load = unstable_cache(
    async () => {
      const db = await getCmsDb();
      const [row] = await db
        .select({ toPath: cmsRedirects.toPath, statusCode: cmsRedirects.statusCode })
        .from(cmsRedirects)
        .where(and(eq(cmsRedirects.fromPath, normalized), eq(cmsRedirects.isEnabled, true)))
        .limit(1);
      return row ?? null;
    },
    ['cms-redirect', normalized],
    { tags: [CMS_TAGS.all, CMS_TAGS.redirects], revalidate: REVALIDATE_SECONDS },
  );
  return load();
}

export function normalizeRedirectPath(path: string): string {
  const withoutQuery = path.split('?')[0].split('#')[0];
  const withLeadingSlash = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, '') : '/';
}

/** All enabled redirects — for an admin overview or a bulk export. */
export async function listRedirects(): Promise<Array<CmsRedirectMatch & { fromPath: string }>> {
  const load = unstable_cache(
    async () => {
      const db = await getCmsDb();
      return db
        .select({
          fromPath: cmsRedirects.fromPath,
          toPath: cmsRedirects.toPath,
          statusCode: cmsRedirects.statusCode,
        })
        .from(cmsRedirects)
        .where(eq(cmsRedirects.isEnabled, true))
        .orderBy(asc(cmsRedirects.fromPath));
    },
    ['cms-redirects'],
    { tags: [CMS_TAGS.all, CMS_TAGS.redirects], revalidate: REVALIDATE_SECONDS },
  );
  return load();
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/** Media metadata (never the bytes). Soft-deleted media resolves to null. */
export async function getMedia(id: string): Promise<CmsMediaItem | null> {
  const load = unstable_cache(
    async () => {
      const db = await getCmsDb();
      const [row] = await db
        .select({
          id: cmsMedia.id,
          filename: cmsMedia.filename,
          mimeType: cmsMedia.mimeType,
          sizeBytes: cmsMedia.sizeBytes,
          width: cmsMedia.width,
          height: cmsMedia.height,
          alt: cmsMedia.alt,
          storage: cmsMedia.storage,
          storageKey: cmsMedia.storageKey,
          url: cmsMedia.url,
        })
        .from(cmsMedia)
        .where(and(eq(cmsMedia.id, id), isNull(cmsMedia.deletedAt)))
        .limit(1);
      return row ?? null;
    },
    ['cms-media', id],
    { tags: [CMS_TAGS.all, CMS_TAGS.media, CMS_TAGS.mediaItem(id)], revalidate: REVALIDATE_SECONDS },
  );
  return load();
}

/**
 * Public URL for a media item:
 *  - `blob`  → the stored CDN URL
 *  - `db`    → `/api/cms/media/<id>` (route handler owned by Worker B)
 */
export function mediaUrl(media: Pick<CmsMediaItem, 'id' | 'storage' | 'url'>): string {
  if (media.storage === 'blob' && media.url) return media.url;
  return `/api/cms/media/${media.id}`;
}

/** Alt text for a locale, falling back to Dutch and then the empty string. */
export function mediaAlt(media: Pick<CmsMediaItem, 'alt'>, locale: string): string {
  return media.alt?.[locale] ?? media.alt?.[DEFAULT_LOCALE] ?? '';
}

/**
 * Raw bytes for `storage = 'db'` media. NOT cached — it streams through the
 * media route handler, which sets its own long-lived `Cache-Control`.
 *
 * Driver gotcha: PGlite hands `bytea` back as a `Uint8Array`, while neon-http
 * returns the Postgres hex-escape string (`\x89504e47…`). {@link toBuffer}
 * normalises both.
 */
export async function getMediaBytes(
  id: string,
): Promise<{ data: Buffer; mimeType: string; filename: string } | null> {
  const db = await getCmsDb();
  const [row] = await db
    .select({
      data: cmsMediaBlobs.data,
      mimeType: cmsMedia.mimeType,
      filename: cmsMedia.filename,
    })
    .from(cmsMediaBlobs)
    .innerJoin(cmsMedia, eq(cmsMedia.id, cmsMediaBlobs.mediaId))
    .where(and(eq(cmsMediaBlobs.mediaId, id), isNull(cmsMedia.deletedAt)))
    .limit(1);

  if (!row) return null;
  return { data: toBuffer(row.data), mimeType: row.mimeType, filename: row.filename };
}

/** Normalises whatever the active driver returns for a `bytea` column. */
export function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') {
    return value.startsWith('\\x')
      ? Buffer.from(value.slice(2), 'hex')
      : Buffer.from(value, 'binary');
  }
  return Buffer.alloc(0);
}
