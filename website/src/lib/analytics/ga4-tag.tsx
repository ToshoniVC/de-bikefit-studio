'use client';

import { usePathname } from 'next/navigation';
import Script from 'next/script';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { readConsent, subscribeConsent } from './consent';

/**
 * The GA4 tag, gated on consent. Mounted only by `StudioAnalytics`
 * (`src/components/studio/analytics.tsx`), which has already checked that a
 * valid measurement id is configured AND `analytics.enabled` is on.
 *
 * Until the `cms_consent` cookie says `granted` this renders nothing: no
 * `<script>`, no preload, no network request, no cookie. The server snapshot
 * is always "no consent", so the server HTML never contains the tag either.
 *
 * Once granted (from the cookie on load, or live via the banner's
 * `cms-consent` event):
 *  1. an inline `next/script` bootstraps `dataLayer`/`gtag` with ads storage
 *     denied, `anonymize_ip: true` and `send_page_view: false`;
 *  2. `gtag/js` loads with `strategy="afterInteractive"`;
 *  3. a `page_view` is sent for the current path and again on every client
 *     route change (`usePathname`).
 *
 * A later withdrawal sets GA's documented kill switch `ga-disable-<id>` and
 * downgrades `analytics_storage` for the rest of the page's life; the banner
 * also deletes GA's cookies. Nothing loads again on the next page view.
 */

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const noConsentOnServer = () => null;

function bootstrapSnippet(measurementId: string): string {
  const id = JSON.stringify(measurementId);
  return [
    'window.dataLayer=window.dataLayer||[];',
    'window.gtag=window.gtag||function(){window.dataLayer.push(arguments);};',
    "gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'granted'});",
    "gtag('js',new Date());",
    `gtag('config',${id},{anonymize_ip:true,send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false});`,
  ].join('');
}

export function Ga4Tag({ measurementId }: { measurementId: string }) {
  const consent = useSyncExternalStore(subscribeConsent, readConsent, noConsentOnServer);
  const granted = consent === 'granted';
  const pathname = usePathname();

  // Flipped by the inline bootstrap's `onReady`, so the first page_view can
  // never be queued ahead of `gtag('config')`.
  const [ready, setReady] = useState(false);
  const lastSentPath = useRef<string | null>(null);

  // Kill switch: honour a withdrawal immediately, and lift it on re-consent.
  useEffect(() => {
    (window as unknown as Record<string, unknown>)[`ga-disable-${measurementId}`] = !granted;
    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', { analytics_storage: granted ? 'granted' : 'denied' });
    }
    if (!granted) lastSentPath.current = null;
  }, [granted, measurementId]);

  useEffect(() => {
    if (!granted || !ready || lastSentPath.current === pathname) return;
    // One macrotask later, so the new page's <title> (streamed metadata) is in.
    const timer = window.setTimeout(() => {
      if (typeof window.gtag !== 'function' || lastSentPath.current === pathname) return;
      lastSentPath.current = pathname;
      window.gtag('event', 'page_view', {
        page_path: pathname,
        page_location: window.location.href,
        page_title: document.title,
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [granted, ready, pathname]);

  if (!granted) return null;

  return (
    <>
      <Script
        id="cms-ga4-init"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{ __html: bootstrapSnippet(measurementId) }}
        onReady={() => setReady(true)}
      />
      <Script
        id="cms-ga4-gtag"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`}
      />
    </>
  );
}
