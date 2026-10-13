import { z } from 'zod';

/**
 * Gift voucher ("Cadeaubon") order requests — the pure half: field rules with
 * Dutch messages, the Belgian euro amount parser and plain-text normalising.
 * No I/O, unit-tested in `order.test.ts`.
 *
 * What an order is (Toshoni, 13 Oct 2026): a visitor picks an amount, writes a
 * personal message and leaves contact details; "Bestel nu" e-mails the studio,
 * which makes the invoice and payment link by hand. There is no payment,
 * invoice, voucher code or customer e-mail here, and no validity or terms are
 * stated anywhere: those are the studio's to decide.
 */

/** The exact label of the submit button (work block 2026-10-13). */
export const GIFT_VOUCHER_SUBMIT_LABEL = 'Bestel nu';

/** The voucher page lives at `/aanbod/cadeaubon`. */
export const GIFT_VOUCHER_PAGE_SLUG = 'aanbod/cadeaubon';

/** Technical bounds, not voucher terms: a positive amount, and a sanity cap. */
export const GIFT_VOUCHER_MIN_CENTS = 100;
export const GIFT_VOUCHER_MAX_CENTS = 500_000;

export const GIFT_VOUCHER_LIMITS = {
  amount: 20,
  message: 500,
  name: 120,
  email: 200,
  phone: 40,
} as const;

/** Visitor-facing messages of the whole flow (shared by the form and the server). */
export const GIFT_VOUCHER_MESSAGES = {
  invalid: 'Controleer de gemarkeerde velden.',
  rejected: 'Je aanvraag kon niet verwerkt worden. Probeer het opnieuw of bel ons.',
  rateLimited: 'Te veel aanvragen op korte tijd. Probeer het over een kwartier opnieuw of bel ons.',
  notSent:
    'Je bestelling is niet verstuurd: er ging iets mis aan onze kant. Je gegevens staan nog in het formulier. Probeer het later opnieuw of bel ons.',
} as const;

export type GiftVoucherField = 'amount' | 'message' | 'name' | 'email' | 'phone';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+0-9()./\s-]{6,25}$/;
/** Shape of the per-form request id the client generates (`crypto.randomUUID()`). */
const REQUEST_ID_RE = /^[A-Za-z0-9-]{16,64}$/;

/**
 * Removes what has no place in a plain-text line: control characters, and the
 * bidirectional overrides and zero-width characters that can disguise text.
 */
function stripInvisible(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/g, '');
}

/** One line: no line breaks or tabs, single spaces, trimmed. */
export function singleLine(value: string): string {
  return stripInvisible(value.replace(/[\r\n\t]+/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Plain-text message: LF line breaks, at most one empty line in a row, trimmed. */
export function normalizeMessage(value: string): string {
  return stripInvisible(value.replace(/\r\n?/g, '\n').replace(/\t/g, ' '))
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * A euro amount as typed in Belgium → cents, or `null` when it is not one.
 *
 * Accepts `50`, `50,5`, `50,50`, `50.50`, `1.250`, `1.250,00`, `1 250`,
 * `€ 50`, `50 €`, `50 EUR` and `50,-`. A dot followed by exactly three digits
 * is a thousands separator (`1.250` = € 1.250); otherwise a single dot is a
 * decimal point. At most two decimals; no negative or exponent notation.
 */
export function parseEuroAmountToCents(raw: string): number | null {
  let value = raw
    .replace(/[\s  ]+/g, '')
    .replace(/^€|€$/g, '')
    .replace(/eur(o)?$/i, '')
    .replace(/,-$/, '');
  if (!value) return null;

  let whole: string;
  let fraction = '';
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(value)) {
    // Thousands dots, optional decimal comma.
    [whole, fraction = ''] = value.replace(/\./g, '').split(',');
  } else if (/^\d+([.,]\d{1,2})?$/.test(value)) {
    [whole, fraction = ''] = value.replace(',', '.').split('.');
  } else {
    return null;
  }
  value = whole.replace(/^0+(?=\d)/, '');
  if (value.length > 9) return null;
  return Number(value) * 100 + Number(fraction.padEnd(2, '0'));
}

const text = z.string().default('');

/** Shape only (types, defaults); the rules and messages are in {@link validateGiftVoucherOrder}. */
export const giftVoucherInputSchema = z.object({
  amount: text,
  message: text,
  name: text,
  email: text,
  phone: text,
  /** Honeypot: must stay empty. */
  website: text,
  /** Per-form id; a repeat after a successful send is answered without a second e-mail. */
  requestId: text,
});

export type GiftVoucherInput = z.input<typeof giftVoucherInputSchema>;

export type GiftVoucherOrder = {
  amountCents: number;
  message: string;
  name: string;
  email: string;
  phone: string;
  requestId: string | null;
};

export type GiftVoucherValidation =
  | { ok: true; order: GiftVoucherOrder; honeypot: boolean }
  | { ok: false; fieldErrors: Partial<Record<GiftVoucherField, string>> };

/** Normalises and checks every field; Dutch messages keyed by field name. */
export function validateGiftVoucherOrder(raw: unknown): GiftVoucherValidation {
  const parsed = giftVoucherInputSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return { ok: false, fieldErrors: { amount: 'Controleer je aanvraag.' } };
  }
  const input = parsed.data;
  const errors: Partial<Record<GiftVoucherField, string>> = {};

  const amountText = input.amount.trim();
  const amountCents =
    amountText.length > GIFT_VOUCHER_LIMITS.amount ? null : parseEuroAmountToCents(amountText);
  if (!amountText) {
    errors.amount = 'Vul een bedrag in.';
  } else if (amountCents === null) {
    errors.amount = 'Vul een bedrag in euro in, bijvoorbeeld 50 of 75,50.';
  } else if (amountCents < GIFT_VOUCHER_MIN_CENTS) {
    errors.amount = 'Vul een bedrag van minstens € 1 in.';
  } else if (amountCents > GIFT_VOUCHER_MAX_CENTS) {
    errors.amount = 'Voor een bedrag boven € 5.000 bel je ons best even.';
  }

  const message = normalizeMessage(input.message);
  if (message.length > GIFT_VOUCHER_LIMITS.message) {
    errors.message = `Maximaal ${GIFT_VOUCHER_LIMITS.message} tekens.`;
  }

  const name = singleLine(input.name);
  if (name.length < 2) errors.name = 'Vul je naam in.';
  else if (name.length > GIFT_VOUCHER_LIMITS.name) {
    errors.name = `Maximaal ${GIFT_VOUCHER_LIMITS.name} tekens.`;
  }

  const email = singleLine(input.email);
  if (!EMAIL_RE.test(email) || email.length > GIFT_VOUCHER_LIMITS.email) {
    errors.email = 'Vul een geldig e-mailadres in.';
  }

  const phone = singleLine(input.phone);
  if (phone && (!PHONE_RE.test(phone) || phone.length > GIFT_VOUCHER_LIMITS.phone)) {
    errors.phone = 'Vul een geldig telefoonnummer in.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };

  const requestId = input.requestId.trim();
  return {
    ok: true,
    honeypot: input.website.trim().length > 0,
    order: {
      amountCents: amountCents!,
      message,
      name,
      email,
      phone,
      requestId: REQUEST_ID_RE.test(requestId) ? requestId : null,
    },
  };
}
