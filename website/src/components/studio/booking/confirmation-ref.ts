import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { sessionSecret } from '@/lib/secrets';

/**
 * The `ref` query value of `/afspraak/bevestigd`: a signed, session-less
 * summary of a booking that was just made, so a refresh (or a bookmark) shows
 * the booking instead of an empty form.
 *
 * It deliberately carries **no personal data** — only what the public site
 * shows anyway: the service and provider names, the two instants, the time
 * zone and a location label (the studio, or "Bij jou thuis"; never the
 * customer's own address). HMAC-SHA256 with `CMS_SESSION_SECRET`
 * (`sessionSecret()` in `src/lib/secrets.ts`),
 * domain-separated by a fixed prefix, exactly like
 * `src/app/api/google/oauth/state.ts`; a tampered or malformed value simply
 * reads as "no summary".
 */

export type ConfirmationRef = {
  v: 1;
  serviceName: string;
  providerName: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  where: string;
};

const HMAC_CONTEXT = 'booking-confirmation-ref:v1:';

function sign(payload: string): string {
  return createHmac('sha256', sessionSecret())
    .update(HMAC_CONTEXT + payload)
    .digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createConfirmationRef(input: Omit<ConfirmationRef, 'v'>): string {
  const body: ConfirmationRef = { v: 1, ...input };
  const payload = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** Null for anything missing, tampered or malformed. */
export function readConfirmationRef(value: string | null | undefined): ConfirmationRef | null {
  if (!value || value.length > 2048) return null;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra !== undefined) return null;

  try {
    if (!safeEqual(signature, sign(payload))) return null;
    const ref = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as Partial<ConfirmationRef>;
    if (
      ref.v !== 1 ||
      typeof ref.serviceName !== 'string' ||
      typeof ref.providerName !== 'string' ||
      typeof ref.startsAt !== 'string' ||
      typeof ref.endsAt !== 'string' ||
      typeof ref.timezone !== 'string' ||
      typeof ref.where !== 'string' ||
      Number.isNaN(Date.parse(ref.startsAt)) ||
      Number.isNaN(Date.parse(ref.endsAt))
    ) {
      return null;
    }
    return ref as ConfirmationRef;
  } catch {
    return null;
  }
}

export const CONFIRMATION_PATH = '/afspraak/bevestigd';

export function confirmationPath(ref: string): string {
  return `${CONFIRMATION_PATH}?ref=${encodeURIComponent(ref)}`;
}
