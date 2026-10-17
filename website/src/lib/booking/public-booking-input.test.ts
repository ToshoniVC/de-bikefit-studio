import { describe, expect, it, vi } from 'vitest';
import {
  PUBLIC_BOOKING_LIMITS,
  PUBLIC_BOOKING_RAW_LIMITS,
  publicBookingInputSchema,
  storedPhone,
  validateBookingFields,
} from './public-booking-input';

// The request schema and the field rules of a public booking. Both run before the rate limit
// (`createPublicBooking()`), on input of any size, so they must stay cheap: input review
// 2026-10-14 §8, the booking sibling of R-1. Inputs stay small; nothing here depends on timing.

/** A complete, valid request; dummy data only. */
const VALID = {
  serviceId: 'svc-bikefit',
  providerId: null,
  startsAt: '2026-10-20T08:00:00.000Z',
  customerName: 'Kanarie Klant',
  customerEmail: 'kanarie.klant@lek-test.invalid',
  customerPhone: '+32 470 11 22 33',
  customerAge: 34,
  guardianName: 'Kanarie Voogd',
  guardianEmail: 'kanarie.voogd@lek-test.invalid',
  guardianPhone: '+32 499 98 76 54',
  customerAddress: 'Kanariestraat 17, 9999 Vogeldorp',
  bikeDetails: 'Kanarie Racer, maat 58',
  notes: 'Kanarie-notitie: knie links',
  website: '',
  locale: 'nl',
};

