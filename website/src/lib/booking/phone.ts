/**
 * Phone numbers on the booking form: Belgian by default, always written with
 * one `+32` prefix (work block 2026-10-16, Task 2). Plain module, no I/O; used
 * by the widget (on blur and before sending) and by `createPublicBooking()`
 * (validation and what is stored), unit-tested in `phone.test.ts`.
 *
 * Accepted, for a Belgian number (8 digits for a landline, 9 for a mobile,
 * after the trunk `0`; a mobile starts with 4, so `06 …` is not Belgian):
 *  - national: `0470 12 34 56`, `054/12.34.56`, `470123456`;
 *  - international: `+32 470 12 34 56`, `0032 470 12 34 56`, `32470123456`,
 *    and `+32 0470 …` (the trunk `0` typed after the prefix is dropped);
 *  - a full number pasted after the field's `+32 `: `+32 +32 470 …`,
 *    `+32 0032 470 …`, `+32 32 470 …`, `+32 +31 6 …`.
 * Never a second prefix: `+32` input stays `+32`, it does not become `+32 32`.
 *
 * Another country is kept as typed digits after `+` (or `00`), 8 to 15 digits
 * in all (E.164), so a visitor from across the border can still book.
 *
 * Linear: one character class, no backtracking. Callers check the length
 * first (`PUBLIC_BOOKING_LIMITS`), like every other booking pattern.
 */

export const BELGIAN_PREFIX = '+32';

/** Spaces, dots, slashes, dashes and brackets people type as separators. */
const SEPARATORS = /[\s().\/-]/g;
const DIGITS = /^\d+$/;

export type NormalizedPhone = {
  /** `+32470123456`: what a `tel:` link wants. */
  e164: string;
  /** `+32 470 12 34 56`: what the form shows and what a booking stores. */
  display: string;
};

/** Belgian area codes of one digit (Brussels, Antwerp, Liège, Ghent); the rest have two. */
const ONE_DIGIT_AREA = new Set(['2', '3', '4', '9']);

/** Groups a Belgian national number (without trunk `0`): `470123456` → `470 12 34 56`. */
function groupBelgian(national: string): string {
  if (national.length === 9) {
    return `${national.slice(0, 3)} ${national.slice(3, 5)} ${national.slice(5, 7)} ${national.slice(7)}`;
  }
  const area = ONE_DIGIT_AREA.has(national[0]) ? 1 : 2;
  const rest = national.slice(area);
  const groups =
    area === 1
      ? [rest.slice(0, 3), rest.slice(3, 5), rest.slice(5)]
      : [rest.slice(0, 2), rest.slice(2, 4), rest.slice(4)];
  return [national.slice(0, area), ...groups].join(' ');
}

function belgian(national: string): NormalizedPhone | null {
  // "32" typed again after the prefix ("+32 32 470 …"): a national number has
  // at most 10 digits with its trunk 0, so 10–11 digits starting with 32 are
  // the prefix twice. "+32 32 12 34 56" (Antwerp, 8 digits) is left alone.
  if (national.startsWith('32') && (national.length === 10 || national.length === 11)) {
    return belgian(national.slice(2));
  }
  // A trunk zero typed after the country code: "+32 0470 …".
  const digits = national.startsWith('0') ? national.slice(1) : national;
  if (digits.length < 8 || digits.length > 9 || digits.startsWith('0')) return null;
  // Nine digits is a mobile, and Belgian mobiles start with 4: "06 12345678"
  // is a Dutch or French number typed without its country code, not ours.
  if (digits.length === 9 && !digits.startsWith('4')) return null;
  return {
    e164: `${BELGIAN_PREFIX}${digits}`,
    display: `${BELGIAN_PREFIX} ${groupBelgian(digits)}`,
  };
}

/**
 * The normalized number, or `null` when it is not a phone number we can call.
 * Empty input is `null` too; whether the field is required is the caller's rule.
 */
export function normalizePhone(raw: string): NormalizedPhone | null {
  const compact = raw.trim().replace(SEPARATORS, '');
  if (!compact) return null;

  // The form starts an empty field with "+32 "; a full number pasted after it
  // ("+32 +32 470 …", "+32 0032 …", "+32 +31 6 …") counts as that number.
  for (const prefix of [BELGIAN_PREFIX, '0032']) {
    const rest = compact.slice(prefix.length);
    if (compact.startsWith(prefix) && (rest.startsWith('+') || rest.startsWith('00'))) {
      return normalizePhone(rest);
    }
  }

  let international: string | null = null;
  if (compact.startsWith('+')) international = compact.slice(1);
  else if (compact.startsWith('00')) international = compact.slice(2);

  if (international !== null) {
    if (!DIGITS.test(international)) return null;
    if (international.startsWith('32')) return belgian(international.slice(2));
    if (international.length < 8 || international.length > 15 || international.startsWith('0')) {
      return null;
    }
    return { e164: `+${international}`, display: `+${international}` };
  }

  if (!DIGITS.test(compact)) return null;
  // "32470123456": the prefix without "+". National numbers have 8 or 9
  // digits without the trunk 0, so 10–11 digits starting with 32 are not one.
  if (compact.startsWith('32') && (compact.length === 10 || compact.length === 11)) {
    return belgian(compact.slice(2));
  }
  return belgian(compact);
}

/** What the form shows after the visitor leaves the field: normalized, or as typed. */
export function formatPhoneForInput(raw: string): string {
  return normalizePhone(raw)?.display ?? raw.trim();
}

/** True when nothing but (part of) the `+32` prefix was typed. */
export function isBarePrefix(raw: string): boolean {
  const compact = raw.trim().replace(SEPARATORS, '');
  return compact === '' || compact === '+' || compact === '+3' || compact === BELGIAN_PREFIX;
}
