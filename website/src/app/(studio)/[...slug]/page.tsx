import type { Metadata } from 'next';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
import { StudioPageView } from '@/components/studio/page-view';
import { findRedirect, getSiteSettings } from '@/lib/cms/content';
import { defaultLocale, slugFromSegments } from '@/lib/studio/locale';
import { buildPageMetadata, notFoundMetadata } from '@/lib/studio/seo';
import { getStudioPage } from '@/lib/studio/site';

/**
 * Every CMS page below the root.
 *
 * Resolution order for `/<something>`:
 *
 *   1. a published page with that slug  → render it
 *   2. an enabled `cms_redirects` row   → 308 (301 rows) or 307 (302 rows)
 *   3. otherwise                        → 404
 *
 * A catch-all is the *lowest*-priority match in Next's routing table, so every
 * webshop route keeps working untouched: `/shop`, `/shop/[slug]`, `/checkout`,
 * `/account`, `/blog`, `/blog/[slug]`, `/policies/*`, `/sign-in`, `/sign-up`,
 * `/webshop`, `/admin/*` and `/api/*` are all declared as their own files and
 * therefore win. This route only ever sees what nothing else claimed.
 *
 * Redirect lookups deliberately happen here and not in `middleware.ts`: the
 * middleware runs on the edge runtime and must stay database-free.
 */

/** Rendered per request — see the note in `(studio)/page.tsx`. */
export const dynamic = 'force-dynamic';

type RouteParams = { slug?: string[] };

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { slug } = await params;
  const studio = await getStudioPage(defaultLocale, slugFromSegments(slug));
  if (!studio) return notFoundMetadata(await getSiteSettings(defaultLocale));
  return buildPageMetadata(studio);
}

export default async function StudioCatchAllPage({ params }: { params: Promise<RouteParams> }) {
  const { slug } = await params;
  const path = slugFromSegments(slug);

  const studio = await getStudioPage(defaultLocale, path);
  if (studio) return <StudioPageView studio={studio} />;

  const match = await findRedirect(`/${path}`);
  if (match) {
    // `permanentRedirect` answers 308 and `redirect` 307 — the method-preserving
    // equivalents of the stored 301/302. Both are permanent/temporary in the
    // same way for a crawler.
    if (match.statusCode === 301) permanentRedirect(match.toPath);
    redirect(match.toPath);
  }

  notFound();
}
