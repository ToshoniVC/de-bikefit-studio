import { describe, expect, it, vi } from 'vitest';
import { deliverGiftVoucherOrder } from './delivery';
import {
  EMAIL_RE,
  GIFT_VOUCHER_LIMITS,
  GIFT_VOUCHER_MESSAGES,
  GIFT_VOUCHER_RAW_LIMITS,
  normalizeMessage,
  parseEuroAmountToCents,
  singleLine,
  validateGiftVoucherOrder,
} from './order';

const valid = {
  amount: '50',
  message: 'Veel fietsplezier!',
  name: 'An Peeters',
  email: 'an@example.com',
  phone: '',
  website: '',
  requestId: '3f1c2a9e-7b4d-4c1e-9a8f-0d2b6e5c4a31',
};

/** The raw caps, pinned here so that changing one is a deliberate decision (R-1, 2026-10-14). */
const RAW = {
  amount: 64,
  message: 4000,
  name: 500,
  email: 400,
  phone: 100,
  website: 400,
  requestId: 128,
} as const;

describe('parseEuroAmountToCents (Belgian notation)', () => {
  it.each([
    ['50', 5000],
    ['50,5', 5050],
    ['50,50', 5050],
    ['75,05', 7505],
    ['50.50', 5050],
    ['1.250', 125000],
    ['1.250,00', 125000],
    ['1 250', 125000],
    ['€ 50', 5000],
    ['€50,00', 5000],
    ['50 €', 5000],
    ['50 EUR', 5000],
    ['50 euro', 5000],
    ['50,-', 5000],
    ['€ 25,-', 2500],
    ['007', 700],
    ['0,99', 99],
  ])('%s → %i cents', (input, cents) => {
    expect(parseEuroAmountToCents(input)).toBe(cents);
  });

  it.each([
    '',
    'vijftig',
    '-50',
    '50,555',
    '1,250.00',
    '5e3',
    '50..0',
    '€',
    '1.2.3',
    '12345678901',
  ])('rejects %j', (input) => {
    expect(parseEuroAmountToCents(input)).toBeNull();
  });
});

describe('plain-text normalising', () => {
  it('keeps line breaks in the message, drops control and bidi characters', () => {
    expect(normalizeMessage('  Hallo\r\nfan‮!\u0007\n\n\n\nGroet  ')).toBe('Hallo\nfan!\n\nGroet');
  });

  it('turns a name into one clean line', () => {
    expect(singleLine(' An\nPeeters\t​ ')).toBe('An Peeters');
  });

  // Trailing whitespace per line used to go through `line.replace(/\s+$/, '')`, which is
  // quadratic on a long run of whitespace followed by any other character. `trimEnd()` is
  // linear and strips the same set (WhiteSpace + LineTerminator), checked here exhaustively.
  it('trims line ends exactly like the old /\\s+$/ did, for every UTF-16 code unit', () => {
    const differs: string[] = [];
    for (let code = 0; code <= 0xffff; code += 1) {
      const line = `x${String.fromCharCode(code)}`;
      if (line.trimEnd() !== line.replace(/\s+$/, '')) differs.push(code.toString(16));
    }
    expect(differs).toEqual([]);
  });

  it.each([
    ['spaces', 'Hallo   \nDag  ', 'Hallo\nDag'],
    ['tabs', 'Hallo\t\t\nDag\t', 'Hallo\nDag'],
    ['non-breaking spaces', 'Hallo\u{a0}\u{a0}\nDag\u{202f}\u{a0}', 'Hallo\nDag'],
    [
      'mixed, with a BOM and Unicode separators',
      'Hallo \u{feff}\u{a0}\t\u{3000}\u{2028}\nDag \u{2029}',
      'Hallo\nDag',
    ],
    ['CRLF and CR line ends', 'Hallo \r\nDag\t\rGroet', 'Hallo\nDag\nGroet'],
    ['whitespace-only lines', 'Hallo\n \t\u{a0}\nDag', 'Hallo\n\nDag'],
    ['runs of whitespace-only lines', 'A\n \n\t\n\u{a0}\n\nB', 'A\n\nB'],
    [
      'inner and leading whitespace kept',
      'Hallo  daar\n  Dag\u{a0}jij',
      'Hallo  daar\n  Dag\u{a0}jij',
    ],
  ])('trims trailing whitespace per line: %s', (_label, input, expected) => {
    expect(normalizeMessage(input)).toBe(expected);
  });

  it('handles long whitespace runs (quadratic for the old pattern, linear now)', () => {
    expect(normalizeMessage(`${' '.repeat(4000)}a`)).toBe('a');
    expect(normalizeMessage(`a${' '.repeat(4000)}b \n`)).toBe(`a${' '.repeat(4000)}b`);
    expect(normalizeMessage(`a${'\t'.repeat(2000)}${' '.repeat(2000)}`)).toBe('a');
  });
});

