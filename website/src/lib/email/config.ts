import { z } from 'zod';
import {
  isValidRecipientAddress,
  resolveGiftVoucherRecipient,
  type GiftVoucherRecipient,
} from '@/lib/gift-voucher/recipient';

/**
 * The e-mail service configuration, pure (no database, no env, no network):
 * what an admin may store in `/admin/email`, how that combines with the
 * environment, and what the admin screen may see of it.
 *
 * Precedence is per field: an environment variable (set by DevOps in Vercel)
 * wins over the value stored in the admin, which wins over nothing. That keeps
 * every existing deployment that configures mail through env working exactly
 * as before.
 *
 * | Field | Env | Admin (`cms_integration_settings`, key `email`) |
 * | --- | --- | --- |
 * | API key | `RESEND_API_KEY` | sealed (AES-256-GCM), write-only |
 * | Sender | `EMAIL_FROM` | `config.from` |
 * | Reply-To | `EMAIL_REPLY_TO` | `config.replyTo` |
 * | Voucher order inbox | `GIFT_VOUCHER_RECIPIENT` | `config.giftVoucherRecipient` |
 *
 * The API key never appears in {@link EmailServiceStatus}: the admin sees its
 * source, its last four characters (when stored in the admin) and whether it
 * can still be decrypted. Nothing else.
 */

export const EMAIL_SETTINGS_KEY = 'email';
const API_KEY_MAX = 200;
const DISPLAY_NAME_MAX = 100;

export const emailServiceConfigSchema = z.object({
  from: z.string().default(''),
  replyTo: z.string().default(''),
  giftVoucherRecipient: z.string().default(''),
});

export type EmailServiceConfig = z.infer<typeof emailServiceConfigSchema>;

export const EMPTY_EMAIL_CONFIG: EmailServiceConfig = {
  from: '',
  replyTo: '',
  giftVoucherRecipient: '',
};

/** A stored `config` blob; anything malformed counts as empty. */
export function parseEmailServiceConfig(value: unknown): EmailServiceConfig {
  const parsed = emailServiceConfigSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : { ...EMPTY_EMAIL_CONFIG };
}

export type EmailSettingSource = 'env' | 'setting' | 'none';

/** The row as the server reads it, with the key already decrypted. Server only. */
export type StoredEmailSettings = {
  /** The table could be read (false before migration 0004 or on a database error). */
  available: boolean;
  config: EmailServiceConfig;
  /** Decrypted key; `null` when none is stored or it cannot be decrypted. */
  apiKey: string | null;
  /** A sealed key is stored (whether or not it can still be decrypted). */
  apiKeyStored: boolean;
  apiKeyHint: string | null;
  apiKeyUpdatedAt: Date | null;
};

export const NO_STORED_EMAIL_SETTINGS: StoredEmailSettings = {
  available: false,
  config: EMPTY_EMAIL_CONFIG,
  apiKey: null,
  apiKeyStored: false,
  apiKeyHint: null,
  apiKeyUpdatedAt: null,
};

export type EmailEnv = {
  apiKey?: string | null;
  from?: string | null;
  replyTo?: string | null;
  giftVoucherRecipient?: string | null;
};

/** What `sendEmail()` uses. Holds the key: never pass this to a client component. */
export type ResolvedEmailSettings = {
  apiKey: string | null;
  apiKeySource: EmailSettingSource;
  from: string;
  fromSource: EmailSettingSource;
  replyTo: string;
  replyToSource: EmailSettingSource;
  recipient: GiftVoucherRecipient;
};

function pick(
  envValue: string | null | undefined,
  stored: string,
  isValid: (value: string) => boolean,
): { value: string; source: EmailSettingSource } {
  const fromEnv = (envValue ?? '').trim();
  // Env values are used as before (unvalidated): the provider is the judge.
  if (fromEnv) return { value: fromEnv, source: 'env' };
  const fromSetting = stored.trim();
  // Admin values are validated on save; a bad row is ignored rather than sent.
  if (fromSetting && isValid(fromSetting)) return { value: fromSetting, source: 'setting' };
  return { value: '', source: 'none' };
}

export function resolveEmailSettings(
  env: EmailEnv,
  stored: StoredEmailSettings,
): ResolvedEmailSettings {
  const envKey = (env.apiKey ?? '').trim();
  const apiKey = envKey || stored.apiKey || null;
  const from = pick(env.from, stored.config.from, (value) => senderProblem(value) === null);
  const replyTo = pick(env.replyTo, stored.config.replyTo, isValidRecipientAddress);
  return {
    apiKey,
    apiKeySource: envKey ? 'env' : stored.apiKey ? 'setting' : 'none',
    from: from.value,
    fromSource: from.source,
    replyTo: replyTo.value,
    replyToSource: replyTo.source,
    recipient: resolveGiftVoucherRecipient({
      env: env.giftVoucherRecipient,
      setting: stored.config.giftVoucherRecipient,
    }),
  };
}

