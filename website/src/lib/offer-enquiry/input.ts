import { z } from 'zod';
import { isBarePrefix, normalizePhone } from '@/lib/booking/phone';
import { EMAIL_RE, normalizeMessage, singleLine } from '@/lib/gift-voucher/order';

/**
 * The enquiry form on an offer page that is asked for, not booked online
 * (Beheer → Aanbod → "Enkel aanvraag"). Plain module: shared by the form
 * (instant feedback) and the server (the one that counts), unit-tested in
 * `input.test.ts`.
 *
 * Data minimisation: name, e-mail, an optional phone number, for a Volwassene
 * / Jeugd offering who it is for, and the question itself. Nothing is stored;
 * the enquiry lives only in the studio's mailbox (`delivery.ts`).
 *
 * Validation order (the booking and gift voucher rules): raw caps first
 * (schema), then each field's rule with length before pattern, so a pattern
 * never sees more than the field's limit.
 */

export const OFFER_ENQUIRY_LIMITS = {
  name: 120,
  email: 200,
  phone: 40,
  message: 2000,
} as const;

/** Technical caps on the raw request, far above the visitor-facing limits. */
export const OFFER_ENQUIRY_RAW_LIMITS = {
  offerSlug: 80,
  audience: 16,
  name: 500,
  email: 400,
  phone: 100,
  message: 8000,
  website: 400,
  requestId: 128,
} as const;

export const OFFER_ENQUIRY_SUBMIT_LABEL = 'Verstuur je aanvraag';
/** The offer page's button for an enquiry offering (it scrolls to the form). */
export const OFFER_ENQUIRY_CTA_LABEL = 'Vraag deze dienst aan';
/** The anchor of the form on the offer page. */
export const OFFER_ENQUIRY_ANCHOR = 'aanvraag';

export const OFFER_ENQUIRY_MESSAGES = {
  invalid: 'Controleer de gemarkeerde velden.',
  rejected: 'Je aanvraag kon niet verwerkt worden. Probeer het opnieuw of bel ons.',
  unavailable: 'Deze dienst kun je niet via dit formulier aanvragen.',
  rateLimited: 'Te veel aanvragen op korte tijd. Probeer het over een kwartier opnieuw of bel ons.',
  notSent:
    'Je aanvraag is niet verstuurd: er ging iets mis aan onze kant. Je gegevens staan nog in het formulier. Probeer het later opnieuw of bel ons.',
} as const;

export type OfferEnquiryField = 'audience' | 'name' | 'email' | 'phone' | 'message';

/** `''` = not asked (one option); else who the enquiry is for. */
export type OfferEnquiryAudience = '' | 'adult' | 'youth';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REQUEST_ID_RE = /^[A-Za-z0-9-]{16,64}$/;

const text = (max: number) => z.string().max(max).default('');

export const offerEnquiryInputSchema = z.object({
  offerSlug: text(OFFER_ENQUIRY_RAW_LIMITS.offerSlug),
  audience: text(OFFER_ENQUIRY_RAW_LIMITS.audience),
  name: text(OFFER_ENQUIRY_RAW_LIMITS.name),
  email: text(OFFER_ENQUIRY_RAW_LIMITS.email),
  phone: text(OFFER_ENQUIRY_RAW_LIMITS.phone),
  message: text(OFFER_ENQUIRY_RAW_LIMITS.message),
  /** Honeypot: reduced to "filled in?", never refused on its own. */
  website: z
    .string()
    .default('')
    .transform((value) => value.length > OFFER_ENQUIRY_RAW_LIMITS.website || value.trim() !== ''),
  /** Per-form id against a double submit; over the cap or malformed it is dropped. */
  requestId: z
    .string()
    .default('')
    .transform((value) => (value.length > OFFER_ENQUIRY_RAW_LIMITS.requestId ? '' : value)),
});