describe('validateGiftVoucherOrder', () => {
  it('accepts a complete order and normalises it', () => {
    const result = validateGiftVoucherOrder({
      ...valid,
      amount: '€ 75,50',
      email: ' an@example.com ',
    });
    expect(result).toEqual({
      ok: true,
      honeypot: false,
      order: {
        amountCents: 7550,
        message: 'Veel fietsplezier!',
        name: 'An Peeters',
        email: 'an@example.com',
        phone: '',
        requestId: valid.requestId,
      },
    });
  });

  it('requires an amount, a name and a valid e-mail; message and phone are optional', () => {
    const result = validateGiftVoucherOrder({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.fieldErrors).sort()).toEqual(['amount', 'email', 'name']);
    }
    expect(validateGiftVoucherOrder({ ...valid, message: '', phone: '' }).ok).toBe(true);
  });

  it('refuses zero, tiny, huge and malformed amounts with a Dutch message', () => {
    for (const amount of [
      '0',
      '0,50',
      '5000,01',
      'abc',
      '1'.repeat(GIFT_VOUCHER_LIMITS.amount + 1),
    ]) {
      const result = validateGiftVoucherOrder({ ...valid, amount });
      expect(result.ok, amount).toBe(false);
      if (!result.ok) expect(result.fieldErrors.amount).toMatch(/bedrag/i);
    }
    expect(validateGiftVoucherOrder({ ...valid, amount: '5000' }).ok).toBe(true);
  });

  it('bounds the personal message after normalising', () => {
    const long = 'a'.repeat(GIFT_VOUCHER_LIMITS.message + 1);
    const result = validateGiftVoucherOrder({ ...valid, message: long });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.message).toBe('Maximaal 500 tekens.');
    const padded = `  ${'a'.repeat(GIFT_VOUCHER_LIMITS.message)}\r\n  `;
    expect(validateGiftVoucherOrder({ ...valid, message: padded }).ok).toBe(true);
  });

  it('checks the phone number only when one is given', () => {
    expect(validateGiftVoucherOrder({ ...valid, phone: '0473 95 26 33' }).ok).toBe(true);
    const result = validateGiftVoucherOrder({ ...valid, phone: 'bel me' });
    expect(result.ok).toBe(false);
  });

  it('flags the honeypot and drops a malformed request id instead of failing', () => {
    const result = validateGiftVoucherOrder({
      ...valid,
      website: 'spam.example',
      requestId: '<x>',
    });
    expect(result.ok && result.honeypot).toBe(true);
    expect(result.ok && result.order.requestId).toBeNull();
  });

  it('treats non-string input as invalid, never throws', () => {
    expect(validateGiftVoucherOrder({ amount: 50 }).ok).toBe(false);
    expect(validateGiftVoucherOrder(null).ok).toBe(false);
  });

  it('accepts a long but valid message within the raw cap and normalises it as before', () => {
    const message = `${' \t'.repeat(1000)}Veel\u{a0} \r\nfietsplezier!${' '.repeat(500)}\r\n\r\n\r\n\r\nGroetjes ${'\t'.repeat(400)}`;
    expect(message.length).toBeLessThanOrEqual(RAW.message);
    expect(validateGiftVoucherOrder({ ...valid, message })).toMatchObject({
      ok: true,
      order: { message: 'Veel\nfietsplezier!\n\nGroetjes' },
    });
  });
});

