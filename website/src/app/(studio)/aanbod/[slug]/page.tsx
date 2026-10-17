import type { Metadata } from 'next';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
import { OfferPageView } from '@/components/studio/offer-detail';
import { StudioPageView } from '@/components/studio/page-view';
import { findRedirect, getPublishedPage, getSiteSettings } from '@/lib/cms/content';
import { getPublishedOffer } from '@/lib/cms/offers-content';
import { redirectTarget } from '@/lib/cms/redirect-target';
import { OFFER_PAGE_PREFIX, parseServiceParam, SERVICE_PARAM } from '@/lib/offers/catalogue';
import { defaultLocale } from '@/lib/studio/locale';
import { buildOfferMetadata, buildPageMetadata, notFoundMetadata } from '@/lib/studio/seo';
import { getStudioPage } from '@/lib/studio/site';

/**
 * `/aanbod/<slug>` — an offering from Beheer → Aanbod, served without a CMS
 * page (17 Oct 2026). The overview `/aanbod` itself stays a CMS page (the
 * catch-all route).
 *
 * Resolution order:
 *
 *   1. an offering with that slug that is shown on the website → its page
 *   2. a published CMS page at `aanbod/<slug>`                 → render it
 *   3. an enabled `cms_redirects` row                          → 308 / 307
 *   4. otherwise                                               → 404
 *
 * Steps 2–4 repeat the catch-all route, so an editor's own page under
 * `/aanbod/` and the old `/aanbod/cadeaubon` redirect keep working. A hidden
 * offering answers 404 like an unknown one, and is not in the sitemap.
 */

/** Rendered per request — see the note in `(studio)/page.tsx`. */
export const dynamic = 'force-dynamic';

type RouteParams = { slug: string };
type RouteSearchParams = Record<string, string | string[] | undefined>;

async function loadOffer(slugParam: string) {
  // The segment is validated like `?dienst=`: a plain lower-case slug or nothing.
  const slug = parseServiceParam(slugParam);
  return slug ? getPublishedOffer(defaultLocale, slug) : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { slug } = await params;
  const settings = await getSiteSettings(defaultLocale);
  const entry = await loadOffer(slug);
  if (entry) {
    return buildOfferMetadata({
      content: entry.content,
      path: entry.offer.path,
      settings,
      locale: defaultLocale,
    });
  }
  const studio = await getStudioPage(defaultLocale, `${OFFER_PAGE_PREFIX}/${slug}`);
  if (studio) return buildPageMetadata(studio);
  return notFoundMetadata(settings);
}

export default async function OfferRoute({
  params,
  searchParams,
}: {
  params: Promise<RouteParams>;
  searchParams: Promise<RouteSearchParams>;
}) {
  const { slug } = await params;
  const entry = await loadOffer(slug);
  if (entry) {
    const [settings, index] = await Promise.all([
      getSiteSettings(defaultLocale),
      getPublishedPage(defaultLocale, OFFER_PAGE_PREFIX),
    ]);
    return (
      <OfferPageView
        entry={entry}
        settings={settings}
        locale={defaultLocale}
        parentTitle={index?.title ?? 'Aanbod'}
      />
    );
  }

  const path = `${OFFER_PAGE_PREFIX}/${slug}`;
  const query = await searchParams;
  const studio = await getStudioPage(defaultLocale, path);
  if (studio) {
    return (
      <StudioPageView studio={studio} requestedService={parseServiceParam(query[SERVICE_PARAM])} />
    );
  }

  const match = await findRedirect(`/${path}`);
  if (match) {
    const target = redirectTarget(match.toPath, query);
    if (match.statusCode === 301) permanentRedirect(target);
    redirect(target);
  }

  notFound();
}