/** Client-safe: what `/admin/email` shows. Never contains the key. */
export type EmailServiceStatus = {
  storeAvailable: boolean;
  apiKey: {
    source: EmailSettingSource;
    /** A sealed key is stored in the admin (used, overridden by env, or unreadable). */
    stored: boolean;
    /** Last four characters of the key stored in the admin; `null` otherwise. */
    hint: string | null;
    /** A key is stored in the admin but cannot be decrypted (secret rotated). */
    unreadable: boolean;
    /** A key is also stored in the admin while the env one wins. */
    storedButOverridden: boolean;
    updatedAt: string | null;
  };
  sender: { value: string; source: EmailSettingSource };
  replyTo: { value: string; source: EmailSettingSource };
  recipient: GiftVoucherRecipient;
  /** The admin's own values, to prefill the form. */
  stored: EmailServiceConfig;
  /** Key and sender: booking e-mails are sent. */
  ready: boolean;
  /** Key, sender and order inbox: "Bestel nu" can send. */
  voucherReady: boolean;
};

export function emailServiceStatus(
  resolved: ResolvedEmailSettings,
  stored: StoredEmailSettings,
): EmailServiceStatus {
  const ready = Boolean(resolved.apiKey && resolved.from);
  return {
    storeAvailable: stored.available,
    apiKey: {
      source: resolved.apiKeySource,
      stored: stored.apiKeyStored,
      hint: resolved.apiKeySource === 'setting' ? stored.apiKeyHint : null,
      unreadable: stored.apiKeyStored && stored.apiKey === null,
      storedButOverridden: resolved.apiKeySource === 'env' && stored.apiKeyStored,
      updatedAt: stored.apiKeyUpdatedAt ? stored.apiKeyUpdatedAt.toISOString() : null,
    },
    sender: { value: resolved.from, source: resolved.fromSource },
    replyTo: { value: resolved.replyTo, source: resolved.replyToSource },
    recipient: resolved.recipient,
    stored: { ...stored.config },
    ready,
    voucherReady: ready && Boolean(resolved.recipient.address),
  };
}

// ---------------------------------------------------------------------------
// Validation (Dutch messages for the admin form)
// ---------------------------------------------------------------------------

const NAMED_ADDRESS_RE = /^([^<>]*)<([^<>]+)>$/;
// No quotes, angle brackets, control characters or line breaks in a display name.
const DISPLAY_NAME_RE = /^[^"<>\p{Cc}]+$/u;

/** `naam@domein.be` or `De Bikefit Studio <naam@domein.be>`; `null` when neither. */
export function parseSender(value: string): { name: string | null; address: string } | null {
  const trimmed = value.trim();
  if (!trimmed || /\p{Cc}/u.test(trimmed)) return null;
  const named = NAMED_ADDRESS_RE.exec(trimmed);
  if (named) {
    const name = named[1].trim();
    const address = named[2].trim();
    if (!name || name.length > DISPLAY_NAME_MAX || !DISPLAY_NAME_RE.test(name)) return null;
    return isValidRecipientAddress(address) ? { name, address } : null;
  }
  return isValidRecipientAddress(trimmed) ? { name: null, address: trimmed } : null;
}

/** Empty is allowed (no sender: nothing is sent). */
export function senderProblem(value: string): string | null {
  if (!value.trim() || parseSender(value)) return null;
  return 'Afzender: gebruik naam@domein.be of De Bikefit Studio <naam@domein.be> (zonder aanhalingstekens).';
}

/** Empty is allowed (no Reply-To). */
export function replyToProblem(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || isValidRecipientAddress(trimmed)) return null;
  return 'Antwoordadres: vul één geldig e-mailadres in (bv. naam@domein.be), of laat het veld leeg.';
}

const RESEND_KEY_RE = /^re_[A-Za-z0-9_-]{8,}$/;

/** A key to store; it cannot be empty (removing is a separate action). */
export function apiKeyProblem(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Vul de API-sleutel in.';
  if (trimmed.length > API_KEY_MAX || !RESEND_KEY_RE.test(trimmed)) {
    return 'Dit lijkt geen Resend API-sleutel: die begint met “re_” en bevat geen spaties.';
  }
  return null;
}

/** Last four characters, for the masked display ("eindigt op …abcd"). */
export function apiKeyHint(key: string): string {
  return key.trim().slice(-4);
}

/** A single plain address for the test mail. */
export function testRecipientProblem(value: string): string | null {
  const trimmed = value.trim();
  if (isValidRecipientAddress(trimmed)) return null;
  return 'Testbericht: vul één geldig e-mailadres in.';
}

// ---------------------------------------------------------------------------
// Logs, audit and admin messages
// ---------------------------------------------------------------------------

/** Removes anything shaped like a Resend key from a provider message before it is logged or shown. */
export function redactSecrets(text: string): string {
  return text.replace(/re_[A-Za-z0-9_-]{4,}/g, 're_…');
}

/** A send failure as a short code for the audit log (no free text from outside). */
export function sendFailureCode(reason: string): string {
  return ['not_configured', 'missing_from', 'no_recipient'].includes(reason)
    ? reason
    : 'provider_error';
}

/**
 * A send failure in Dutch for the admin. `reason` is `sendEmail()`'s fixed
 * vocabulary (`HTTP 422: validation_error`, `request_failed: TimeoutError`,
 * …; never the provider's text), still redacted and cut short.
 */
export function describeSendFailure(reason: string): string {
  switch (reason) {
    case 'not_configured':
      return 'Niet verstuurd: er is geen API-sleutel ingesteld.';
    case 'missing_from':
      return 'Niet verstuurd: er is geen afzender ingesteld.';
    case 'no_recipient':
      return 'Niet verstuurd: er is geen ontvanger.';
    default:
      return `Niet verstuurd: de e-maildienst weigerde het bericht of was niet bereikbaar (${redactSecrets(reason).slice(0, 160)}).`;
  }
}
