import type { SiteSettings } from '@/lib/cms/blocks';

/**
 * Analytics hook point — deliberately inert.
 *
 * TODO (deferred by design, not forgotten): this phase ships **no analytics
 * script and no analytics cookie**. Even with everything switched on, the only
 * thing that reaches the browser is an HTML comment. That keeps the site free
 * of consent obligations until GA4 is a conscious, reviewed decision.
 *
 * It renders nothing at all unless BOTH are true:
 *   - `NEXT_PUBLIC_GA4_MEASUREMENT_ID` is set in the environment, and
 *   - `cms_site_settings.analytics.enabled` is `true` (admin → Instellingen).
 *
 * To actually activate GA4 later, replace the comment below with a
 * `next/script` tag (`strategy="afterInteractive"`) that loads
 * `https://www.googletagmanager.com/gtag/js?id=<id>` plus the `gtag('config')`
 * call, and gate it behind a consent banner. See §13 of
 * `docs/cms-architecture.md` for the full checklist.
 */

/** GA4 ids look like `G-XXXXXXXXXX`; anything else is not rendered. */
const MEASUREMENT_ID_PATTERN = /^[A-Za-z0-9-_]{1,32}$/;

export function StudioAnalytics({ settings }: { settings: SiteSettings }) {
  const envId = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID?.trim() ?? '';
  const enabled = settings.analytics.enabled === true;

  if (!envId || !enabled) return null;
  if (!MEASUREMENT_ID_PATTERN.test(envId)) return null;

  return (
    <div
      hidden
      data-studio-analytics="ga4-placeholder"
      dangerouslySetInnerHTML={{
        __html: `<!-- GA4 ready (${envId}) — placeholder only: no script, no cookie, no network request. -->`,
      }}
    />
  );
}
