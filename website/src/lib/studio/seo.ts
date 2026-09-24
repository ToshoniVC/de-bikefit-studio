import 'server-only';
import type { Metadata } from 'next';
import type { SiteSettings } from '@/lib/cms/blocks';
import { localeTag, ogLocale, type StudioLocale } from './locale';
import { OG_IMAGE_ALT, OG_IMAGE_PATH, OG_IMAGE_SIZE } from './og';
import { absoluteUrl, resolveMedia, type StudioPage } from './site';

/**
 * Metadata for a published page.
 *
 * Precedence, highest first:
 *   1. the page's own SEO fields, frozen into the published snapshot
 *   2. the page title / site-wide SEO defaults from `cms_site_settings`
 *   3. the schema defaults in `siteSettingSchemas`
 *
 * Indexing is the AND of two switches: the page's `noIndex` and the site-wide
 * `seo.allowIndexing`. `allowIndexing` defaults to **false**, so a staging
 * deployment is `noindex, nofollow` until someone deliberately turns it on.
 */

export function applyTitleTemplate(template: string, title: string): string {
  if (!template.includes('%s')) return title;
  return template.replace('%s', title);
}

/** Site-wide title for the home page (no template applied). */
export function siteTitle(settings: SiteSettings): string {
  return settings.seo.defaultMetaTitle.trim() || settings.site.name;
}

export function shouldIndex(settings: SiteSettings, pageNoIndex: boolean): boolean {
  return settings.seo.allowIndexing && !pageNoIndex;
}

/**
 * `alternates.languages` is already in the shape a second locale needs: today
 * Dutch is the only entry and is also `x-default`, so adding `/en` later means
 * adding one key, not reworking every page.
 */
function languageAlternates(locale: StudioLocale, url: string): Record<string, string> {
  return {
    [localeTag(locale)]: url,
    'x-default': url,
  };
}

export async function buildPageMetadata(studio: StudioPage): Promise<Metadata> {
  const { locale, page, settings, canonical } = studio;
  const { seo } = page.snapshot;

  const isHome = page.slug === '';
  const rawTitle = seo.metaTitle?.trim() || page.title;
  const title = isHome
    ? seo.metaTitle?.trim() || siteTitle(settings)
    : applyTitleTemplate(settings.seo.titleTemplate, rawTitle);

  const description =
    seo.metaDescription?.trim() || settings.seo.defaultMetaDescription.trim() || undefined;

  const index = shouldIndex(settings, seo.noIndex);

  const media = await resolveMedia(seo.ogImageMediaId ?? settings.seo.defaultOgImageMediaId, locale);

  // A CMS image wins; otherwise the generated brand card at `GET /og`.
  const ogImage = media
    ? {
        url: absoluteUrl(media.url),
        alt: media.alt || title,
        width: media.width ?? undefined,
        height: media.height ?? undefined,
      }
    : {
        url: absoluteUrl(OG_IMAGE_PATH),
        alt: OG_IMAGE_ALT,
        width: OG_IMAGE_SIZE.width,
        height: OG_IMAGE_SIZE.height,
      };

  const metadata: Metadata = {
    // `absolute` because the template from `seo.titleTemplate` is already
    // applied above; without it the root layout would append the site name a
    // second time ("… · De Bikefit Studio · De Bikefit Studio").
    title: { absolute: title },
    description,
    alternates: {
      canonical,
      languages: languageAlternates(locale, canonical),
    },
    robots: {
      index,
      follow: index,
      googleBot: { index, follow: index },
    },
    openGraph: {
      type: 'website',
      locale: ogLocale(locale),
      url: canonical,
      siteName: settings.site.name,
      title: seo.ogTitle?.trim() || title,
      description: seo.ogDescription?.trim() || description,
      images: [ogImage],
    },
    twitter: {
      card: 'summary_large_image',
      title: seo.ogTitle?.trim() || title,
      description: seo.ogDescription?.trim() || description,
      images: [ogImage.url],
    },
  };

  return metadata;
}

/** Metadata for a URL that resolves to nothing — never indexable. */
export function notFoundMetadata(settings: SiteSettings): Metadata {
  return {
    title: { absolute: applyTitleTemplate(settings.seo.titleTemplate, 'Pagina niet gevonden') },
    description: 'Deze pagina bestaat niet (meer).',
    robots: { index: false, follow: false },
  };
}
