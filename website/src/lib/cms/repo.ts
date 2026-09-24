import 'server-only';
import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { revalidatePath, revalidateTag, updateTag } from 'next/cache';
import { getCmsDb, type CmsDatabase } from '@/db/cms';
import {
  cmsAuditLog,
  cmsBlocks,
  cmsMedia,
  cmsMediaBlobs,
  cmsNavigation,
  cmsPages,
  cmsRedirects,
  cmsSiteSettings,
  DEFAULT_LOCALE,
  type CmsAuditLogEntry,
  type CmsBlock,
  type CmsMedia,
  type CmsPage,
  type CmsRedirect,
  type CmsUserPublic,
} from '@/db/cms-schema';
import { recordAudit, requireCmsUser, requirePermission } from './auth';
import {
  defaultDataFor,
  isBlockType,
  isSiteSettingKey,
  parseSiteSetting,
  publishedSnapshotSchema,
  validateBlock,
  validateBlocks,
  validateNavigationItems,
  type BlockType,
  type NavigationKey,
  type PageSeo,
  type SiteSettingKey,
  type SiteSettings,
} from './blocks';
import { sanitizeBlockData } from './actions/sanitize';
import { CMS_TAGS, normalizeRedirectPath, normalizeSlug } from './content';

/**
 * CMS write API — the surface Worker B's server actions sit on.
 *
 * Everything here:
 *  - enforces permissions via `requirePermission()` (see `permissions.ts`),
 *  - writes an audit entry,
 *  - busts the relevant cache tags through `revalidateContent()`.
 *
 * Worker B should wrap these in `'use server'` actions under
 * `src/lib/cms/actions/**` and convert `RepoResult` into form state. Do not
 * call `getCmsDb()` from an action directly — go through these functions so
 * permission checks and auditing cannot be forgotten.
 *
 * NOTE on transactions: the active driver may be neon-http, which cannot hold
 * a real transaction. Multi-statement operations below are ordered so that a
 * partial failure leaves valid data (e.g. a publish writes the snapshot last).
 */

export type RepoResult<T> = { ok: true; data: T } | { ok: false; message: string };

const ok = <T>(data: T) => ({ ok: true as const, data });
const err = (message: string) => ({ ok: false as const, message });

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

export type RevalidateTarget = {
  tags?: string[];
  paths?: string[];
};

/**
 * Busts the caches that `content.ts` reads through. Call after every write
 * that can change what a visitor sees — publishing, navigation, settings,
 * redirects, media.
 *
 * Next 16 notes (important for Workers B and C):
 *  - `revalidateTag(tag)` with one argument is DEPRECATED and fails
 *    typechecking; the signature is now `revalidateTag(tag, profile)`.
 *  - `updateTag(tag)` is the server-action-only variant that gives
 *    read-your-own-writes, i.e. the editor sees the published page
 *    immediately after pressing Publish. We prefer it and fall back to
 *    `revalidateTag(tag, 'max')` when we are not in a server action
 *    (e.g. a route handler or a script).
 *
 * Only legal inside a server action or route handler; `revalidatePath` throws
 * during a plain render.
 */
export function revalidateContent(target: RevalidateTarget = {}): void {
  const tags = new Set<string>([CMS_TAGS.all, ...(target.tags ?? [])]);
  for (const tag of tags) {
    try {
      updateTag(tag);
    } catch {
      revalidateTag(tag, 'max');
    }
  }
  for (const path of target.paths ?? []) revalidatePath(path);
}

