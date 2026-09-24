'use client'; // Error boundaries must be Client Components.

import { useEffect } from 'react';

import { LEGAL_IDENTITY } from '@/lib/studio/legal';

/**
 * Error screen for the public site. It renders inside `(studio)/layout.tsx`,
 * so the visitor keeps the header, navigation and footer (same shape as
 * `not-found.tsx`). No error details on screen; the digest is logged so it can
 * be matched with the server log.
 *
 * "Probeer opnieuw" prefers Next 16.2's `unstable_retry()` (re-fetches the
 * segment, which is what recovers from a failed database read) and falls back
 * to `reset()` (re-renders only) if a future Next drops it.
 */
export default function StudioError({
  error,
  reset,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  unstable_retry?: () => void;
}) {
  useEffect(() => {
    console.error('[ui] studio page failed', error.digest);
  }, [error]);

  const retry = unstable_retry ?? reset;

  return (
    <div className="studio-notfound">
      <p className="studio-eyebrow">Foutmelding</p>
      <h1 className="studio-pagehead__title">Er ging iets mis</h1>
      <div className="studio-rich studio-stack">
        <p>
          Deze pagina kon even niet geladen worden. Probeer het opnieuw; lukt het dan nog niet, bel
          ons op <a href={LEGAL_IDENTITY.phoneHref}>{LEGAL_IDENTITY.phoneLabel}</a>.
        </p>
      </div>
      <div className="studio-stack">
        <button type="button" className="studio-btn studio-btn--primary" onClick={() => retry()}>
          Probeer opnieuw
        </button>
      </div>
    </div>
  );
}
