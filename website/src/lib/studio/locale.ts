import { DEFAULT_LOCALE } from '@/db/cms-schema';

/**
 * Locale policy for the public Studio site.
 *
 * Dutch is the only published locale and is served from the site root with NO
 * URL prefix. Nothing in `src/app/(studio)/**` or `src/components/studio/**`
 * hard-codes `'nl'`: every reader takes an explicit `locale` parameter, and the
 * routes pass {@link defaultLocale}. Adding `/en` later is therefore three
 * changes and no rewrite:
 *
 *  1. add the locale to {@link LOCALES},
 *  2. add `src/app/(studio)/[locale]/**` (or a middleware rewrite) that passes
 *     its own locale into the same components,
 *  3. flip {@link localePath} to emit the prefix for non-default locales.
 *
 * `publicPathFor()` in `src/lib/cms/repo.ts` already encodes the same rule, so
 * the admin's "view page" links and these helpers agree.
 */

export const defaultLocale = DEFAULT_LOCALE;

/** Every locale the public site can serve. Dutch only, for now. */
export const LOCALES = [defaultLocale] as const;
export type StudioLocale = (typeof LOCALES)[number] | string;

/** BCP-47 tag, for `<html lang>`, `inLanguage` and `hreflang`. */
export const LOCALE_TAGS: Record<string, string> = {
  nl: 'nl-BE',
};

/** Open Graph locale (underscore form). */
export const OG_LOCALES: Record<string, string> = {
  nl: 'nl_BE',
};

export function localeTag(locale: StudioLocale): string {
  return LOCALE_TAGS[locale] ?? locale;
}

export function ogLocale(locale: StudioLocale): string {
  return OG_LOCALES[locale] ?? locale.replace('-', '_');
}

/**
 * Public path for a page in a locale. The default locale has no prefix; any
 * future locale gets `/<locale>/…`.
 */
export function localePath(locale: StudioLocale, slug: string): string {
  const normalized = slug.replace(/^\/+/, '').replace(/\/+$/, '');
  const prefix = locale === defaultLocale ? '' : `/${locale}`;
  return normalized ? `${prefix}/${normalized}` : prefix || '/';
}

/** The slug (CMS form: no leading slash, `''` for home) for a URL path. */
export function slugFromSegments(segments: string[] | undefined): string {
  return (segments ?? []).join('/').replace(/^\/+/, '').replace(/\/+$/, '');
}
