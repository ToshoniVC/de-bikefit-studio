'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
  CONSENT_OPEN_EVENT,
  openConsent,
  readConsent,
  subscribeConsent,
  writeConsent,
  type ConsentValue,
} from '@/lib/analytics/consent';

/**
 * Cookie consent banner for the public site.
 *
 * Mounted by `StudioAnalytics` only when analytics could ever load on this
 * deployment (valid `NEXT_PUBLIC_GA4_MEASUREMENT_ID` AND `analytics.enabled`);
 * everywhere else nothing is rendered and nothing is asked.
 *
 * - No `cms_consent` cookie → a fixed bar at the bottom with two equally
 *   weighted buttons, "Accepteren" and "Weigeren".
 * - A choice writes the cookie (`granted` | `denied`, 365 days) and fires the
 *   `cms-consent` window event, so the GA4 tag starts (or stops) without a
 *   reload.
 * - `openConsent()` (the footer "Cookies" link) shows the bar again.
 *
 * The server never knows the choice, so the server HTML contains no banner;
 * it appears right after hydration for visitors who have not chosen yet.
 */

export { openConsent };

type Snapshot = ConsentValue | 'unset' | 'server';

const clientSnapshot = (): Snapshot => readConsent() ?? 'unset';
const serverSnapshot = (): Snapshot => 'server';

export function ConsentBanner({ privacyHref }: { privacyHref?: string | null }) {
  const consent = useSyncExternalStore(subscribeConsent, clientSnapshot, serverSnapshot);
  const [reopened, setReopened] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onOpen = () => {
      returnFocusTo.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setReopened(true);
    };
    window.addEventListener(CONSENT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, onOpen);
  }, []);

  // A keyboard user who reopened the bar from the footer lands inside it.
  useEffect(() => {
    if (reopened) panelRef.current?.focus();
  }, [reopened]);

  const hasChoice = consent === 'granted' || consent === 'denied';
  const visible = consent === 'unset' || (reopened && hasChoice);
  if (!visible) return null;

  const close = () => {
    setReopened(false);
    returnFocusTo.current?.focus();
    returnFocusTo.current = null;
  };

  const choose = (value: ConsentValue) => {
    writeConsent(value);
    close();
  };

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      aria-labelledby="cms-consent-title"
      onKeyDown={(event) => {
        // Escape only dismisses when a choice already exists.
        if (event.key === 'Escape' && hasChoice) close();
      }}
      className="fixed inset-x-0 bottom-0 z-[150] border-t border-[color:var(--ds-color-border-inverse-strong)] bg-[color:var(--ds-color-surface-inverse)] text-[color:var(--ds-color-fg-inverse-soft)] shadow-[0_-8px_24px_rgb(0_0_0/0.18)] outline-none"
    >
      <div className="mx-auto flex max-w-[var(--ds-container-max)] flex-col gap-4 px-[var(--ds-gutter)] pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:flex-row md:items-center md:justify-between md:gap-8">
        <div className="max-w-[72ch]">
          <h2
            id="cms-consent-title"
            className="font-[family-name:var(--ds-font-display)] text-[length:var(--ds-text-small)] font-bold tracking-[0.16em] text-[color:var(--ds-color-fg-inverse)] uppercase"
          >
            Cookies
          </h2>
          <p className="mt-1 text-[length:var(--ds-text-small)] leading-[var(--ds-leading-body)]">
            We gebruiken Google Analytics om te zien hoe bezoekers deze site gebruiken. Dat gebeurt
            alleen als je akkoord gaat. Je kan je keuze altijd aanpassen via ‘Cookies’ onderaan de
            pagina.
            {privacyHref ? (
              <>
                {' '}
                <a
                  href={privacyHref}
                  className="underline underline-offset-4 hover:text-[color:var(--ds-color-fg-inverse)] focus-visible:outline-[color:var(--ds-color-fg-inverse)]"
                >
                  Lees ons privacybeleid
                </a>
                .
              </>
            ) : null}
          </p>
          {reopened && hasChoice ? (
            <p className="mt-1 text-[length:var(--ds-text-meta)] tracking-[0.06em] text-[color:var(--ds-color-fg-inverse-muted)] uppercase">
              Huidige keuze: {consent === 'granted' ? 'geaccepteerd' : 'geweigerd'}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap gap-3">
          <button
            type="button"
            onClick={() => choose('granted')}
            className="studio-btn studio-btn--dark px-5 py-2.5 text-[length:var(--ds-text-small)] focus-visible:outline-[color:var(--ds-color-fg-inverse)]"
          >
            Accepteren
          </button>
          <button
            type="button"
            onClick={() => choose('denied')}
            className="studio-btn studio-btn--ghost-on-dark px-5 py-2.5 text-[length:var(--ds-text-small)] focus-visible:outline-[color:var(--ds-color-fg-inverse)]"
          >
            Weigeren
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * The footer "Cookies" link: reopens the banner. A button, because it does
 * not navigate; styled like the footer's own links by the caller.
 */
export function ConsentSettingsLink({
  className,
  children = 'Cookies',
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <button type="button" onClick={openConsent} className={className}>
      {children}
    </button>
  );
}
