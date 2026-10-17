import { z } from 'zod';
import { DEFAULT_LOCALE } from '@/db/cms-schema';
import { normalizePhone } from './phone';

/**
 * Public booking input, the pure half of `./public-booking.ts`: the request
 * schema and the field rules with Dutch messages. No I/O, unit-tested in
 * `public-booking-input.test.ts`.
 *
 * `createPublicBooking()` runs both BEFORE its rate limit (a malformed form
 * never costs a hit), and it is the validation boundary for every caller: the
 * widget's server action caps its fields lower first, the self-test calls it
 * directly. So both stay cheap on input of any size, in two layers: the schema
 * caps every raw string ({@link PUBLIC_BOOKING_RAW_LIMITS}), and the rules
 * check a value's length ({@link PUBLIC_BOOKING_LIMITS}) before any pattern
 * sees it (input review 2026-10-14 §8, the booking sibling of R-1).
 */

/**
 * Visitor-facing limits, on the trimmed value. A longer value gets
 * `Maximaal N tekens.`; a longer phone number `Vul een geldig telefoonnummer in.`
 */
export const PUBLIC_BOOKING_LIMITS = {
  customerName: 120,
  customerEmail: 200,
  customerPhone: 40,
  guardianName: 120,
  guardianEmail: 200,
  guardianPhone: 40,
  customerAddress: 300,
  bikeDetails: 500,
  notes: 2000,
} as const;

/**
 * Caps on the RAW request strings, counted as sent (before trimming) and
 * checked by the schema before any rule or pattern runs. Technical bounds, not
 * booking rules: at least twice each visitor-facing limit and never below the
 * caps of the widget's action (`public-actions.ts`), so an ordinary over-long
 * field still reaches the rules (every field's message at once) and only an
 * absurd payload stops here. Over its cap a field gets the message the rules
 * give a value over its limit; the other fields, which the widget never sends
 * as free text (ids, start, an age sent as text, honeypot, locale), get
 * `Ongeldige invoer.`, as a wrong type does.
 */
export const PUBLIC_BOOKING_RAW_LIMITS = {
  serviceId: 64,
  providerId: 64,
  locationId: 64,
  startsAt: 64,
  customerName: 500,
  customerEmail: 400,
  customerPhone: 100,
  /** Only an age sent as text; a number has no length. */
  customerAge: 16,
  guardianName: 500,
  guardianEmail: 400,
  guardianPhone: 100,
  customerAddress: 600,
  bikeDetails: 1000,
  notes: 4000,
  /** The honeypot. */
  website: 400,
  locale: 16,
} as const;

const LIMITS = PUBLIC_BOOKING_LIMITS;
const RAW = PUBLIC_BOOKING_RAW_LIMITS;

const INVALID = 'Ongeldige invoer.';
const TYPE_ERROR = { error: INVALID };
const EMAIL_MESSAGE = 'Vul een geldig e-mailadres in.';
const PHONE_MESSAGE = 'Vul een geldig telefoonnummer in.';
const tooLong = (max: number) => `Maximaal ${max} tekens.`;

/**
 * A raw text field: over `cap` characters (as sent) a `too_big` issue with
 * `message`; otherwise trimmed, `''` when absent.
 */
const text = (cap: number, message: string) =>
  z.string(TYPE_ERROR).max(cap, { error: message }).trim().default('');

/**
 * Structural schema: types, raw caps ({@link PUBLIC_BOOKING_RAW_LIMITS}),
 * trimming, defaults. Rules live in {@link validateBookingFields}.
 */
export const publicBookingInputSchema = z.object({
  serviceId: text(RAW.serviceId, INVALID),
  /**
   * Empty / null = "Iedereen": the first free provider (admin order) holds the
   * slot; with more than one provider offering the service the beheerder
   * assigns the booking afterwards (`assignment = 'pending'`).
   */
  providerId: z.string(TYPE_ERROR).max(RAW.providerId, TYPE_ERROR).trim().nullable().default(null),
  /** The slot's location as `getAvailability()` returned it; null = any location at that start. */
  locationId: z.string(TYPE_ERROR).max(RAW.locationId, TYPE_ERROR).trim().nullable().default(null),
  /** ISO instant of the chosen slot, exactly as returned by `getAvailability()`. */
  startsAt: text(RAW.startsAt, INVALID),
  customerName: text(RAW.customerName, tooLong(LIMITS.customerName)),
  customerEmail: text(RAW.customerEmail, tooLong(LIMITS.customerEmail)),
  customerPhone: text(RAW.customerPhone, PHONE_MESSAGE),
  customerAge: z
    .union([z.number(), z.string().max(RAW.customerAge, TYPE_ERROR), z.null()], TYPE_ERROR)
    .default(null),
  guardianName: text(RAW.guardianName, tooLong(LIMITS.guardianName)),
  guardianEmail: text(RAW.guardianEmail, tooLong(LIMITS.guardianEmail)),
  guardianPhone: text(RAW.guardianPhone, PHONE_MESSAGE),
  /** Required when the resolved location is of kind `customer`. */
  customerAddress: text(RAW.customerAddress, tooLong(LIMITS.customerAddress)),
  bikeDetails: text(RAW.bikeDetails, tooLong(LIMITS.bikeDetails)),
  notes: text(RAW.notes, tooLong(LIMITS.notes)),
  /** Honeypot: must stay empty. */
  website: text(RAW.website, INVALID),
  locale: z.string(TYPE_ERROR).max(RAW.locale, TYPE_ERROR).trim().default(DEFAULT_LOCALE),
});

