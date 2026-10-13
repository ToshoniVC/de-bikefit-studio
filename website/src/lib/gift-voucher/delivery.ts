import { giftVoucherReference, giftVoucherRequestEmail } from './email';
import { GIFT_VOUCHER_MESSAGES, validateGiftVoucherOrder, type GiftVoucherField } from './order';

export { GIFT_VOUCHER_MESSAGES };

/**
 * What happens when a visitor clicks "Bestel nu": validate → honeypot →
 * duplicate check → rate limit → e-mail the studio. The I/O is injected
 * (`store`, `send`), so every outcome is unit-tested in `delivery.test.ts`;
 * the real wiring (database, Resend, settings) is `service.ts`.
 *
 * The one rule that matters most: `ok: true` exists only when the mail
 * provider ACCEPTED the message. A skipped send (no `RESEND_API_KEY`, no
 * `EMAIL_FROM`, no recipient), a refusal, a timeout or an exception is
 * `not_sent`, and the visitor is told so — the form keeps their input.
 * Acceptance by the provider is not proof of delivery to the inbox; nothing
 * on the site claims more than "verstuurd".
 */

export const GIFT_VOUCHER_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const GIFT_VOUCHER_RATE_LIMIT_MAX = 5;
/** How long a successful request id is remembered for duplicate submits. */
export const GIFT_VOUCHER_DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type GiftVoucherStore = {
  /** A successful send with this request id since `since`? */
  wasSent(requestId: string, since: Date): Promise<boolean>;
  /** Attempts by this e-mail address or (when known) this IP since `since`. */
  countAttempts(email: string, ip: string | null, since: Date): Promise<number>;
  recordAttempt(email: string, ip: string | null): Promise<void>;
  markSent(requestId: string): Promise<void>;
};

export type GiftVoucherSendResult =
  { sent: true; id: string | null } | { sent: false; reason: string };

export type GiftVoucherDeps = {
  store: GiftVoucherStore;
  send: (mail: {
    to: string;
    subject: string;
    html: string;
    text: string;
    replyTo: string;
  }) => Promise<GiftVoucherSendResult>;
  /** Where order requests go; empty = not configured (nothing is sent). */
  recipient: string;
  siteName: string;
  ipAddress: string | null;
  now?: Date;
  /** Server-side log line without personal data. */
  log?: (message: string) => void;
};

export type GiftVoucherResult =
  | { ok: true; duplicate: boolean }
  | {
      ok: false;
      code: 'invalid' | 'rate_limited' | 'not_sent' | 'error';
      message: string;
      fieldErrors: Partial<Record<GiftVoucherField, string>>;
    };

function fail(
  code: Exclude<GiftVoucherResult, { ok: true }>['code'],
  message: string,
  fieldErrors: Partial<Record<GiftVoucherField, string>> = {},
): GiftVoucherResult {
  return { ok: false, code, message, fieldErrors };
}

/** Coarse reason for the server log: never the address, never the provider's free text. */
function reasonCode(reason: string): string {
  return ['not_configured', 'missing_from', 'no_recipient'].includes(reason) ? reason : 'provider';
}

export async function deliverGiftVoucherOrder(
  raw: unknown,
  deps: GiftVoucherDeps,
): Promise<GiftVoucherResult> {
  const log = deps.log ?? (() => {});
  const validation = validateGiftVoucherOrder(raw);
  if (!validation.ok) return fail('invalid', GIFT_VOUCHER_MESSAGES.invalid, validation.fieldErrors);
  // A filled-in honeypot is a bot: refuse quietly, send nothing.
  if (validation.honeypot) return fail('invalid', GIFT_VOUCHER_MESSAGES.rejected);
  const { order } = validation;
  const now = deps.now ?? new Date();
  const email = order.email.toLowerCase();

  if (
    order.requestId &&
    (await deps.store.wasSent(
      order.requestId,
      new Date(now.getTime() - GIFT_VOUCHER_DUPLICATE_WINDOW_MS),
    ))
  ) {
    // The same form was already sent (double click, retry after a lost
    // response): confirm again, but never mail the studio twice.
    return { ok: true, duplicate: true };
  }

  const since = new Date(now.getTime() - GIFT_VOUCHER_RATE_LIMIT_WINDOW_MS);
  if (
    (await deps.store.countAttempts(email, deps.ipAddress, since)) >= GIFT_VOUCHER_RATE_LIMIT_MAX
  ) {
    return fail('rate_limited', GIFT_VOUCHER_MESSAGES.rateLimited);
  }
  await deps.store.recordAttempt(email, deps.ipAddress);

  const recipient = deps.recipient.trim();
  if (!recipient) {
    log('[cadeaubon] aanvraag niet verstuurd (no_recipient)');
    return fail('not_sent', GIFT_VOUCHER_MESSAGES.notSent);
  }

  const mail = giftVoucherRequestEmail({
    siteName: deps.siteName,
    order,
    receivedAt: now.toISOString(),
    reference: giftVoucherReference(order.requestId, now),
  });

  let result: GiftVoucherSendResult;
  try {
    result = await deps.send({ to: recipient, replyTo: order.email, ...mail });
  } catch {
    result = { sent: false, reason: 'exception' };
  }
  if (!result.sent) {
    log(`[cadeaubon] aanvraag niet verstuurd (${reasonCode(result.reason)})`);
    return fail('not_sent', GIFT_VOUCHER_MESSAGES.notSent);
  }

  if (order.requestId) {
    try {
      await deps.store.markSent(order.requestId);
    } catch {
      // The mail is out; a missing marker only weakens duplicate protection.
      log('[cadeaubon] verstuurd, maar de dubbelklikbeveiliging kon niet bewaard worden');
    }
  }
  return { ok: true, duplicate: false };
}
