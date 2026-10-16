import { offerEnquiryEmail, offerEnquiryReference } from './email';
import { OFFER_ENQUIRY_MESSAGES, validateOfferEnquiry, type OfferEnquiryField } from './input';

/**
 * What happens when a visitor sends the enquiry form on an offer page:
 * validate (raw caps, honeypot) → the offer must exist, be shown and be asked
 * for (not booked online) → duplicate check → rate limit → e-mail the studio.
 * The I/O is injected (`store`, `findOffer`, `send`), so every outcome is
 * unit-tested in `delivery.test.ts`; the real wiring is `service.ts`.
 *
 * As with the gift voucher, `ok: true` exists only when the mail provider
 * ACCEPTED the message. A skipped send (no key, no sender, no recipient), a
 * refusal, a timeout or an exception is `not_sent`, and the visitor is told so
 * with their input kept. Nothing is stored apart from the rate-limit counters
 * (hashed e-mail, IP) and the duplicate marker (the random request id).
 */

export const OFFER_ENQUIRY_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const OFFER_ENQUIRY_RATE_LIMIT_MAX = 5;
/** How long a successful request id is remembered for duplicate submits. */
export const OFFER_ENQUIRY_DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The offer as the server knows it; `null` when it is unknown, hidden or not asked for. */
export type EnquiryOffer = {
  title: string;
  /** Absolute URL of the offer page (for the studio's mail). */
  url: string;
  /** The audience choices of the offering; empty for a single option. */
  audiences: ('adult' | 'youth')[];
};

export type OfferEnquiryStore = {
  wasSent(requestId: string): Promise<boolean>;
  /** Reserves one attempt for this e-mail address (and this IP when known); false = limit reached. */
  reserve(email: string, ip: string | null): Promise<boolean>;
  markSent(requestId: string): Promise<void>;
};

export type OfferEnquirySendResult =
  { sent: true; id: string | null } | { sent: false; reason: string };

export type OfferEnquiryDeps = {
  store: OfferEnquiryStore;
  findOffer: (slug: string) => Promise<EnquiryOffer | null>;
  send: (mail: {
    to: string;
    subject: string;
    html: string;
    text: string;
    replyTo: string;
  }) => Promise<OfferEnquirySendResult>;
  /** The studio's order inbox (Beheer → E-mail); empty = not configured, nothing is sent. */
  recipient: string;
  siteName: string;
  ipAddress: string | null;
  now?: Date;
  /** Server-side log line without personal data. */
  log?: (message: string) => void;
};

export type OfferEnquiryResult =
  | { ok: true; duplicate: boolean }
  | {
      ok: false;
      code: 'invalid' | 'unavailable' | 'rate_limited' | 'not_sent' | 'error';
      message: string;
      fieldErrors: Partial<Record<OfferEnquiryField, string>>;
    };

function fail(
  code: Exclude<OfferEnquiryResult, { ok: true }>['code'],
  message: string,
  fieldErrors: Partial<Record<OfferEnquiryField, string>> = {},
): OfferEnquiryResult {
  return { ok: false, code, message, fieldErrors };
}

/** Coarse reason for the server log: never an address, never the provider's free text. */
function reasonCode(reason: string): string {
  return ['not_configured', 'missing_from', 'no_recipient'].includes(reason) ? reason : 'provider';
}

/** The slug only, to find the offer before the full validation knows its audiences. */
function rawSlug(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const value = (raw as { offerSlug?: unknown }).offerSlug;
  return typeof value === 'string' && value.length <= 80 ? value.trim() : '';
}

export async function deliverOfferEnquiry(
  raw: unknown,
  deps: OfferEnquiryDeps,
): Promise<OfferEnquiryResult> {
  const log = deps.log ?? (() => {});

  // Shape and caps first (no audience yet): a malformed request never costs a query.
  const shape = validateOfferEnquiry(raw, ['adult', 'youth']);
  if (!shape.ok) {
    const { audience: _ignored, ...rest } = shape.fieldErrors;
    void _ignored;
    if (Object.keys(rest).length > 0) {
      return fail('invalid', OFFER_ENQUIRY_MESSAGES.invalid, rest);
    }
  } else if (shape.honeypot) {
    // A filled-in honeypot is a bot: refuse quietly, send nothing.
    return fail('invalid', OFFER_ENQUIRY_MESSAGES.rejected);
  }

  const offer = await deps.findOffer(rawSlug(raw));
  if (!offer) return fail('unavailable', OFFER_ENQUIRY_MESSAGES.unavailable);

  const validation = validateOfferEnquiry(raw, offer.audiences);
  if (!validation.ok) {
    return fail('invalid', OFFER_ENQUIRY_MESSAGES.invalid, validation.fieldErrors);
  }
  if (validation.honeypot) return fail('invalid', OFFER_ENQUIRY_MESSAGES.rejected);
  const { enquiry } = validation;
  const now = deps.now ?? new Date();

  if (enquiry.requestId && (await deps.store.wasSent(enquiry.requestId))) {
    // The same form was already sent (double click, retry after a lost
    // response): confirm again, but never mail the studio twice.
    return { ok: true, duplicate: true };
  }

  if (!(await deps.store.reserve(enquiry.email, deps.ipAddress))) {
    return fail('rate_limited', OFFER_ENQUIRY_MESSAGES.rateLimited);
  }

  const recipient = deps.recipient.trim();
  if (!recipient) {
    log('[aanvraag] niet verstuurd (no_recipient)');
    return fail('not_sent', OFFER_ENQUIRY_MESSAGES.notSent);
  }

  const mail = offerEnquiryEmail({
    siteName: deps.siteName,
    offer: { title: offer.title, url: offer.url },
    enquiry,
    receivedAt: now.toISOString(),
    reference: offerEnquiryReference(enquiry.requestId, now),
  });

  let result: OfferEnquirySendResult;
  try {
    result = await deps.send({ to: recipient, replyTo: enquiry.email, ...mail });
  } catch {
    result = { sent: false, reason: 'exception' };
  }
  if (!result.sent) {
    log(`[aanvraag] niet verstuurd (${reasonCode(result.reason)})`);
    return fail('not_sent', OFFER_ENQUIRY_MESSAGES.notSent);
  }

  if (enquiry.requestId) {
    try {
      await deps.store.markSent(enquiry.requestId);
    } catch {
      // The mail is out; a missing marker only weakens duplicate protection.
      log('[aanvraag] verstuurd, maar de dubbelklikbeveiliging kon niet bewaard worden');
    }
  }
  return { ok: true, duplicate: false };
}
