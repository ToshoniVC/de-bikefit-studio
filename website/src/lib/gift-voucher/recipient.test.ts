import { describe, expect, it } from 'vitest';
import {
  giftVoucherRecipientProblem,
  isValidRecipientAddress,
  resolveGiftVoucherRecipient,
} from './recipient';

describe('resolveGiftVoucherRecipient', () => {
  it('uses the env value first, then the admin setting', () => {
    expect(
      resolveGiftVoucherRecipient({ env: 'ops@studio.test', setting: 'shop@studio.test' }),
    ).toEqual({ address: 'ops@studio.test', source: 'env', invalid: false });
    expect(resolveGiftVoucherRecipient({ env: '', setting: ' shop@studio.test ' })).toEqual({
      address: 'shop@studio.test',
      source: 'setting',
      invalid: false,
    });
    expect(resolveGiftVoucherRecipient({ env: undefined, setting: null })).toEqual({
      address: '',
      source: 'none',
      invalid: false,
    });
  });

  it('never falls back to anything else: no value means nobody (not the public contact address)', () => {
    // The resolver has no contact input at all; this documents the contract.
    expect(resolveGiftVoucherRecipient({ env: '  ', setting: '' }).address).toBe('');
  });

  it('an invalid value means "do not send", and a bad env value does not fall through', () => {
    expect(
      resolveGiftVoucherRecipient({ env: 'not-an-address', setting: 'shop@studio.test' }),
    ).toEqual({ address: '', source: 'env', invalid: true });
    expect(resolveGiftVoucherRecipient({ env: '', setting: 'Studio <shop@studio.test>' })).toEqual({
      address: '',
      source: 'setting',
      invalid: true,
    });
  });
});

describe('recipient validation', () => {
  it('accepts one plain address and refuses lists, display names and junk', () => {
    expect(isValidRecipientAddress('info@debikefitstudio.be')).toBe(true);
    expect(isValidRecipientAddress('a@b.be, c@d.be')).toBe(false);
    expect(isValidRecipientAddress('Studio <a@b.be>')).toBe(false);
    expect(isValidRecipientAddress('a@b')).toBe(false);
    expect(isValidRecipientAddress(`${'x'.repeat(200)}@b.be`)).toBe(false);
  });

  it('the admin form allows empty (orders off) and explains a bad value in Dutch', () => {
    expect(giftVoucherRecipientProblem('')).toBeNull();
    expect(giftVoucherRecipientProblem(' shop@studio.test ')).toBeNull();
    expect(giftVoucherRecipientProblem('shop@')).toMatch(/geldig e-mailadres/);
  });
});
