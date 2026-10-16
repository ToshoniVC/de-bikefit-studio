import { describe, expect, it } from 'vitest';
import { formatPhoneForInput, isBarePrefix, normalizePhone } from './phone';

describe('normalizePhone — Belgian numbers get exactly one +32', () => {
  it.each([
    ['0470 12 34 56', '+32 470 12 34 56'],
    ['0470123456', '+32 470 12 34 56'],
    ['0470/12.34.56', '+32 470 12 34 56'],
    ['470 12 34 56', '+32 470 12 34 56'],
    ['+32 470 12 34 56', '+32 470 12 34 56'],
    ['+32470123456', '+32 470 12 34 56'],
    ['+32 (0)470 12 34 56', '+32 470 12 34 56'],
    ['+32 0470 12 34 56', '+32 470 12 34 56'],
    ['0032 470 12 34 56', '+32 470 12 34 56'],
    ['32470123456', '+32 470 12 34 56'],
    ['  +32-470-12-34-56  ', '+32 470 12 34 56'],
    // Pasted or typed after the "+32 " the field starts with.
    ['+32 +32 470 12 34 56', '+32 470 12 34 56'],
    ['+32 0032 470 12 34 56', '+32 470 12 34 56'],
    ['+32 32 470 12 34 56', '+32 470 12 34 56'],
    ['+32 0470 12 34 56', '+32 470 12 34 56'],
  ])('mobile %j → %j', (raw, display) => {
    expect(normalizePhone(raw)?.display).toBe(display);
    expect(normalizePhone(raw)?.e164).toBe('+32470123456');
  });

  it.each([
    ['054 12 34 56', '+32 54 12 34 56', '+3254123456'],
    ['+32 54 12 34 56', '+32 54 12 34 56', '+3254123456'],
    ['02 123 45 67', '+32 2 123 45 67', '+3221234567'],
    ['03 212 34 56', '+32 3 212 34 56', '+3232123456'],
    ['32123456', '+32 3 212 34 56', '+3232123456'],
    ['09 123 45 67', '+32 9 123 45 67', '+3291234567'],
  ])('landline %j → %j', (raw, display, e164) => {
    expect(normalizePhone(raw)).toEqual({ display, e164 });
  });

  it('never adds a second prefix, whatever the input already had', () => {
    for (const raw of ['+32 470 12 34 56', '0032470123456', '32 470 12 34 56']) {
      const display = normalizePhone(raw)?.display ?? '';
      expect(display.match(/\+32/g)).toHaveLength(1);
      expect(display).not.toContain('+32 32');
      // Normalizing the normalized value changes nothing.
      expect(normalizePhone(display)?.display).toBe(display);
    }
  });

  it('keeps a foreign number as +<digits>', () => {
    expect(normalizePhone('+31 6 12345678')).toEqual({
      display: '+31612345678',
      e164: '+31612345678',
    });
    expect(normalizePhone('0031 6 12345678')?.e164).toBe('+31612345678');
    // Pasted after the "+32 " the field starts with.
    expect(normalizePhone('+32 +31 6 12345678')?.e164).toBe('+31612345678');
  });

  it('does not take a foreign mobile without country code for a Belgian one', () => {
    // Belgian mobiles are 04xx; a Dutch or French 06 number needs its + prefix.
    for (const raw of ['06 12345678', '0612345678', '06 12 34 56 78', '+32 612 34 56 78']) {
      expect(normalizePhone(raw), raw).toBeNull();
    }
    // An 8-digit Liège landline still starts with 4.
    expect(normalizePhone('04 223 45 67')?.display).toBe('+32 4 223 45 67');
  });

  it.each([
    '',
    '   ',
    '+32',
    '+32 ',
    '0470',
    '12345',
    '0470 12 34 56 78 9',
    '+32 470 12 34 56 7',
    '+32 00 12 34 56',
    'abc',
    '0470-12-34-5x',
    '+',
    '+1234567',
    '+1234567890123456',
    '++32470123456',
    '+32 +32',
    '+32 00 12',
  ])('rejects %j', (raw) => {
    expect(normalizePhone(raw)).toBeNull();
  });
});

describe('formatPhoneForInput / isBarePrefix', () => {
  it('formats what it can, leaves the rest as typed (trimmed)', () => {
    expect(formatPhoneForInput(' 0470123456 ')).toBe('+32 470 12 34 56');
    expect(formatPhoneForInput(' 0470 ')).toBe('0470');
  });

  it('treats a lone prefix as empty', () => {
    for (const raw of ['', ' ', '+', '+3', '+32', '+32 ']) expect(isBarePrefix(raw)).toBe(true);
    for (const raw of ['+324', '0', '+31']) expect(isBarePrefix(raw)).toBe(false);
  });
});
