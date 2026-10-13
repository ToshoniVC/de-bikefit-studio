import { EMAIL_RE } from './order';

/**
 * Where gift voucher orders go. Deliberately its own setting, separate from the
 * public contact address in the footer (`contact.email`):
 *
 *  1. env `GIFT_VOUCHER_RECIPIENT` (set by DevOps per environment) wins;
 *  2. else `/admin/email` → *Ontvanger cadeaubonbestellingen* (the e-mail
 *     service settings, `src/lib/email/config.ts`);
 *  3. else nobody: the order is "niet verstuurd".
 *
 * There is no fallback to `contact.email`. The public address may not receive
 * mail yet (on 2026-10-13 its domain had no DNS at all); a provider still
 * ACCEPTS a message to such an address and it bounces later, so a fallback
 * would show the visitor "verstuurd" for an order nobody gets. Someone has to
 * name a working inbox on purpose.
 *
 * An invalid value is treated as "no recipient" (never sent to), and the admin
 * status says so; an invalid env value never falls through to the setting.
 */

export const GIFT_VOUCHER_RECIPIENT_MAX = 200;

export type GiftVoucherRecipientSource = 'env' | 'setting' | 'none';

export type GiftVoucherRecipient = {
  /** The address to send to; empty = do not send. */
  address: string;
  source: GiftVoucherRecipientSource;
  /** A value was set but is not a single valid e-mail address. */
  invalid: boolean;
};

/** A single plain address (`naam@domein.be`), no display name, no list. */
export function isValidRecipientAddress(value: string): boolean {
  return value.length <= GIFT_VOUCHER_RECIPIENT_MAX && EMAIL_RE.test(value);
}

export function resolveGiftVoucherRecipient(input: {
  env: string | null | undefined;
  setting: string | null | undefined;
}): GiftVoucherRecipient {
  const fromEnv = (input.env ?? '').trim();
  if (fromEnv) {
    const invalid = !isValidRecipientAddress(fromEnv);
    return { address: invalid ? '' : fromEnv, source: 'env', invalid };
  }
  const fromSetting = (input.setting ?? '').trim();
  if (fromSetting) {
    const invalid = !isValidRecipientAddress(fromSetting);
    return { address: invalid ? '' : fromSetting, source: 'setting', invalid };
  }
  return { address: '', source: 'none', invalid: false };
}

/**
 * Validation for the admin form: empty is allowed (switches orders off), else
 * one valid address. Returns a Dutch message or `null`.
 */
export function giftVoucherRecipientProblem(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || isValidRecipientAddress(trimmed)) return null;
  return 'Ontvanger cadeaubonbestellingen: vul één geldig e-mailadres in (bv. naam@domein.be), of laat het veld leeg.';
}
