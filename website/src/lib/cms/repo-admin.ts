import 'server-only';
import { and, eq, ne, sql } from 'drizzle-orm';
import { getCmsDb } from '@/db/cms';
import { cmsPages, type CmsPage } from '@/db/cms-schema';
import { recordAudit, requirePermission } from './auth';
import { can } from './permissions';
import type { PageSeo } from './blocks';
import { CMS_TAGS, normalizeSlug } from './content';
import { publicPathFor, revalidateContent, type RepoResult } from './repo';

/**
 * Additive companion to `repo.ts` (owned by Worker A) — only what the admin UI
 * needs and `repo.ts` cannot express. Same contract: permission check first,
 * audit entry after, cache bust last.
 *
 * `repo.updatePage()` merges with `input.x ?? existing.x`, which makes it
 * impossible to *clear* a nullable SEO field. {@link updatePageMeta} treats a
 * present key as authoritative, so "leeg = leeg".
 */

export type UpdatePageMetaInput = {
  slug: string;
  title: string;
  kind: string;
  translationGroup: string;
} & PageSeo;

export async function updatePageMeta(
  pageId: string,
  input: UpdatePageMetaInput,
): Promise<RepoResult<CmsPage>> {
  const actor = await requirePermission('page.update');
  const db = await getCmsDb();

  const [existing] = await db.select().from(cmsPages).where(eq(cmsPages.id, pageId)).limit(1);
  if (!existing) return { ok: false, message: 'Pagina niet gevonden.' };

  const slug = normalizeSlug(input.slug);
  const title = input.title.trim();
  if (!title) return { ok: false, message: 'Geef de pagina een titel.' };

  const translationGroup = input.translationGroup.trim() || slug || 'home';

  if (slug !== existing.slug) {
    // Renaming a PUBLISHED page changes what visitors see immediately: the old
    // URL starts 404-ing and the content reappears elsewhere. That is a
    // publishing act, so it needs `page.publish` — otherwise an editor could
    // take a live page offline without the publish permission, which breaks the
    // "editors never change what a visitor sees" rule the draft/publish model
    // is built on. Renaming a draft stays an ordinary `page.update`.
    if (existing.status === 'published' && !can(actor.role, 'page.publish')) {
      return {
        ok: false,
        message:
          'Het pad van een gepubliceerde pagina aanpassen mag alleen een beheerder. Vraag een beheerder om de pagina te hernoemen.',
      };
    }

    const [clash] = await db
      .select({ id: cmsPages.id })
      .from(cmsPages)
      .where(
        and(eq(cmsPages.locale, existing.locale), eq(cmsPages.slug, slug), ne(cmsPages.id, pageId)),
      )
      .limit(1);
    if (clash) return { ok: false, message: `Er bestaat al een pagina met het pad “/${slug}”.` };
  }
  if (translationGroup !== existing.translationGroup) {
    const [clash] = await db
      .select({ id: cmsPages.id })
      .from(cmsPages)
      .where(
        and(
          eq(cmsPages.locale, existing.locale),
          eq(cmsPages.translationGroup, translationGroup),
          ne(cmsPages.id, pageId),
        ),
      )
      .limit(1);
    if (clash) {
      return {
        ok: false,
        message: `De vertaalgroep “${translationGroup}” is al in gebruik in deze taal.`,
      };
    }
  }

  const [page] = await db
    .update(cmsPages)
    .set({
      slug,
      title,
      kind: input.kind.trim() || 'default',
      translationGroup,
      metaTitle: input.metaTitle,
      metaDescription: input.metaDescription,
      canonicalOverride: input.canonicalOverride,
      ogTitle: input.ogTitle,
      ogDescription: input.ogDescription,
      ogImageMediaId: input.ogImageMediaId,
      noIndex: input.noIndex,
      structuredDataType: input.structuredDataType,
      structuredDataOverrides: input.structuredDataOverrides,
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
  return { ok: true, data: page };
}

/** Distinct locales that already have pages — drives the locale filter. */
export async function listPageLocales(): Promise<string[]> {
  await requirePermission('page.read');
  const db = await getCmsDb();
  const rows = await db
    .select({ locale: cmsPages.locale })
    .from(cmsPages)
    .groupBy(cmsPages.locale)
    .orderBy(sql`min(${cmsPages.locale})`);
  return rows.map((row) => row.locale);
}
