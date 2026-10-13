import { describe, expect, it } from 'vitest';
import {
  GIFT_VOUCHER_LIMITS,
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
});