export type OfferEnquiry = {
  offerSlug: string;
  audience: OfferEnquiryAudience;
  name: string;
  email: string;
  /** Normalised (`+32 470 12 34 56`), or '' when not given. */
  phone: string;
  message: string;
  requestId: string | null;
};

export type OfferEnquiryValidation =
  | { ok: true; enquiry: OfferEnquiry; honeypot: boolean }
  | { ok: false; fieldErrors: Partial<Record<OfferEnquiryField, string>> };

const FIELD_MESSAGES: Record<OfferEnquiryField, string> = {
  audience: 'Kies voor wie de aanvraag is.',
  name: `Maximaal ${OFFER_ENQUIRY_LIMITS.name} tekens.`,
  email: 'Vul een geldig e-mailadres in.',
  phone: 'Vul een geldig telefoonnummer in.',
  message: `Maximaal ${OFFER_ENQUIRY_LIMITS.message} tekens.`,
};

function isField(key: PropertyKey | undefined): key is OfferEnquiryField {
  return typeof key === 'string' && Object.hasOwn(FIELD_MESSAGES, key);
}

/**
 * Validates one enquiry. `audiences` are the choices the offering has (none
 * for a single option, `adult` + `youth` for Volwassene/Jeugd); the server
 * passes the offering's own, so a crafted value never reaches the mail.
 */
export function validateOfferEnquiry(
  raw: unknown,
  audiences: readonly ('adult' | 'youth')[] = [],
): OfferEnquiryValidation {
  const parsed = offerEnquiryInputSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const errors: Partial<Record<OfferEnquiryField, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (issue.code !== 'too_big' || !isField(field)) {
        return { ok: false, fieldErrors: { name: 'Controleer je aanvraag.' } };
      }
      errors[field] = FIELD_MESSAGES[field];
    }
    return { ok: false, fieldErrors: errors };
  }
  const input = parsed.data;
  const errors: Partial<Record<OfferEnquiryField, string>> = {};

  const offerSlug = input.offerSlug.trim();
  if (!SLUG_RE.test(offerSlug))
    return { ok: false, fieldErrors: { name: 'Controleer je aanvraag.' } };

  let audience: OfferEnquiryAudience = '';
  if (audiences.length > 0) {
    const value = input.audience.trim();
    if (value === 'adult' || value === 'youth') {
      if (audiences.includes(value)) audience = value;
      else errors.audience = FIELD_MESSAGES.audience;
    } else {
      errors.audience = FIELD_MESSAGES.audience;
    }
  }

  const name = singleLine(input.name);
  if (name.length < 2) errors.name = 'Vul je naam in.';
  else if (name.length > OFFER_ENQUIRY_LIMITS.name) errors.name = FIELD_MESSAGES.name;

  // Length before pattern: EMAIL_RE never sees more than 200 characters.
  const email = singleLine(input.email);
  if (email.length > OFFER_ENQUIRY_LIMITS.email || !EMAIL_RE.test(email)) {
    errors.email = FIELD_MESSAGES.email;
  }

  let phone = '';
  const phoneText = singleLine(input.phone);
  if (!isBarePrefix(phoneText)) {
    const normalized =
      phoneText.length > OFFER_ENQUIRY_LIMITS.phone ? null : normalizePhone(phoneText);
    if (!normalized) errors.phone = FIELD_MESSAGES.phone;
    else phone = normalized.display;
  }

  const message = normalizeMessage(input.message);
  if (message.length > OFFER_ENQUIRY_LIMITS.message) errors.message = FIELD_MESSAGES.message;
  else if (message.length < 5) errors.message = 'Vertel kort wat je wil vragen.';

  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };

  const requestId = input.requestId.trim();
  return {
    ok: true,
    honeypot: input.website,
    enquiry: {
      offerSlug,
      audience,
      name,
      email,
      phone,
      message,
      requestId: REQUEST_ID_RE.test(requestId) ? requestId : null,
    },
  };
}
