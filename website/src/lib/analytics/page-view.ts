/**
 * The page fields of a GA4 hit, `page_path` and `page_location`, built so that
 * nothing secret or needless about the URL reaches Google. Used by the GA4 tag
 * (`ga4-tag.tsx`) for its `gtag('config')` and its manual `page_view`.
 *
 * Plain module: no `server-only`, no `'use client'`, no `window`. The caller
 * passes `location.origin` and `location.search`; `location.href` (and with it
 * the fragment) is never used.
 *
 * - The cancel link `/afspraak/annuleren/<token>` is reported as
 *   `/afspraak/annuleren/[token]`, without any query. The token cancels the
 *   booking (until the cancel deadline) and shows its summary. A trailing
 *   slash, deeper segments, another letter case, percent-encoding or doubled
 *   slashes are masked as well: masking a look-alike costs nothing, missing
 *   one would send the token.
 * - Every other page is reported by its path. Of the query only the five
 *   `utm_*` keys survive, re-serialised, because GA4 reads campaign
 *   attribution from `page_location`. Everything else (the signed `?ref=` on
 *   `/afspraak/bevestigd`, `?dienst=`, click ids such as `gclid`) and the
 *   fragment are dropped.
 *
 * A new route with a secret in its path belongs here, with a test.
 */

/** Everything below this path is the cancel page; the next segment is a bearer token. */
const CANCEL_PREFIX = '/afspraak/annuleren/';

/** What GA4 sees instead of a cancel link, as `page_path` and after the origin. */
export const MASKED_CANCEL_PATH = '/afspraak/annuleren/[token]';

/** The only query keys sent to GA4 (campaign attribution), in this order. */
export const CAMPAIGN_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const;

export type PageViewInput = {
  /** From `usePathname()`: the path, without query or fragment. */
  pathname: string;
  /** `window.location.origin`, e.g. `https://debikefitstudio.be`. */
  origin: string;
  /** `window.location.search`: `''` or `?…`. */
  search?: string;
};

export type PageViewFields = { page_path: string; page_location: string };

export function analyticsPageView({
  pathname,
  origin,
  search = '',
}: PageViewInput): PageViewFields {
  const base = origin.replace(/\/+$/, '');
  const path = pathOnly(pathname);
  if (isCancelPath(path)) {
    return { page_path: MASKED_CANCEL_PATH, page_location: `${base}${MASKED_CANCEL_PATH}` };
  }
  return { page_path: path, page_location: `${base}${path}${campaignQuery(search)}` };
}

/** The path alone, always starting with `/`: a stray `?…` or `#…` is cut off. */
function pathOnly(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0] ?? '';
  return path.startsWith('/') ? path : `/${path}`;
}

/**
 * Compared with ASCII escapes decoded (`%65` → `e`: enough for the ASCII
 * prefix, and unlike `decodeURIComponent` it cannot fail on a malformed escape
 * elsewhere in the path), lower-cased and with repeated slashes collapsed.
 */
function isCancelPath(path: string): boolean {
  const plain = path
    .replace(/%([0-7][0-9a-f])/gi, (_escape, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .toLowerCase()
    .replace(/\/{2,}/g, '/');
  return plain.startsWith(CANCEL_PREFIX);
}

/** `?utm_…` with the campaign keys only (the first value of each, unless empty), or `''`. */
function campaignQuery(search: string): string {
  const incoming = new URLSearchParams(search.split('#', 1)[0]);
  const kept = new URLSearchParams();
  for (const key of CAMPAIGN_KEYS) {
    const value = incoming.get(key);
    if (value) kept.set(key, value);
  }
  const query = kept.toString();
  return query ? `?${query}` : '';
}
