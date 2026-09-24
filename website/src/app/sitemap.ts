import type { MetadataRoute } from 'next';
import { listPublishedPages } from '@/lib/cms/content';
import { defaultLocale, localePath, localeTag } from '@/lib/studio/locale';
import { absoluteUrl } from '@/lib/studio/site';

/**
 * `/sitemap.xml`, built from the published pages in the CMS.
 *
 * Pages flagged `noIndex` are left out — a sitemap is a list of pages you want
 * indexed, so including one you have told robots to skip is a contradiction
 * search engines report as an error.
 *
 * `lastModified` is the page's `updated_at`, which `publishPage()` sets, so it
 * only moves when something was actually published.
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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages = await listPublishedPages(defaultLocale);

  return pages
    .filter((page) => !page.noIndex)
    .map((page) => {
      const url = absoluteUrl(localePath(defaultLocale, page.slug));
      return {
        url,
        lastModified: new Date(page.updatedAt),
        changeFrequency: page.slug === '' ? ('weekly' as const) : ('monthly' as const),
        priority: page.slug === '' ? 1 : 0.7,
        // Shaped for a second locale from day one; Dutch is also `x-default`.
        alternates: {
          languages: {
            [localeTag(defaultLocale)]: url,
            'x-default': url,
          },
        },
      };
    });
}
