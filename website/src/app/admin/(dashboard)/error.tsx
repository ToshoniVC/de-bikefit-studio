'use client'; // Error boundaries must be Client Components.

import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Error screen for the admin dashboard. It renders inside
 * `(dashboard)/layout.tsx`, i.e. inside `AdminShell` and its
 * `.studio-root.admin-root` wrapper, so the navigation stays usable. Plain
 * markup on the existing admin utilities; the admin's look is owned by
 * `src/components/admin/**`.
 *
 * No error details on screen, only the digest (not personal data) so a report
 * can be matched with the server log. "Probeer opnieuw" prefers Next 16.2's
 * `unstable_retry()` (re-fetches the segment) and falls back to `reset()`.
 */
export default function AdminError({
  error,
  reset,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  unstable_retry?: () => void;
}) {
  useEffect(() => {
    console.error('[ui] admin screen failed', error.digest);
  }, [error]);

  const retry = unstable_retry ?? reset;

  return (
    <section role="alert" className="border border-border bg-card p-5 sm:p-6">
      <h1 className="text-3xl leading-none">Er ging iets mis</h1>
      <p className="mt-3 max-w-[65ch] text-base text-muted-foreground">
        Dit scherm kon niet geladen worden. Probeer opnieuw. Blijft het misgaan, geef dan het
        tijdstip{error.digest ? ' en de foutcode hieronder' : ''} door aan wie de website beheert.
      </p>
      {error.digest ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Foutcode: <code>{error.digest}</code>
        </p>
      ) : null}
      <Button type="button" className="mt-5" onClick={() => retry()}>
        Probeer opnieuw
      </Button>
    </section>
  );
}
