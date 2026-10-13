import { describe, expect, it } from 'vitest';
import { PASSWORD_MAX_LENGTH } from '../password';
import { normalizeRecoveryCode } from '../mfa/recovery-codes';
import { normalizeTotpCode } from '../mfa/totp';
import {
  challengePasswordForm,
  MFA_CODE_MAX_LENGTH,
  mfaCodeForm,
  parseForm,
  reauthForm,
  resetUserMfaForm,
  USER_ID_MAX_LENGTH,
} from './mfa-input';

function formOf(fields: Record<string, string | Blob>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

describe('code fields', () => {
  it('accept every format the verifiers accept, trimmed', () => {
    const typed = [
      '123456',
      '123 456',
      ' 123456 ',
      'ABCD-EFGH-JKMN-PQRS',
      'abcd efgh jkmn pqrs',
      'A B C D - E F G H - J K M N - P Q R S',
      'abcdefghjkmnpqrs',
    ];
    for (const value of typed) {
      const parsed = parseForm(mfaCodeForm, formOf({ code: value }));
      expect(parsed.ok, value).toBe(true);
      if (!parsed.ok) continue;
      expect(parsed.data.code).toBe(value.trim());
      const usable =
        normalizeTotpCode(parsed.data.code) !== null ||
        normalizeRecoveryCode(parsed.data.code) !== null;
      expect(usable, value).toBe(true);
    }
  });

  it('read a missing field as empty (the form then asks for the code)', () => {
    expect(parseForm(mfaCodeForm, new FormData())).toEqual({ ok: true, data: { code: '' } });
  });

  it('refuse an oversized value and anything that is not text', () => {
    const tooLong = '1'.repeat(MFA_CODE_MAX_LENGTH + 1);
    expect(parseForm(mfaCodeForm, formOf({ code: tooLong }))).toEqual({
      ok: false,
      field: 'code',
    });
    expect(parseForm(mfaCodeForm, formOf({ code: new Blob(['123456']) }))).toEqual({
      ok: false,
      field: 'code',
    });
    const padded = `  ${'1'.repeat(MFA_CODE_MAX_LENGTH)}  `;
    expect(parseForm(mfaCodeForm, formOf({ code: padded })).ok).toBe(true);
  });
});

describe('password fields', () => {
  it('are bounded by the longest password anyone can set, and never trimmed', () => {
    const spaced = ' Spatie Wachtwoord 1 ';
    expect(parseForm(reauthForm, formOf({ password: spaced, code: '' }))).toEqual({
      ok: true,
      data: { password: spaced, code: '' },
    });
    const longest = `Aa1${'x'.repeat(PASSWORD_MAX_LENGTH - 3)}`;
    expect(parseForm(reauthForm, formOf({ password: longest, code: '' })).ok).toBe(true);
    expect(parseForm(reauthForm, formOf({ password: `${longest}x`, code: '123456' }))).toEqual({
      ok: false,
      field: 'password',
    });
  });

  it('name the field that does not fit at the challenge password step', () => {
    const tooLong = 'A1a'.repeat(PASSWORD_MAX_LENGTH);
    const ok = { currentPassword: 'Tijdelijk-1', newPassword: 'Nieuw-Wachtwoord-1' };
    expect(
      parseForm(challengePasswordForm, formOf({ ...ok, repeatPassword: ok.newPassword })).ok,
    ).toBe(true);
    expect(
      parseForm(challengePasswordForm, formOf({ ...ok, currentPassword: tooLong })),
    ).toMatchObject({ ok: false, field: 'currentPassword' });
    expect(parseForm(challengePasswordForm, formOf({ ...ok, newPassword: tooLong }))).toMatchObject(
      { ok: false, field: 'newPassword' },
    );
  });
});

describe('the break-glass form', () => {
  it('bounds the target user id as well as the re-authentication', () => {
    const userId = '5b0c1f8e-2d3a-4c6b-9e7f-0a1b2c3d4e5f';
    expect(
      parseForm(resetUserMfaForm, formOf({ userId: ` ${userId} `, password: 'x', code: '1' })),
    ).toEqual({ ok: true, data: { userId, password: 'x', code: '1' } });
    expect(
      parseForm(
        resetUserMfaForm,
        formOf({ userId: 'u'.repeat(USER_ID_MAX_LENGTH + 1), password: 'x', code: '1' }),
      ),
    ).toEqual({ ok: false, field: 'userId' });
  });
});
