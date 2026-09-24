/**
 * Cookie consent for the public site — shared by the consent banner and the
 * GA4 loader (both client components) and by the server-side guard in
 * `src/components/studio/analytics.tsx`.
 *
 * Plain module: no `server-only`, no `'use client'`. The browser helpers check
 * for `document`/`window` themselves and are no-ops on the server.
 *
 * The choice lives in one first-party cookie, `cms_consent`, holding
 * `granted` or `denied` for 365 days. It is written by the banner, never by
 * the server, and nothing analytics-related runs until it says `granted`.
 */

export const CONSENT_COOKIE = 'cms_consent';

/** Fired on `window` after the choice changes; `detail` is the new value. */
export const CONSENT_EVENT = 'cms-consent';

/** Fired on `window` by {@link openConsent} to show the banner again. */
export const CONSENT_OPEN_EVENT = 'cms-consent-open';

export const CONSENT_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export type ConsentValue = 'granted' | 'denied';

/** GA4 measurement ids look like `G-XXXXXXXXXX`; anything else is not rendered. */
export const MEASUREMENT_ID_PATTERN = /^[A-Za-z0-9-_]{1,32}$/;

/**
 * The measurement id to load, or null when analytics can never load on this
 * deployment: the env id must be present and well-formed AND the admin must
 * have switched `analytics.enabled` on. Same guard as before consent existed.
 */
export function resolveMeasurementId(envId: string | undefined, enabled: boolean): string | null {
  const id = envId?.trim() ?? '';
  if (!id || enabled !== true) return null;
  return MEASUREMENT_ID_PATTERN.test(id) ? id : null;
}

export function parseConsent(value: string | null | undefined): ConsentValue | null {
  return value === 'granted' || value === 'denied' ? value : null;
}

/** Reads a cookie by name from a `document.cookie`-style string. */
export function readCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/** The stored choice in this browser, or null when none was made (or on the server). */
export function readConsent(): ConsentValue | null {
  if (typeof document === 'undefined') return null;
  return parseConsent(readCookie(document.cookie, CONSENT_COOKIE));
}

/**
 * Stores the choice (365 days, `SameSite=Lax`, path `/`, `Secure` whenever the
 * page is served over https — every Vercel deployment) and tells listeners.
 */
export function writeConsent(value: ConsentValue): void {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${CONSENT_COOKIE}=${value}; Max-Age=${CONSENT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
  if (value === 'denied') clearAnalyticsCookies();
  window.dispatchEvent(new CustomEvent<ConsentValue>(CONSENT_EVENT, { detail: value }));
}

/** Shows the consent banner again (used by the footer "Cookies" link). */
export function openConsent(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CONSENT_OPEN_EVENT));
}

/**
 * `useSyncExternalStore` subscription for the consent value: the banner's
 * event plus `focus`, so a choice made in another tab is picked up when the
 * visitor comes back.
 */
export function subscribeConsent(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(CONSENT_EVENT, onChange);
  window.addEventListener('focus', onChange);
  return () => {
    window.removeEventListener(CONSENT_EVENT, onChange);
    window.removeEventListener('focus', onChange);
  };
}

/**
 * Removes Google Analytics' own first-party cookies (`_ga`, `_ga_<stream>`,
 * `_gid`, `_gat*`) after a withdrawal. GA sets them on the registrable domain,
 * so every parent domain of the current host is tried as well as host-only.
 */
export function clearAnalyticsCookies(): void {
  if (typeof document === 'undefined') return;
  const names = document.cookie
    .split(';')
    .map((part) => part.split('=')[0]?.trim() ?? '')
    .filter(
      (name) =>
        name === '_ga' || name.startsWith('_ga_') || name === '_gid' || name.startsWith('_gat'),
    );
  if (names.length === 0) return;

  const labels = window.location.hostname.split('.');
  const domains: Array<string | null> = [null];
  for (let i = 0; i < labels.length - 1; i += 1) domains.push(`.${labels.slice(i).join('.')}`);

  for (const name of names) {
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; Path=/${domain ? `; Domain=${domain}` : ''}`;
    }
  }
}
