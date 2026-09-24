import 'server-only';
import {
  getMedia,
  getNavigation,
  getPublishedPage,
  getSiteSettings,
  mediaAlt,
  mediaUrl,
  type PublishedPage,
} from '@/lib/cms/content';
import type { NavigationItem, SiteSettings } from '@/lib/cms/blocks';
import { siteUrl } from '@/lib/env';
import { localePath, type StudioLocale } from './locale';

/**
 * The public site's data layer. Everything the Studio routes need comes from
 * here, and everything here goes through `src/lib/cms/content.ts` — the only
 * module allowed to touch the database on the public side.
 */

export type StudioChrome = {
  locale: StudioLocale;
  settings: SiteSettings;
  mainNav: NavigationItem[];
  footerNav: NavigationItem[];
};

/** Header + footer data. One call, three cached reads. */
export async function getStudioChrome(locale: StudioLocale): Promise<StudioChrome> {
  const [settings, mainNav, footerNav] = await Promise.all([
    getSiteSettings(locale),
    getNavigation(locale, 'main'),
    getNavigation(locale, 'footer'),
  ]);
  return { locale, settings, mainNav, footerNav };
}

export type StudioPage = {
  locale: StudioLocale;
  page: PublishedPage;
  settings: SiteSettings;
  /** Absolute canonical URL, honouring `seo.canonicalOverride`. */
  canonical: string;
  /** Site-root-relative path of this page. */
  path: string;
};

/**
 * A published page plus the settings its metadata and JSON-LD need.
 * Returns null when the page does not exist or is not published.
 */
export async function getStudioPage(
  locale: StudioLocale,
  slug: string,
): Promise<StudioPage | null> {
  const page = await getPublishedPage(locale, slug);
  if (!page) return null;

  const settings = await getSiteSettings(locale);
  const path = localePath(locale, page.slug);
  const override = page.snapshot.seo.canonicalOverride?.trim();

  return {
    locale,
    page,
    settings,
    path,
    canonical: override ? absoluteUrl(override) : absoluteUrl(path),
  };
}

/** Turns a site-relative path into an absolute URL on the canonical origin. */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const origin = siteUrl().replace(/\/+$/, '');
  return path.startsWith('/') ? `${origin}${path}` : `${origin}/${path}`;
}

export type StudioImageSource = {
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
};

/** Resolves a `cms_media` id to a servable URL + alt text, or null. */
export async function resolveMedia(
  mediaId: string | null | undefined,
  locale: StudioLocale,
): Promise<StudioImageSource | null> {
  if (!mediaId) return null;
  const media = await getMedia(mediaId);
  if (!media) return null;
  return {
    url: mediaUrl(media),
    alt: mediaAlt(media, locale),
    width: media.width,
    height: media.height,
  };
}

/**
 * The one loud control in the header, and the fallback target for any CTA the
 * content does not spell out. `/afspraak` is an informational page (how to make
 * an appointment) — there is deliberately no booking flow yet, so nothing here
 * promises one.
 */
export const PRIMARY_CTA = { label: 'Afspraak maken', href: '/afspraak' } as const;
