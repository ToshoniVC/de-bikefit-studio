import type { MetadataRoute } from 'next';
import { listPublishedPages } from '@/lib/cms/content';
import { listPublishedOffers } from '@/lib/cms/offers-content';
import { defaultLocale, localePath, localeTag } from '@/lib/studio/locale';
import { absoluteUrl } from '@/lib/studio/site';

/**
 * `/sitemap.xml`, built from the published pages in the CMS and the offerings
 * shown on the website (Beheer → Aanbod, served at `/aanbod/<slug>`).
 *
 * Pages flagged `noIndex` are left out — a sitemap is a list of pages you want
 * indexed, so including one you have told robots to skip is a contradiction
 * search engines report as an error. A hidden offering is not served, so it is
 * not listed either.
 *
 * `lastModified` is the page's `updated_at`, which `publishPage()` sets, so it
 * only moves when something was actually published; an offering's is its last
 * save in Beheer → Aanbod.
 *
 * The site-wide `seo.allowIndexing` switch is handled in `robots.ts`: while it
 * is off, `robots.txt` disallows everything, which is the signal that matters.
 * The sitemap itself stays valid and correct either way.
 *
 * Rendered per request, like every other CMS-backed route: publishing a page
 * must put it in the sitemap immediately, not at the next deploy. The page list
 * itself is still tag-cached by `listPublishedPages()`.
 */
export const dynamic = 'force-dynamic';

function entry(url: string, lastModified: Date, isHome = false): MetadataRoute.Sitemap[number] {
  return {
    url,
    lastModified,
    changeFrequency: isHome ? ('weekly' as const) : ('monthly' as const),
    priority: isHome ? 1 : 0.7,
    // Shaped for a second locale from day one; Dutch is also `x-default`.
    alternates: {
      languages: {
        [localeTag(defaultLocale)]: url,
        'x-default': url,
      },
    },
  };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [pages, offers] = await Promise.all([
    listPublishedPages(defaultLocale),
    listPublishedOffers(defaultLocale).catch((): [] => {
      console.error('[sitemap] offers_unavailable');
      return [];
    }),
  ]);

  return [
    ...pages
      .filter((page) => !page.noIndex)
      .map((page) =>
        entry(
          absoluteUrl(localePath(defaultLocale, page.slug)),
          new Date(page.updatedAt),
          page.slug === '',
        ),
      ),
    ...offers.map((offer) => entry(absoluteUrl(localePath(defaultLocale, offer.path)), new Date())),
  ];
}