// R-1 (input review 2026-10-14): validation runs before the rate limit, on a server-action body of
// up to 6 MB, so every raw field is capped by the schema before any normalising or pattern runs.
// Inputs stay at the caps: no test here depends on timing.
describe('raw input caps', () => {
  /** `value` with leading spaces up to exactly `length` characters; normalising drops them. */
  const padTo = (length: number, value: string) => value.padStart(length, ' ');

  it('are technical bounds, far above the visitor-facing limits', () => {
    expect(GIFT_VOUCHER_RAW_LIMITS).toEqual(RAW);
    for (const field of ['amount', 'message', 'name', 'email', 'phone'] as const) {
      expect(RAW[field], field).toBeGreaterThanOrEqual(2 * GIFT_VOUCHER_LIMITS[field]);
    }
  });

  it.each([
    ['amount', '50', 'Vul een bedrag in euro in, bijvoorbeeld 50 of 75,50.'],
    ['message', 'Veel fietsplezier!', 'Maximaal 500 tekens.'],
    ['name', 'An Peeters', 'Maximaal 120 tekens.'],
    ['email', 'an@example.com', 'Vul een geldig e-mailadres in.'],
    ['phone', '0473 95 26 33', 'Vul een geldig telefoonnummer in.'],
  ] as const)(
    '%s: padding up to the cap changes nothing, one character more gets the field message',
    (field, value, message) => {
      const plain = validateGiftVoucherOrder({ ...valid, [field]: value });
      expect(plain.ok).toBe(true);
      expect(validateGiftVoucherOrder({ ...valid, [field]: padTo(RAW[field], value) })).toEqual(
        plain,
      );
      expect(validateGiftVoucherOrder({ ...valid, [field]: padTo(RAW[field] + 1, value) })).toEqual(
        { ok: false, fieldErrors: { [field]: message } },
      );
    },
  );

  it('reports every field over its cap at once, each with its own message', () => {
    expect(
      validateGiftVoucherOrder({
        amount: '1'.repeat(RAW.amount + 1),
        message: 'a'.repeat(RAW.message + 1),
        name: 'b'.repeat(RAW.name + 1),
        email: 'c'.repeat(RAW.email + 1),
        phone: '2'.repeat(RAW.phone + 1),
      }),
    ).toEqual({
      ok: false,
      fieldErrors: {
        amount: 'Vul een bedrag in euro in, bijvoorbeeld 50 of 75,50.',
        message: 'Maximaal 500 tekens.',
        name: 'Maximaal 120 tekens.',
        email: 'Vul een geldig e-mailadres in.',
        phone: 'Vul een geldig telefoonnummer in.',
      },
    });
  });

  it('keeps the one generic message for a malformed request, also next to an over-long field', () => {
    const generic = { ok: false, fieldErrors: { amount: 'Controleer je aanvraag.' } };
    expect(validateGiftVoucherOrder({ ...valid, amount: 50 })).toEqual(generic);
    expect(validateGiftVoucherOrder({ ...valid, website: ['spam'] })).toEqual(generic);
    expect(validateGiftVoucherOrder({ ...valid, requestId: 42 })).toEqual(generic);
    expect(validateGiftVoucherOrder('amount=50')).toEqual(generic);
    expect(
      validateGiftVoucherOrder({ ...valid, name: 42, message: 'a'.repeat(RAW.message + 1) }),
    ).toEqual(generic);
  });

  it('never hands more than 200 characters to the e-mail pattern', () => {
    const patternTest = vi.spyOn(EMAIL_RE, 'test');
    try {
      // `a@` + dots + `@` makes the pattern backtrack quadratically; the old code tested it
      // before the length. The first two are within the raw cap, so they reach that rule.
      for (const email of [
        `a@${'.'.repeat(RAW.email - 3)}@`,
        `${'a'.repeat(GIFT_VOUCHER_LIMITS.email)}@example.com`,
        `a@${'.'.repeat(RAW.email)}@`,
      ]) {
        expect(validateGiftVoucherOrder({ ...valid, email })).toEqual({
          ok: false,
          fieldErrors: { email: 'Vul een geldig e-mailadres in.' },
        });
      }
      expect(validateGiftVoucherOrder(valid).ok).toBe(true);
      expect(patternTest.mock.calls).toEqual([[valid.email]]);
    } finally {
      patternTest.mockRestore();
    }
  });

  it.each([
    ['a short value', true, 'spam.example'],
    ['only whitespace (as before: not filled in)', false, ' \t '],
    ['only whitespace, up to the cap', false, ' '.repeat(RAW.website)],
    ['anything over the cap, even whitespace', true, ' '.repeat(RAW.website + 1)],
    ['a long value', true, 'x'.repeat(RAW.website + 1)],
    ['a value behind whitespace up to the cap', true, `${' '.repeat(RAW.website)}x`],
  ])('honeypot: %s → %s', (_label, honeypot, website) => {
    expect(validateGiftVoucherOrder({ ...valid, website })).toMatchObject({ ok: true, honeypot });
  });

  it('refuses a filled-in honeypot of any length before any lookup, rate limit or mail', async () => {
    for (const website of [
      'spam.example',
      ' '.repeat(RAW.website + 1),
      'x'.repeat(RAW.website * 10),
    ]) {
      const store = {
        wasSent: vi.fn(async () => false),
        countAttempts: vi.fn(async () => 0),
        recordAttempt: vi.fn(async () => {}),
        markSent: vi.fn(async () => {}),
      };
      const send = vi.fn(async () => ({ sent: true as const, id: 'em_1' }));
      const result = await deliverGiftVoucherOrder(
        { ...valid, website },
        {
          store,
          send,
          recipient: 'bestellingen@example.test',
          siteName: 'De Bikefit Studio',
          ipAddress: '203.0.113.7',
        },
      );
      expect(result, `${website.length} characters`).toEqual({
        ok: false,
        code: 'invalid',
        message: GIFT_VOUCHER_MESSAGES.rejected,
        fieldErrors: {},
      });
      expect(send).not.toHaveBeenCalled();
      for (const call of Object.values(store)) expect(call).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['a UUID', valid.requestId, valid.requestId],
    ['malformed', '<x>', null],
    ['too long for its pattern, within the cap', 'a'.repeat(RAW.requestId), null],
    ['over the cap', 'a'.repeat(RAW.requestId + 1), null],
  ])('request id: %s → kept or dropped, never a refusal', (_label, requestId, expected) => {
    expect(validateGiftVoucherOrder({ ...valid, requestId })).toMatchObject({
      ok: true,
      order: { requestId: expected },
    });
  });
});
