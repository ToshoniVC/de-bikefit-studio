import type { MetadataRoute } from 'next';
import { getSiteSettings } from '@/lib/cms/content';
import { defaultLocale } from '@/lib/studio/locale';
import { absoluteUrl } from '@/lib/studio/site';

/**
 * `/robots.txt`, driven by the `seo.allowIndexing` site setting.
 *
 * `allowIndexing` defaults to **false**, so a staging deployment tells every
 * crawler `Disallow: /` until someone deliberately turns indexing on in the
 * admin. That is the one switch standing between a staging URL and Google.
 *
 * When it is on, everything is allowed except the four areas that must never
 * be crawled: the CMS admin, the API surface, and the webshop's checkout and
 * account pages (session-bound, thin, and useless in an index).
 *
 * The `Sitemap:` line is emitted in both states — a disallowed sitemap simply
 * is not fetched, and leaving it in means flipping the switch needs no second
 * change.
 *
 * Rendered per request rather than at build time: `allowIndexing` is a database
 * setting an admin can flip, and a `robots.txt` baked into a deployment would
 * keep saying `Disallow: /` until the next deploy. The underlying read is still
 * cached by `getSiteSettings()` and busted the moment the setting changes.
 * (It also keeps `next build` free of any database requirement.)
 */
export const dynamic = 'force-dynamic';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const settings = await getSiteSettings(defaultLocale);
  const sitemapUrl = absoluteUrl('/sitemap.xml');
  const host = absoluteUrl('/').replace(/\/+$/, '');

  if (!settings.seo.allowIndexing) {
    return {
      rules: [{ userAgent: '*', disallow: '/' }],
      sitemap: sitemapUrl,
    };
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/api', '/checkout', '/account'],
      },
    ],
    sitemap: sitemapUrl,
    host,
  };
}
