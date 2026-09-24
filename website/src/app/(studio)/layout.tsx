import { StudioAnalytics } from '@/components/studio/analytics';
import { JsonLd } from '@/components/studio/json-ld';
import { StudioSiteFooter } from '@/components/studio/site-footer';
import { StudioSiteHeader } from '@/components/studio/site-header';
import { jsonLdDocument, organizationJsonLd, webSiteJsonLd } from '@/lib/studio/jsonld';
import { defaultLocale } from '@/lib/studio/locale';
import { absoluteUrl, getStudioChrome, resolveMedia } from '@/lib/studio/site';

/**
 * Chrome for the Dutch public site: utility bar, header, footer, skip link and
 * the site-wide structured data.
 *
 * The landmarks are explicit and unique — `<header>`, `<nav aria-label>`,
 * `<main id="inhoud">`, `<footer>` — and the skip link is the first focusable
 * element on every page, so a keyboard user reaches the content in one tab.
 *
 * `locale` is passed down as an argument everywhere instead of being read from
 * a module constant, so adding `/en` later does not mean touching these files.
 *
 * `.studio-root` scopes the whole design system. Nothing here leaks into the
 * webshop route groups, which keep their own chrome and their own styles.
 */
export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const locale = defaultLocale;
  const chrome = await getStudioChrome(locale);
  const origin = absoluteUrl('/').replace(/\/+$/, '');

  const logo = await resolveMedia(chrome.settings.site.logoMediaId, locale);
  const logoUrl = logo ? absoluteUrl(logo.url) : absoluteUrl('/logo.svg');

  const siteGraph = jsonLdDocument([
    organizationJsonLd(chrome.settings, origin, { logoUrl }),
    webSiteJsonLd(chrome.settings, origin, locale),
  ]);

  return (
    <div className="studio-root flex min-h-full flex-1 flex-col">
      <JsonLd data={siteGraph} />

      <a className="studio-skip" href="#inhoud">
        Direct naar de inhoud
      </a>

      <StudioSiteHeader chrome={chrome} />

      <main id="inhoud" className="flex-1">
        {children}
      </main>

      <StudioSiteFooter chrome={chrome} />
      <StudioAnalytics settings={chrome.settings} />
    </div>
  );
}
