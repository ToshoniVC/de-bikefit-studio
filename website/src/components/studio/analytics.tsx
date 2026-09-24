import { resolveMeasurementId } from '@/lib/analytics/consent';
import { Ga4Tag } from '@/lib/analytics/ga4-tag';
import type { SiteSettings } from '@/lib/cms/blocks';
import { listPublishedPages } from '@/lib/cms/content';
import { env } from '@/lib/env';
import { defaultLocale, localePath } from '@/lib/studio/locale';

import { ConsentBanner } from './consent-banner';

/**
 * Google Analytics 4 for the public site — consent first.
 *
 * Server entry point, mounted once by `src/app/(studio)/layout.tsx`. It
 * renders nothing at all unless BOTH are true (unchanged guard):
 *   - `NEXT_PUBLIC_GA4_MEASUREMENT_ID` is set and looks like a measurement id,
 *   - `cms_site_settings.analytics.enabled` is `true` (admin → Instellingen).
 *
 * When both hold it mounts two client components:
 *   - `ConsentBanner` — asks once, stores `cms_consent` (granted | denied);
 *   - `Ga4Tag` — loads `gtag/js` only after `granted`, sends `page_view` on
 *     every route change.
 *
 * Before consent the page contains no analytics script, no preload, no
 * request to Google and no analytics cookie. See `docs/booking-runbook.md`
 * for the GA4 property setup. The footer's "Cookies" link (reopens the banner)
 * lives in `site-footer.tsx`, behind the same `studioMeasurementId()` guard.
 */

export function studioMeasurementId(settings: SiteSettings): string | null {
  return resolveMeasurementId(env.NEXT_PUBLIC_GA4_MEASUREMENT_ID, settings.analytics.enabled);
}

/** Published CMS pages that count as "the privacy page" for the banner link. */
const PRIVACY_SLUGS = ['privacy', 'privacybeleid', 'privacyverklaring'];

async function privacyHref(locale: string): Promise<string | null> {
  try {
    const pages = await listPublishedPages(locale);
    const match = PRIVACY_SLUGS.find((slug) => pages.some((page) => page.slug === slug));
    return match ? localePath(locale, match) : null;
  } catch {
    return null;
  }
}

export async function StudioAnalytics({
  settings,
  locale = defaultLocale,
}: {
  settings: SiteSettings;
  locale?: string;
}) {
  const measurementId = studioMeasurementId(settings);
  if (!measurementId) return null;

  return (
    <>
      <ConsentBanner privacyHref={await privacyHref(locale)} />
      <Ga4Tag measurementId={measurementId} />
    </>
  );
}
