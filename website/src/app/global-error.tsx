'use client'; // Error boundaries must be Client Components.

import { useEffect } from 'react';

import { LEGAL_IDENTITY } from '@/lib/studio/legal';

// This screen replaces the root layout, so it brings its own CSS.
import './globals.css';

/**
 * Last-resort error screen, shown only when the root layout itself fails
 * (every segment below has its own `error.tsx`). It replaces `layout.tsx`, so
 * it renders its own `<html lang="nl">` and `<body>`. The copy never shows
 * error details; the digest is logged so it can be matched with the server
 * log. Reloading is the only sensible action at this level.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error('[ui] root layout failed', error.digest);
  }, [error]);

  return (
    <html lang="nl">
      <body>
        <title>Er ging iets mis · De Bikefit Studio</title>
        <div className="studio-root flex min-h-screen flex-col">
          <main id="inhoud" className="studio-notfound">
            <p className="studio-eyebrow">Foutmelding</p>
            <h1 className="studio-pagehead__title">Er ging iets mis</h1>
            <div className="studio-rich studio-stack">
              <p>
                De website kon niet geladen worden. Laad de pagina opnieuw; lukt het dan nog niet,
                probeer het binnen enkele minuten nog eens of bel ons op{' '}
                <a href={LEGAL_IDENTITY.phoneHref}>{LEGAL_IDENTITY.phoneLabel}</a>.
              </p>
            </div>
            <div className="studio-stack">
              <button
                type="button"
                className="studio-btn studio-btn--primary"
                onClick={() => window.location.reload()}
              >
                Pagina opnieuw laden
              </button>
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
