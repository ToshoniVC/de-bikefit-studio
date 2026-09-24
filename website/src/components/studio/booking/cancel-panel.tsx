'use client';

import { useEffect, useRef, useState } from 'react';
import { cancelAction } from '@/lib/booking/public-actions';
import { StudioButtonLink } from '../link';
import type { CancelActionResult } from './types';

/**
 * The confirm step of `/afspraak/annuleren/[token]`.
 *
 * Opening the e-mailed link never cancels anything by itself — mail scanners
 * and link previews fetch URLs — so the visitor confirms with a button that
 * calls `cancelAction` (a POST). The outcome replaces the buttons and takes
 * focus, so it is announced.
 */
export function CancelPanel({
  token,
  phoneLabel,
  phoneHref,
}: {
  token: string;
  phoneLabel: string;
  phoneHref: string;
}) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<CancelActionResult | null>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (result) messageRef.current?.focus();
  }, [result]);

  async function confirmCancel() {
    setPending(true);
    let next: CancelActionResult;
    try {
      next = await cancelAction(token);
    } catch {
      next = {
        ok: false,
        message: 'Er ging iets mis. Probeer het opnieuw of bel ons.',
        booking: null,
      };
    }
    setPending(false);
    setResult(next);
  }

  if (result?.ok) {
    return (
      <div className="studio-booking__actions">
        <p className="studio-booking__alert" role="status" tabIndex={-1} ref={messageRef}>
          {result.message}
        </p>
        <StudioButtonLink href="/afspraak" variant="outline">
          Een nieuwe afspraak maken
        </StudioButtonLink>
      </div>
    );
  }

  return (
    <div className="studio-booking__actions">
      {result ? (
        <p className="studio-booking__alert" role="alert" tabIndex={-1} ref={messageRef}>
          {result.message}
          {phoneLabel && phoneHref ? (
            <>
              {' '}
              Of bel ons op <a href={phoneHref}>{phoneLabel}</a>.
            </>
          ) : null}
        </p>
      ) : null}
      <button
        type="button"
        className="studio-btn studio-btn--primary"
        onClick={() => void confirmCancel()}
        disabled={pending}
        aria-disabled={pending}
      >
        {pending ? 'Even geduld…' : 'Ja, annuleer mijn afspraak'}
      </button>
      <StudioButtonLink href="/" variant="ghost" arrow={false}>
        Nee, ik kom gewoon
      </StudioButtonLink>
    </div>
  );
}