/** Public URL for a page, used for targeted `revalidatePath` calls. */
export function publicPathFor(locale: string, slug: string): string {
  const normalized = normalizeSlug(slug);
  // Dutch is the default locale and is served without a prefix.
  const prefix = locale === DEFAULT_LOCALE ? '' : `/${locale}`;
  return normalized ? `${prefix}/${normalized}` : prefix || '/';
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export type PageListItem = Pick<
  CmsPage,
  | 'id'
  | 'locale'
  | 'slug'
  | 'translationGroup'
  | 'title'
  | 'kind'
  | 'status'
  | 'publishedAt'
  | 'updatedAt'
  | 'noIndex'
>;

export async function listPages(locale: string = DEFAULT_LOCALE): Promise<PageListItem[]> {
  await requirePermission('page.read');
  const db = await getCmsDb();
  return db
    .select({
      id: cmsPages.id,
      locale: cmsPages.locale,
      slug: cmsPages.slug,
      translationGroup: cmsPages.translationGroup,
      title: cmsPages.title,
      kind: cmsPages.kind,
      status: cmsPages.status,
      publishedAt: cmsPages.publishedAt,
      updatedAt: cmsPages.updatedAt,
      noIndex: cmsPages.noIndex,
    })
    .from(cmsPages)
    .where(eq(cmsPages.locale, locale))
    .orderBy(asc(cmsPages.slug));
}

export type PageWithBlocks = { page: CmsPage; blocks: CmsBlock[] };

/** A page plus its ordered DRAFT blocks — the admin editor's read model. */
export async function getPageForEdit(pageId: string): Promise<PageWithBlocks | null> {
  await requirePermission('page.read');
  const db = await getCmsDb();

  const [page] = await db.select().from(cmsPages).where(eq(cmsPages.id, pageId)).limit(1);
  if (!page) return null;

  const blocks = await db
    .select()
    .from(cmsBlocks)
    .where(eq(cmsBlocks.pageId, pageId))
    .orderBy(asc(cmsBlocks.sortOrder));

  return { page, blocks };
}

export type CreatePageInput = {
  locale?: string;
  slug: string;
  title: string;
  kind?: string;
  /** Defaults to the slug (or `'home'` for the root page). */
  translationGroup?: string;
};

export async function createPage(input: CreatePageInput): Promise<RepoResult<CmsPage>> {
  const actor = await requirePermission('page.create');
  const db = await getCmsDb();

  const locale = input.locale ?? DEFAULT_LOCALE;
  const slug = normalizeSlug(input.slug);
  const translationGroup = input.translationGroup ?? (slug || 'home');

  const [clash] = await db
    .select({ id: cmsPages.id })
    .from(cmsPages)
    .where(and(eq(cmsPages.locale, locale), eq(cmsPages.slug, slug)))
    .limit(1);
  if (clash) return err(`Er bestaat al een pagina met het pad “/${slug}”.`);

  const [page] = await db
    .insert(cmsPages)
    .values({
      locale,
      slug,
      translationGroup,
      title: input.title.trim(),
      kind: input.kind ?? 'default',
      status: 'draft',
      updatedBy: actor.id,
    })
    .returning();

  await recordAudit(db, actor, {
    action: 'page.create',
    entityType: 'cms_page',
    entityId: page.id,
    summary: `${locale}/${slug}`,
  });
  return ok(page);
}

export type UpdatePageInput = Partial<{
  slug: string;
  title: string;
  kind: string;
  translationGroup: string;
}> &
  Partial<PageSeo>;

/** Updates page metadata and/or SEO. Does not touch blocks or publish state. */
export async function updatePage(
  pageId: string,
  input: UpdatePageInput,
): Promise<RepoResult<CmsPage>> {
  const actor = await requirePermission('page.update');
  const db = await getCmsDb();

  const [existing] = await db.select().from(cmsPages).where(eq(cmsPages.id, pageId)).limit(1);
  if (!existing) return err('Pagina niet gevonden.');

  const slug = input.slug === undefined ? existing.slug : normalizeSlug(input.slug);
  if (slug !== existing.slug) {
    const [clash] = await db
      .select({ id: cmsPages.id })
      .from(cmsPages)
      .where(
        and(eq(cmsPages.locale, existing.locale), eq(cmsPages.slug, slug), ne(cmsPages.id, pageId)),
      )
      .limit(1);
    if (clash) return err(`Er bestaat al een pagina met het pad “/${slug}”.`);
  }

  const [page] = await db
    .update(cmsPages)
    .set({
      slug,
      title: input.title?.trim() ?? existing.title,
      kind: input.kind ?? existing.kind,
      translationGroup: input.translationGroup ?? existing.translationGroup,
      metaTitle: input.metaTitle ?? existing.metaTitle,
      metaDescription: input.metaDescription ?? existing.metaDescription,
      canonicalOverride: input.canonicalOverride ?? existing.canonicalOverride,
      ogTitle: input.ogTitle ?? existing.ogTitle,
      ogDescription: input.ogDescription ?? existing.ogDescription,
      ogImageMediaId: input.ogImageMediaId ?? existing.ogImageMediaId,
      noIndex: input.noIndex ?? existing.noIndex,
      structuredDataType: input.structuredDataType ?? existing.structuredDataType,
      structuredDataOverrides: input.structuredDataOverrides ?? existing.structuredDataOverrides,
      updatedBy: actor.id,
      updatedAt: new Date(),
    })
    .where(eq(cmsPages.id, pageId))
    .returning();

  await recordAudit(db, actor, {
    action: 'page.update',
    entityType: 'cms_page',
    entityId: pageId,
    summary: `${page.locale}/${page.slug}`,
  });

  if (existing.status === 'published') {
    revalidateContent({
      tags: [CMS_TAGS.pages, CMS_TAGS.page(existing.locale, existing.slug)],
      paths: [publicPathFor(existing.locale, existing.slug), publicPathFor(page.locale, page.slug)],
    });
  }
  return ok(page);
}

/** Hard-deletes a page and (by cascade) its draft blocks. */
export async function deletePage(pageId: string): Promise<RepoResult<true>> {
  const actor = await requirePermission('page.delete');
  const db = await getCmsDb();

  const [existing] = await db.select().from(cmsPages).where(eq(cmsPages.id, pageId)).limit(1);
  if (!existing) return err('Pagina niet gevonden.');

  await db.delete(cmsPages).where(eq(cmsPages.id, pageId));
  await recordAudit(db, actor, {
    action: 'page.delete',
    entityType: 'cms_page',
    entityId: pageId,
    summary: `${existing.locale}/${existing.slug}`,
  });
  revalidateContent({
    tags: [CMS_TAGS.pages, CMS_TAGS.page(existing.locale, existing.slug)],
    paths: [publicPathFor(existing.locale, existing.slug)],
  });
  return ok(true);
}

// ---------------------------------------------------------------------------
// Blocks (draft only)
// ---------------------------------------------------------------------------

export async function addBlock(
  pageId: string,
  type: BlockType,
  position?: number,
): Promise<RepoResult<CmsBlock>> {
  const actor = await requirePermission('block.update');
  if (!isBlockType(type)) return err(`Onbekend bloktype: ${type}`);
  const db = await getCmsDb();

  const existing = await db
    .select({ id: cmsBlocks.id })
    .from(cmsBlocks)
    .where(eq(cmsBlocks.pageId, pageId))
    .orderBy(asc(cmsBlocks.sortOrder));

  const index = position ?? existing.length;
  const [block] = await db
    .insert(cmsBlocks)
    .values({ pageId, type, sortOrder: index, data: defaultDataFor(type) })
    .returning();

  // Re-number so inserting in the middle does not collide.
  const order = existing.map((row) => row.id);
  order.splice(index, 0, block.id);
  await applyBlockOrder(db, pageId, order);

  await recordAudit(db, actor, {
    action: 'block.add',
    entityType: 'cms_block',
    entityId: block.id,
    summary: type,
  });
  return ok(block);
}

/**
 * Sanitises `data` (unsafe links refused, rich-text `html` through the
 * allowlist in `actions/sanitize.ts`) and validates it against the block's
 * registry schema before writing. Every block write — the admin action and the
 * seed alike — goes through here, so both store exactly the same HTML.
 */
export async function updateBlock(blockId: string, data: unknown): Promise<RepoResult<CmsBlock>> {
  const actor = await requirePermission('block.update');
  const db = await getCmsDb();

  const [existing] = await db.select().from(cmsBlocks).where(eq(cmsBlocks.id, blockId)).limit(1);
  if (!existing) return err('Blok niet gevonden.');

  const sanitized = sanitizeBlockData(data);
  if (!sanitized.ok) return err(sanitized.message);

  const validated = validateBlock(existing.type, sanitized.data);
  if (!validated.ok) return err(validated.message);

  const [block] = await db
    .update(cmsBlocks)
    .set({ data: validated.data as Record<string, unknown>, updatedAt: new Date() })
    .where(eq(cmsBlocks.id, blockId))
    .returning();

  await recordAudit(db, actor, {
    action: 'block.update',
    entityType: 'cms_block',
    entityId: blockId,
    summary: existing.type,
  });
  return ok(block);
}

export async function deleteBlock(blockId: string): Promise<RepoResult<true>> {
  const actor = await requirePermission('block.update');
  const db = await getCmsDb();

  const [existing] = await db.select().from(cmsBlocks).where(eq(cmsBlocks.id, blockId)).limit(1);
  if (!existing) return err('Blok niet gevonden.');

  await db.delete(cmsBlocks).where(eq(cmsBlocks.id, blockId));

  const remaining = await db
    .select({ id: cmsBlocks.id })
    .from(cmsBlocks)
    .where(eq(cmsBlocks.pageId, existing.pageId))
    .orderBy(asc(cmsBlocks.sortOrder));
  await applyBlockOrder(
    db,
    existing.pageId,
    remaining.map((row) => row.id),
  );

  await recordAudit(db, actor, {
    action: 'block.delete',
    entityType: 'cms_block',
    entityId: blockId,
    summary: existing.type,
  });
  return ok(true);
}

/** `orderedBlockIds` must contain exactly the page's block ids, in the new order. */
export async function reorderBlocks(
  pageId: string,
  orderedBlockIds: string[],
): Promise<RepoResult<true>> {
  const actor = await requirePermission('block.reorder');
  const db = await getCmsDb();

  const existing = await db
    .select({ id: cmsBlocks.id })
    .from(cmsBlocks)
    .where(eq(cmsBlocks.pageId, pageId));

  const existingIds = new Set(existing.map((row) => row.id));
  if (orderedBlockIds.length !== existingIds.size) {
    return err('De nieuwe volgorde bevat niet alle blokken van deze pagina.');
  }
  for (const blockId of orderedBlockIds) {
    if (!existingIds.has(blockId)) return err(`Blok ${blockId} hoort niet bij deze pagina.`);
  }

  await applyBlockOrder(db, pageId, orderedBlockIds);
  await recordAudit(db, actor, {
    action: 'block.reorder',
    entityType: 'cms_page',
    entityId: pageId,
  });
  return ok(true);
}

async function applyBlockOrder(db: CmsDatabase, pageId: string, orderedIds: string[]) {
  for (const [index, blockId] of orderedIds.entries()) {
    await db
      .update(cmsBlocks)
      .set({ sortOrder: index, updatedAt: new Date() })
      .where(and(eq(cmsBlocks.id, blockId), eq(cmsBlocks.pageId, pageId)));
  }
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

/**
 * Freezes the page's draft blocks + SEO into `published_snapshot` and flips the
 * status to `published`. Admin-only.
 *
 * Every block is validated first; if any block fails, nothing is written and
 * the issues come back in the error message so the editor can fix them.
 */
export async function publishPage(pageId: string): Promise<RepoResult<CmsPage>> {
  const actor = await requirePermission('page.publish');
  const db = await getCmsDb();

  const [page] = await db.select().from(cmsPages).where(eq(cmsPages.id, pageId)).limit(1);
  if (!page) return err('Pagina niet gevonden.');

  const blocks = await db
    .select()
    .from(cmsBlocks)
    .where(eq(cmsBlocks.pageId, pageId))
    .orderBy(asc(cmsBlocks.sortOrder));

  const validated = validateBlocks(blocks.map((b) => ({ id: b.id, type: b.type, data: b.data })));
  if (!validated.ok) {
    const issues = validated.issues
      .map((issue) => `blok ${issue.index + 1} (${issue.type}): ${issue.message}`)
      .join(' · ');
    return err(`Publiceren geblokkeerd — ${issues}`);
  }

  const publishedAt = new Date();
  const snapshot = publishedSnapshotSchema.parse({
    version: 1,
    locale: page.locale,
    slug: page.slug,
    translationGroup: page.translationGroup,
    title: page.title,
    kind: page.kind,
    publishedAt: publishedAt.toISOString(),
    seo: {
      metaTitle: page.metaTitle,
      metaDescription: page.metaDescription,
      canonicalOverride: page.canonicalOverride,
      ogTitle: page.ogTitle,
      ogDescription: page.ogDescription,
      ogImageMediaId: page.ogImageMediaId,
      noIndex: page.noIndex,
      structuredDataType: page.structuredDataType,
      structuredDataOverrides: page.structuredDataOverrides,
    },
    blocks: validated.blocks,
  });

  const [updated] = await db
    .update(cmsPages)
    .set({
      status: 'published',
      publishedAt,
      publishedSnapshot: snapshot,
      updatedBy: actor.id,
      updatedAt: publishedAt,
    })
    .where(eq(cmsPages.id, pageId))
    .returning();

  await recordAudit(db, actor, {
    action: 'page.publish',
    entityType: 'cms_page',
    entityId: pageId,
    summary: `${page.locale}/${page.slug}`,
    metadata: { blocks: validated.blocks.length },
  });

  revalidateContent({
    tags: [CMS_TAGS.pages, CMS_TAGS.page(page.locale, page.slug)],
    paths: [publicPathFor(page.locale, page.slug), '/'],
  });
  return ok(updated);
}

/**
 * Takes a page off the public site. The snapshot is deliberately KEPT, so
 * re-publishing without edits restores exactly what was live before.
 */
export async function unpublishPage(pageId: string): Promise<RepoResult<CmsPage>> {
  const actor = await requirePermission('page.unpublish');
  const db = await getCmsDb();

  const [page] = await db.select().from(cmsPages).where(eq(cmsPages.id, pageId)).limit(1);
  if (!page) return err('Pagina niet gevonden.');

  const [updated] = await db
    .update(cmsPages)
    .set({ status: 'draft', updatedBy: actor.id, updatedAt: new Date() })
    .where(eq(cmsPages.id, pageId))
    .returning();

  await recordAudit(db, actor, {
    action: 'page.unpublish',
    entityType: 'cms_page',
    entityId: pageId,
    summary: `${page.locale}/${page.slug}`,
  });
  revalidateContent({
    tags: [CMS_TAGS.pages, CMS_TAGS.page(page.locale, page.slug)],
    paths: [publicPathFor(page.locale, page.slug), '/'],
  });
  return ok(updated);
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export async function updateNavigation(
  locale: string,
  menuKey: NavigationKey | string,
  items: unknown,
): Promise<RepoResult<true>> {
  const actor = await requirePermission('navigation.update');
  const validated = validateNavigationItems(items);
  if (!validated.ok) return err(validated.message);

  const db = await getCmsDb();
  const [existing] = await db
    .select({ id: cmsNavigation.id })
    .from(cmsNavigation)
    .where(and(eq(cmsNavigation.locale, locale), eq(cmsNavigation.menuKey, menuKey)))
    .limit(1);

  if (existing) {
    await db
      .update(cmsNavigation)
      .set({ items: validated.items, updatedBy: actor.id, updatedAt: new Date() })
      .where(eq(cmsNavigation.id, existing.id));
  } else {
    await db
      .insert(cmsNavigation)
      .values({ locale, menuKey, items: validated.items, updatedBy: actor.id });
  }

  await recordAudit(db, actor, {
    action: 'navigation.update',
    entityType: 'cms_navigation',
    entityId: `${locale}:${menuKey}`,
    metadata: { items: validated.items.length },
  });
  revalidateContent({ tags: [CMS_TAGS.navigation], paths: ['/'] });
  return ok(true);
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export type CreateMediaInput = {
  filename: string;
  mimeType: string;
  data: Buffer | Uint8Array;
  width?: number | null;
  height?: number | null;
  alt?: Record<string, string>;
  /** `'db'` stores bytes in Postgres; `'blob'` expects `url` + `storageKey`. */
  storage?: 'db' | 'blob';
  storageKey?: string | null;
  url?: string | null;
};

const MEDIA_MAX_BYTES = 8 * 1024 * 1024;
const MEDIA_ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/svg+xml',
];

export async function createMedia(input: CreateMediaInput): Promise<RepoResult<CmsMedia>> {
  const actor = await requirePermission('media.create');

  if (!MEDIA_ALLOWED_TYPES.includes(input.mimeType)) {
    return err(`Bestandstype ${input.mimeType} is niet toegestaan.`);
  }
  if (input.data.byteLength > MEDIA_MAX_BYTES) {
    return err(`Bestand is te groot (max ${Math.round(MEDIA_MAX_BYTES / 1024 / 1024)} MB).`);
  }

  const db = await getCmsDb();
  const storage = input.storage ?? 'db';

  const [media] = await db
    .insert(cmsMedia)
    .values({
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.data.byteLength,
      width: input.width ?? null,
      height: input.height ?? null,
      alt: input.alt ?? {},
      storage,
      storageKey: input.storageKey ?? null,
      url: input.url ?? null,
      createdBy: actor.id,
    })
    .returning();

  if (storage === 'db') {
    await db.insert(cmsMediaBlobs).values({
      mediaId: media.id,
      data: Buffer.from(input.data),
    });
  }

  await recordAudit(db, actor, {
    action: 'media.create',
    entityType: 'cms_media',
    entityId: media.id,
    summary: input.filename,
  });
  revalidateContent({ tags: [CMS_TAGS.media] });
  return ok(media);
}

export async function listMedia(includeDeleted = false): Promise<CmsMedia[]> {
  await requirePermission('media.read');
  const db = await getCmsDb();
  // `.where()` must come before `.orderBy()` in Drizzle's builder.
  if (includeDeleted) {
    return db.select().from(cmsMedia).orderBy(desc(cmsMedia.createdAt));
  }
  return db
    .select()
    .from(cmsMedia)
    .where(isNull(cmsMedia.deletedAt))
    .orderBy(desc(cmsMedia.createdAt));
}

export async function updateMediaAlt(
  mediaId: string,
  alt: Record<string, string>,
): Promise<RepoResult<true>> {
  const actor = await requirePermission('media.update');
  const db = await getCmsDb();
  await db.update(cmsMedia).set({ alt }).where(eq(cmsMedia.id, mediaId));
  await recordAudit(db, actor, {
    action: 'media.update',
    entityType: 'cms_media',
    entityId: mediaId,
  });
  revalidateContent({ tags: [CMS_TAGS.media, CMS_TAGS.mediaItem(mediaId)] });
  return ok(true);
}

/**
 * SOFT delete only. The row is flagged and disappears from the library and the
 * public site, but `cms_media_blobs` is never touched — a deleted image that
 * is still referenced by an old published snapshot can always be recovered.
 */
export async function deleteMedia(mediaId: string): Promise<RepoResult<true>> {
  const actor = await requirePermission('media.delete');
  const db = await getCmsDb();
  await db.update(cmsMedia).set({ deletedAt: new Date() }).where(eq(cmsMedia.id, mediaId));
  await recordAudit(db, actor, {
    action: 'media.delete',
    entityType: 'cms_media',
    entityId: mediaId,
    summary: 'soft delete',
  });
  revalidateContent({ tags: [CMS_TAGS.media, CMS_TAGS.mediaItem(mediaId)] });
  return ok(true);
}

export async function restoreMedia(mediaId: string): Promise<RepoResult<true>> {
  const actor = await requirePermission('media.delete');
  const db = await getCmsDb();
  await db.update(cmsMedia).set({ deletedAt: null }).where(eq(cmsMedia.id, mediaId));
  await recordAudit(db, actor, {
    action: 'media.restore',
    entityType: 'cms_media',
    entityId: mediaId,
  });
  revalidateContent({ tags: [CMS_TAGS.media, CMS_TAGS.mediaItem(mediaId)] });
  return ok(true);
}

// ---------------------------------------------------------------------------
// Redirects (admin only)
// ---------------------------------------------------------------------------

export async function listAllRedirects(): Promise<CmsRedirect[]> {
  await requirePermission('redirect.read');
  const db = await getCmsDb();
  return db.select().from(cmsRedirects).orderBy(asc(cmsRedirects.fromPath));
}

export type RedirectInput = {
  fromPath: string;
  toPath: string;
  statusCode?: 301 | 302;
  isEnabled?: boolean;
  notes?: string | null;
};

export async function createRedirect(input: RedirectInput): Promise<RepoResult<CmsRedirect>> {
  const actor = await requirePermission('redirect.manage');
  const db = await getCmsDb();

  const fromPath = normalizeRedirectPath(input.fromPath);
  const toPath = input.toPath.trim();
  if (fromPath === normalizeRedirectPath(toPath)) return err('Bron en doel zijn identiek.');

  const [clash] = await db
    .select({ id: cmsRedirects.id })
    .from(cmsRedirects)
    .where(eq(cmsRedirects.fromPath, fromPath))
    .limit(1);
  if (clash) return err(`Er bestaat al een redirect voor ${fromPath}.`);

  const [row] = await db
    .insert(cmsRedirects)
    .values({
      fromPath,
      toPath,
      statusCode: input.statusCode ?? 301,
      isEnabled: input.isEnabled ?? true,
      notes: input.notes ?? null,
    })
    .returning();

  await recordAudit(db, actor, {
    action: 'redirect.create',
    entityType: 'cms_redirect',
    entityId: row.id,
    summary: `${fromPath} → ${toPath}`,
  });
  revalidateContent({ tags: [CMS_TAGS.redirects] });
  return ok(row);
}

export async function updateRedirect(
  redirectId: string,
  input: Partial<RedirectInput>,
): Promise<RepoResult<CmsRedirect>> {
  const actor = await requirePermission('redirect.manage');
  const db = await getCmsDb();

  const [existing] = await db
    .select()
    .from(cmsRedirects)
    .where(eq(cmsRedirects.id, redirectId))
    .limit(1);
  if (!existing) return err('Redirect niet gevonden.');

  const [row] = await db
    .update(cmsRedirects)
    .set({
      fromPath: input.fromPath ? normalizeRedirectPath(input.fromPath) : existing.fromPath,
      toPath: input.toPath?.trim() ?? existing.toPath,
      statusCode: input.statusCode ?? existing.statusCode,
      isEnabled: input.isEnabled ?? existing.isEnabled,
      notes: input.notes ?? existing.notes,
      updatedAt: new Date(),
    })
    .where(eq(cmsRedirects.id, redirectId))
    .returning();

  await recordAudit(db, actor, {
    action: 'redirect.update',
    entityType: 'cms_redirect',
    entityId: redirectId,
  });
  revalidateContent({ tags: [CMS_TAGS.redirects] });
  return ok(row);
}

export async function deleteRedirect(redirectId: string): Promise<RepoResult<true>> {
  const actor = await requirePermission('redirect.manage');
  const db = await getCmsDb();
  await db.delete(cmsRedirects).where(eq(cmsRedirects.id, redirectId));
  await recordAudit(db, actor, {
    action: 'redirect.delete',
    entityType: 'cms_redirect',
    entityId: redirectId,
  });
  revalidateContent({ tags: [CMS_TAGS.redirects] });
  return ok(true);
}

// ---------------------------------------------------------------------------
// Site settings (admin only)
// ---------------------------------------------------------------------------

export async function updateSiteSetting<K extends SiteSettingKey>(
  locale: string,
  key: K,
  value: unknown,
): Promise<RepoResult<SiteSettings[K]>> {
  const actor = await requirePermission('settings.update');
  if (!isSiteSettingKey(key)) return err(`Onbekende instelling: ${key}`);

  const parsed = parseSiteSetting(key, value);
  const db = await getCmsDb();

  await db
    .insert(cmsSiteSettings)
    .values({ locale, key, value: parsed, updatedBy: actor.id })
    .onConflictDoUpdate({
      target: [cmsSiteSettings.locale, cmsSiteSettings.key],
      set: { value: parsed, updatedBy: actor.id, updatedAt: new Date() },
    });

  await recordAudit(db, actor, {
    action: 'settings.update',
    entityType: 'cms_site_setting',
    entityId: `${locale}:${key}`,
  });
  revalidateContent({ tags: [CMS_TAGS.settings], paths: ['/'] });
  return ok(parsed);
}

// ---------------------------------------------------------------------------
// Audit log (admin only)
// ---------------------------------------------------------------------------

export async function listAuditLog(limit = 100): Promise<CmsAuditLogEntry[]> {
  await requirePermission('audit.read');
  const db = await getCmsDb();
  return db.select().from(cmsAuditLog).orderBy(desc(cmsAuditLog.createdAt)).limit(limit);
}

/** Dashboard counters for the admin home screen. */
export async function getAdminStats(): Promise<{
  pages: number;
  published: number;
  media: number;
  redirects: number;
}> {
  await requireCmsUser();
  const db = await getCmsDb();
  const count = sql<number>`count(*)::int`;

  const [pages] = await db.select({ count }).from(cmsPages);
  const [published] = await db
    .select({ count })
    .from(cmsPages)
    .where(eq(cmsPages.status, 'published'));
  const [media] = await db.select({ count }).from(cmsMedia).where(isNull(cmsMedia.deletedAt));
  const [redirects] = await db.select({ count }).from(cmsRedirects);

  return {
    pages: Number(pages?.count ?? 0),
    published: Number(published?.count ?? 0),
    media: Number(media?.count ?? 0),
    redirects: Number(redirects?.count ?? 0),
  };
}

// Users CRUD lives in `./auth.ts` (createUser, listCmsUsers, setUserRole,
// setUserActive, resetUserPassword) because it needs the password primitives.
export { createUser, listCmsUsers, resetUserPassword, setUserActive, setUserRole } from './auth';
export type { CmsUserPublic };