/** The limits and raw caps, pinned here so that changing one is a deliberate decision. */
const LIMITS = {
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
const RAW = {
  serviceId: 64,
  providerId: 64,
  locationId: 64,
  startsAt: 64,
  customerName: 500,
  customerEmail: 400,
  customerPhone: 100,
  customerAge: 16,
  guardianName: 500,
  guardianEmail: 400,
  guardianPhone: 100,
  customerAddress: 600,
  bikeDetails: 1000,
  notes: 4000,
  website: 400,
  locale: 16,
} as const;

const EMAIL = 'Vul een geldig e-mailadres in.';
const PHONE = 'Vul een geldig telefoonnummer in.';

/** What the schema says to a field one character over its raw cap. */
const OVER_CAP: Record<keyof typeof RAW, string> = {
  serviceId: 'Ongeldige invoer.',
  providerId: 'Ongeldige invoer.',
  locationId: 'Ongeldige invoer.',
  startsAt: 'Ongeldige invoer.',
  customerName: 'Maximaal 120 tekens.',
  customerEmail: 'Maximaal 200 tekens.',
  customerPhone: PHONE,
  customerAge: 'Ongeldige invoer.',
  guardianName: 'Maximaal 120 tekens.',
  guardianEmail: 'Maximaal 200 tekens.',
  guardianPhone: PHONE,
  customerAddress: 'Maximaal 300 tekens.',
  bikeDetails: 'Maximaal 500 tekens.',
  notes: 'Maximaal 2000 tekens.',
  website: 'Ongeldige invoer.',
  locale: 'Ongeldige invoer.',
};

type Parsed = ReturnType<typeof publicBookingInputSchema.parse>;
type Requirements = Parameters<typeof validateBookingFields>[1];

/**
 * The field rules on `VALID` with `changes` put in AFTER the schema, so no raw cap is in the way:
 * this tests the rules on their own, as a second line behind the schema.
 */
function rules(changes: Record<string, unknown> = {}, requirements?: Requirements) {
  const input = { ...publicBookingInputSchema.parse(VALID), ...changes } as Parsed;
  return validateBookingFields(input, requirements);
}

/** Every string a pattern ran on during `run`: test, match, replace and split all call `exec`. */
function patternInputs(run: () => unknown): string[] {
  const exec = vi.spyOn(RegExp.prototype, 'exec');
  try {
    run();
    return exec.mock.calls.map(([value]) => String(value));
  } finally {
    exec.mockRestore();
  }
}

/** `a@` + dots + `@`, `length` characters: the e-mail pattern backtracks quadratically on it. */
const dotted = (length: number) => `a@${'.'.repeat(length - 3)}@`;
/** Only characters the phone pattern accepts, so it would run up to its own bound. */
const digits = (length: number) => '0'.repeat(length);
/** A well-formed address of exactly `length` characters. */
const emailOf = (length: number) => `${'k'.repeat(length - 17)}@lek-test.invalid`;

describe('validateBookingFields: unchanged for ordinary input', () => {
  it('accepts a complete request, also when a guardian and an address are required', () => {
    expect(rules()).toEqual({});
    expect(rules({}, { requiresGuardian: true, requiresAddress: true })).toEqual({});
  });

  it.each([
    ['a malformed e-mail', { customerEmail: 'geen-mail' }, {}, { customerEmail: EMAIL }],
    ['no e-mail', { customerEmail: '' }, {}, { customerEmail: EMAIL }],
    ['an e-mail of exactly 200 characters', { customerEmail: emailOf(200) }, {}, {}],
    [
      'a well-formed e-mail of 201 characters',
      { customerEmail: emailOf(201) },
      {},
      { customerEmail: 'Maximaal 200 tekens.' },
    ],
    ['a malformed guardian e-mail', { guardianEmail: 'geen-mail' }, {}, { guardianEmail: EMAIL }],
    ['a phone number in words', { customerPhone: 'bel me' }, {}, { customerPhone: PHONE }],
    ['a guardian phone that is too short', { guardianPhone: '12' }, {}, { guardianPhone: PHONE }],
    [
      '26 digits (within 40, over the 25 of the pattern)',
      { customerPhone: digits(26) },
      {},
      { customerPhone: PHONE },
    ],
    ['a one-letter name', { customerName: 'K' }, {}, { customerName: 'Vul je naam in.' }],
    ['an age of 0', { customerAge: 0 }, {}, { customerAge: 'Vul een geldige leeftijd in.' }],
    ['an age as text', { customerAge: '34' }, {}, {}],
    ['no service', { serviceId: '' }, {}, { serviceId: 'Kies een dienst.' }],
    ['a start that is no date', { startsAt: 'morgen' }, {}, { startsAt: 'Kies een tijdstip.' }],
    [
      'notes of 2001 characters',
      { notes: 'k'.repeat(2001) },
      {},
      { notes: 'Maximaal 2000 tekens.' },
    ],
    [
      'a required guardian left out',
      { guardianName: '' },
      { requiresGuardian: true },
      { guardianName: 'Vul de naam van een ouder of voogd in.' },
    ],
    [
      'a required address too short',
      { customerAddress: 'Kort' },
      { requiresAddress: true },
      { customerAddress: 'Vul het adres in waar we langskomen.' },
    ],
  ])('%s → its message, as before', (_label, changes, requirements, expected) => {
    expect(rules(changes, requirements)).toEqual(expected);
  });

  it('reports every field at once', () => {
    expect(
      rules({
        customerName: 'K',
        customerEmail: emailOf(201),
        customerPhone: 'bel me',
        notes: 'k'.repeat(2001),
      }),
    ).toEqual({
      customerName: 'Vul je naam in.',
      customerEmail: 'Maximaal 200 tekens.',
      customerPhone: PHONE,
      notes: 'Maximaal 2000 tekens.',
    });
  });
});

describe('validateBookingFields: length before pattern', () => {
  it('the patterns still run on values within their limits (the spy sees them)', () => {
    expect(patternInputs(() => rules())).toEqual(
      expect.arrayContaining([
        VALID.customerEmail,
        VALID.customerPhone,
        VALID.guardianEmail,
        VALID.guardianPhone,
      ]),
    );
    let errors: Record<string, string> = {};
    const seen = patternInputs(() => {
      errors = rules({ customerEmail: dotted(200) });
    });
    expect(seen).toContain(dotted(200));
    expect(errors).toEqual({ customerEmail: EMAIL });
  });

  it.each([
    ['customerEmail', dotted, 'Maximaal 200 tekens.'],
    ['guardianEmail', dotted, 'Maximaal 200 tekens.'],
    ['customerPhone', digits, PHONE],
    ['guardianPhone', digits, PHONE],
  ] as const)(
    '%s: no pattern sees more than its limit, even past the schema',
    (field, shape, message) => {
      const limit = LIMITS[field];
      for (const length of [limit + 1, RAW[field], 1000]) {
        let errors: Record<string, string> = {};
        const seen = patternInputs(() => {
          errors = rules({ [field]: shape(length) });
        });
        const tooLong = seen.map((value) => value.length).filter((n) => n > limit);
        expect(tooLong, `${length} characters: pattern input lengths`).toEqual([]);
        expect(errors, `${length} characters`).toEqual({ [field]: message });
      }
    },
  );

  it('over its limit: an e-mail gets the length message, a phone number the phone message', () => {
    // An over-long e-mail that is also malformed used to get the e-mail message (the pattern ran
    // first); a phone number over 40 characters always got the phone message, and still does.
    expect(rules({ customerEmail: emailOf(201) })).toEqual({
      customerEmail: 'Maximaal 200 tekens.',
    });
    expect(rules({ customerEmail: 'k'.repeat(201) })).toEqual({
      customerEmail: 'Maximaal 200 tekens.',
    });
    expect(rules({ customerPhone: digits(41) })).toEqual({ customerPhone: PHONE });
    expect(rules({ customerPhone: 'bel me '.repeat(6) })).toEqual({ customerPhone: PHONE });
  });
});

describe('publicBookingInputSchema: raw caps', () => {
  it('are technical bounds: pinned, at least twice each visitor-facing limit', () => {
    expect(PUBLIC_BOOKING_RAW_LIMITS).toEqual(RAW);
    expect(PUBLIC_BOOKING_LIMITS).toEqual(LIMITS);
    for (const field of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
      expect(RAW[field], field).toBeGreaterThanOrEqual(2 * LIMITS[field]);
    }
  });

  it.each(Object.entries(OVER_CAP))(
    '%s: passes the schema up to its cap; one character more → %j on that field',
    (field, message) => {
      const cap = RAW[field as keyof typeof RAW];
      const atCap = publicBookingInputSchema.safeParse({ ...VALID, [field]: 'k'.repeat(cap) });
      expect(atCap.success).toBe(true);
      const over = publicBookingInputSchema.safeParse({ ...VALID, [field]: 'k'.repeat(cap + 1) });
      expect(over.error?.issues.map((issue) => [issue.path, issue.message])).toEqual([
        [[field], message],
      ]);
    },
  );

  it('a field over its limit gets the same message from the rules as over its cap', () => {
    for (const field of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
      expect(rules({ [field]: 'k'.repeat(LIMITS[field] + 1) }), field).toEqual({
        [field]: OVER_CAP[field],
      });
    }
  });

  it('counts the value as sent: padding up to the cap is trimmed away, one more is refused', () => {
    const padded = VALID.customerEmail.padStart(RAW.customerEmail, ' ');
    const parsed = publicBookingInputSchema.parse({ ...VALID, customerEmail: padded });
    expect(parsed.customerEmail).toBe(VALID.customerEmail);
    expect(validateBookingFields(parsed)).toEqual({});
    const over = publicBookingInputSchema.safeParse({ ...VALID, customerEmail: ` ${padded}` });
    expect(over.success).toBe(false);
  });

  it('reports every field over its cap at once, and a wrong type as before', () => {
    const result = publicBookingInputSchema.safeParse({
      ...VALID,
      customerName: 'k'.repeat(RAW.customerName + 1),
      customerEmail: dotted(RAW.customerEmail + 1),
      notes: 'k'.repeat(RAW.notes + 1),
      website: 42,
    });
    expect(result.error?.issues.map((issue) => [issue.path[0], issue.message])).toEqual([
      ['customerName', 'Maximaal 120 tekens.'],
      ['customerEmail', 'Maximaal 200 tekens.'],
      ['notes', 'Maximaal 2000 tekens.'],
      ['website', 'Ongeldige invoer.'],
    ]);
  });

  it('runs no pattern, however long the value', () => {
    const seen = patternInputs(() =>
      publicBookingInputSchema.safeParse({
        ...VALID,
        customerEmail: dotted(1000),
        guardianPhone: digits(1000),
      }),
    );
    expect(seen).toEqual([]);
  });
});

describe('phone numbers: Belgian by default, stored with one +32 (16 Oct 2026)', () => {
  const rulesFor = (fields: Partial<typeof VALID>) =>
    validateBookingFields(publicBookingInputSchema.parse({ ...VALID, ...fields }));

  it('accepts a local and an international Belgian number for customer and guardian', () => {
    for (const phone of [
      '0470 12 34 56',
      '+32 470 12 34 56',
      '0032 470 12 34 56',
      '054 12 34 56',
    ]) {
      expect(rulesFor({ customerPhone: phone, guardianPhone: phone }), phone).toEqual({});
    }
  });

  it('refuses a number that is too short or too long once the prefix is accounted for', () => {
    for (const phone of ['0470 12 34', '+32 470 12 34 56 78', '+32 32']) {
      expect(rulesFor({ customerPhone: phone }), phone).toEqual({
        customerPhone: 'Vul een geldig telefoonnummer in.',
      });
      expect(rulesFor({ guardianPhone: phone }), phone).toEqual({
        guardianPhone: 'Vul een geldig telefoonnummer in.',
      });
    }
  });

  it('stores the normalized form, never a second prefix, null when empty', () => {
    expect(storedPhone('0470 12 34 56')).toBe('+32 470 12 34 56');
    expect(storedPhone('+32 470 12 34 56')).toBe('+32 470 12 34 56');
    expect(storedPhone('0032470123456')).toBe('+32 470 12 34 56');
    expect(storedPhone('+31 6 12345678')).toBe('+31612345678');
    expect(storedPhone('')).toBeNull();
  });
});
