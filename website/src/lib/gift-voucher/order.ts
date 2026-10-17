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

/** The voucher page lives at `/cadeaubon` (until 17 Oct 2026: `/aanbod/cadeaubon`, now a redirect). */
export const GIFT_VOUCHER_PAGE_SLUG = 'cadeaubon';

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

/**
 * Caps on the RAW request fields, checked by the schema before any normalising
 * or pattern runs. Technical bounds, not voucher terms: validation comes before
 * the rate limit (`delivery.ts`), on a server-action body of up to 6 MB, so
 * these keep the work one anonymous request can cause small. They sit far
 * above {@link GIFT_VOUCHER_LIMITS}, which apply after normalising, so what
 * normalising removes (CRLF, tabs, trailing spaces, blank lines, invisible
 * characters) never gets an order refused that fits those; the form's
 * `maxLength` keeps a browser within the visitor-facing limits anyway.
 */
export const GIFT_VOUCHER_RAW_LIMITS = {
  amount: 64,
  message: 4000,
  name: 500,
  email: 400,
  phone: 100,
  /** Honeypot: a longer value counts as filled in, unread. */
  website: 400,
  /** Request id: a longer one is dropped like any malformed id. */
  requestId: 128,
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

/**
 * A plain address. Backtracks quadratically on a long run of dots (`a@....@`),
 * so only ever test a value whose length was checked first (at most 200
 * characters, here and in `recipient.ts`).
 */
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

/**
 * Plain-text message: LF line breaks, at most one empty line in a row, trimmed.
 * Line ends go through `trimEnd()`: the same characters as `/\s+$/`, but in
 * linear time, where that pattern is quadratic on a long run of whitespace
 * followed by text.
 */
export function normalizeMessage(value: string): string {
  return stripInvisible(value.replace(/\r\n?/g, '\n').replace(/\t/g, ' '))
    .split('\n')
    .map((line) => line.trimEnd())
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

/** A raw text field: `''` when absent, a `too_big` issue over its cap. */
const text = (max: number) => z.string().max(max).default('');

/**
 * Shape and raw caps only (types, defaults, {@link GIFT_VOUCHER_RAW_LIMITS});
 * the rules and messages are in {@link validateGiftVoucherOrder}.
 */
export const giftVoucherInputSchema = z.object({
  amount: text(GIFT_VOUCHER_RAW_LIMITS.amount),
  message: text(GIFT_VOUCHER_RAW_LIMITS.message),
  name: text(GIFT_VOUCHER_RAW_LIMITS.name),
  email: text(GIFT_VOUCHER_RAW_LIMITS.email),
  phone: text(GIFT_VOUCHER_RAW_LIMITS.phone),
  /**
   * Honeypot: must stay empty. Reduced to "filled in?" here and never refused,
   * so a bot gets the same quiet refusal whatever it sends: whitespace alone is
   * not filled in (as before), anything over the cap is, without being read.
   */
  website: z
    .string()
    .default('')
    .transform((value) => value.length > GIFT_VOUCHER_RAW_LIMITS.website || value.trim() !== ''),
  /**
   * Per-form id; a repeat after a successful send is answered without a second
   * e-mail. Over the cap it is dropped like any malformed id, never a refusal.
   */
  requestId: z
    .string()
    .default('')
    .transform((value) => (value.length > GIFT_VOUCHER_RAW_LIMITS.requestId ? '' : value)),
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

/**
 * Each field's message for a value that is too long or not valid. A field over
 * its raw cap gets the same one, whichever check caught it.
 */
const FIELD_MESSAGES: Record<GiftVoucherField, string> = {
  amount: 'Vul een bedrag in euro in, bijvoorbeeld 50 of 75,50.',
  message: `Maximaal ${GIFT_VOUCHER_LIMITS.message} tekens.`,
  name: `Maximaal ${GIFT_VOUCHER_LIMITS.name} tekens.`,
  email: 'Vul een geldig e-mailadres in.',
  phone: 'Vul een geldig telefoonnummer in.',
};

function isField(key: PropertyKey | undefined): key is GiftVoucherField {
  return typeof key === 'string' && Object.hasOwn(FIELD_MESSAGES, key);
}

/**
 * Schema issues → Dutch field messages. Only "over the raw cap" belongs to a
 * field; any other issue (a value that is not a string, a body that is not an
 * object) makes the request malformed: one generic message, as before.
 */
function rawFieldErrors(issues: z.ZodError['issues']): Partial<Record<GiftVoucherField, string>> {
  const errors: Partial<Record<GiftVoucherField, string>> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (issue.code !== 'too_big' || !isField(field)) return { amount: 'Controleer je aanvraag.' };
    errors[field] = FIELD_MESSAGES[field];
  }
  return errors;
}

/**
 * Normalises and checks every field; Dutch messages keyed by field name. It
 * runs before the rate limit, so it stays cheap: the schema caps each raw field
 * first, and everything after that is linear in the (capped) input.
 */
export function validateGiftVoucherOrder(raw: unknown): GiftVoucherValidation {
  const parsed = giftVoucherInputSchema.safeParse(raw ?? {});
  if (!parsed.success) return { ok: false, fieldErrors: rawFieldErrors(parsed.error.issues) };
  const input = parsed.data;
  const errors: Partial<Record<GiftVoucherField, string>> = {};

  const amountText = input.amount.trim();
  const amountCents =
    amountText.length > GIFT_VOUCHER_LIMITS.amount ? null : parseEuroAmountToCents(amountText);
  if (!amountText) {
    errors.amount = 'Vul een bedrag in.';
  } else if (amountCents === null) {
    errors.amount = FIELD_MESSAGES.amount;
  } else if (amountCents < GIFT_VOUCHER_MIN_CENTS) {
    errors.amount = 'Vul een bedrag van minstens € 1 in.';
  } else if (amountCents > GIFT_VOUCHER_MAX_CENTS) {
    errors.amount = 'Voor een bedrag boven € 5.000 bel je ons best even.';
  }

  const message = normalizeMessage(input.message);
  if (message.length > GIFT_VOUCHER_LIMITS.message) {
    errors.message = FIELD_MESSAGES.message;
  }

  const name = singleLine(input.name);
  if (name.length < 2) errors.name = 'Vul je naam in.';
  else if (name.length > GIFT_VOUCHER_LIMITS.name) {
    errors.name = FIELD_MESSAGES.name;
  }

  // Length before pattern: EMAIL_RE never sees more than 200 characters.
  const email = singleLine(input.email);
  if (email.length > GIFT_VOUCHER_LIMITS.email || !EMAIL_RE.test(email)) {
    errors.email = FIELD_MESSAGES.email;
  }

  const phone = singleLine(input.phone);
  if (phone && (phone.length > GIFT_VOUCHER_LIMITS.phone || !PHONE_RE.test(phone))) {
    errors.phone = FIELD_MESSAGES.phone;
  }

  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };

  const requestId = input.requestId.trim();
  return {
    ok: true,
    // The schema already reduced the honeypot to "filled in?".
    honeypot: input.website,
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