export type PublicBookingInput = z.input<typeof publicBookingInputSchema>;
type ParsedInput = z.output<typeof publicBookingInputSchema>;

/**
 * A plain address. Backtracks quadratically on a long run of dots (`a@....@`),
 * so only ever test a value whose length was checked first (at most 200
 * characters, {@link PUBLIC_BOOKING_LIMITS}).
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Linear (one bounded quantifier), and likewise only tested within its limit (40). */
const PHONE_RE = /^[+0-9()./\s-]{6,25}$/;

/**
 * A phone number we can call: the old character pattern, then a Belgian (or
 * explicitly international) number per `normalizePhone()` (`./phone.ts`).
 * Only ever called within the field's limit.
 */
const isCallable = (value: string) => PHONE_RE.test(value) && normalizePhone(value) !== null;

/**
 * The stored form of an optional phone number: `+32 470 12 34 56` (one `+32`,
 * never two), `null` when empty. Call only on input that passed
 * {@link validateBookingFields}; anything else is kept as typed.
 */
export function storedPhone(value: string): string | null {
  if (!value) return null;
  return normalizePhone(value)?.display ?? value;
}

/** Field rules with Dutch messages; returns `{ field: message }` (empty when valid). */
export function validateBookingFields(
  input: ParsedInput,
  requirements: { requiresGuardian?: boolean; requiresAddress?: boolean } = {},
): Record<string, string> {
  const errors: Record<string, string> = {};
  const set = (field: string, message: string) => {
    errors[field] ??= message;
  };
  const withinLimit = (field: keyof typeof LIMITS) => input[field].length <= LIMITS[field];

  if (!input.serviceId) set('serviceId', 'Kies een dienst.');
  if (!input.startsAt || Number.isNaN(Date.parse(input.startsAt)))
    set('startsAt', 'Kies een tijdstip.');
  if (input.customerName.length < 2) set('customerName', 'Vul je naam in.');
  // Length before pattern: no pattern ever sees more than its field's limit.
  // An e-mail over it gets the length message from the loop below; a phone
  // number over it is no phone number (the pattern allows 25), as before.
  if (withinLimit('customerEmail') && !EMAIL_RE.test(input.customerEmail)) {
    set('customerEmail', EMAIL_MESSAGE);
  }
  if (input.customerPhone && (!withinLimit('customerPhone') || !isCallable(input.customerPhone))) {
    set('customerPhone', PHONE_MESSAGE);
  }
  if (input.guardianEmail && withinLimit('guardianEmail') && !EMAIL_RE.test(input.guardianEmail)) {
    set('guardianEmail', EMAIL_MESSAGE);
  }
  if (input.guardianPhone && (!withinLimit('guardianPhone') || !isCallable(input.guardianPhone))) {
    set('guardianPhone', PHONE_MESSAGE);
  }

  const age = input.customerAge;
  if (age !== null && age !== '') {
    const n = Number(age);
    if (!Number.isInteger(n) || n < 1 || n > 120)
      set('customerAge', 'Vul een geldige leeftijd in.');
  }

  if (requirements.requiresGuardian && input.guardianName.length < 2) {
    set('guardianName', 'Vul de naam van een ouder of voogd in.');
  }
  if (requirements.requiresAddress && input.customerAddress.length < 5) {
    set('customerAddress', 'Vul het adres in waar we langskomen.');
  }

  for (const [field, max] of Object.entries(LIMITS)) {
    const value = input[field as keyof ParsedInput];
    if (typeof value === 'string' && value.length > max) set(field, tooLong(max));
  }
  return errors;
}
