import { describe, expect, it } from 'vitest';
import {
  TOTP_PERIOD_SECONDS,
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  formatSecretForDisplay,
  generateTotpSecret,
  hotp,
  normalizeTotpCode,
  totpAt,
  totpStep,
  verifyTotp,
} from './totp';

const RFC_SECRET_SHA1 = Buffer.from('12345678901234567890');
const RFC_SECRET_SHA256 = Buffer.from('12345678901234567890123456789012');
const RFC_SECRET_SHA512 = Buffer.from(
  '1234567890123456789012345678901234567890123456789012345678901234',
);

describe('base32 (RFC 4648 §10 test vectors, no padding)', () => {
  const vectors: Array<[string, string]> = [
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ];
  it('encodes and decodes the RFC vectors', () => {
    for (const [plain, encoded] of vectors) {
      expect(base32Encode(Buffer.from(plain)), plain).toBe(encoded);
      expect(base32Decode(encoded)?.toString(), encoded).toBe(plain);
    }
  });
  it('ignores case, spaces and padding; rejects other characters', () => {
    expect(base32Decode('mzxw 6ytb oi======')?.toString()).toBe('foobar');
    expect(base32Decode('MZXW1')).toBeNull();
    expect(base32Decode('MZXW8')).toBeNull();
  });
  it('round-trips random secrets', () => {
    for (let i = 0; i < 20; i += 1) {
      const secret = generateTotpSecret();
      expect(secret).toHaveLength(20);
      expect(base32Decode(base32Encode(secret))?.equals(secret)).toBe(true);
    }
  });
});

describe('hotp (RFC 4226 appendix D)', () => {
  it('matches the ten reference values', () => {
    const expected = [
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489',
    ];
    expected.forEach((code, counter) => {
      expect(hotp(RFC_SECRET_SHA1, counter), `counter ${counter}`).toBe(code);
    });
  });
  it('refuses a negative or fractional counter', () => {
    expect(() => hotp(RFC_SECRET_SHA1, -1)).toThrow();
    expect(() => hotp(RFC_SECRET_SHA1, 1.5)).toThrow();
  });
});

describe('totp (RFC 6238 appendix B, 8 digits)', () => {
  const vectors: Array<[number, string, string, string]> = [
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901'],
    [20000000000, '65353130', '77737706', '47863826'],
  ];
  it('matches SHA-1, SHA-256 and SHA-512 reference values', () => {
    for (const [seconds, sha1, sha256, sha512] of vectors) {
      const step = totpStep(seconds * 1000);
      expect(hotp(RFC_SECRET_SHA1, step, 8, 'sha1'), `sha1 ${seconds}`).toBe(sha1);
      expect(hotp(RFC_SECRET_SHA256, step, 8, 'sha256'), `sha256 ${seconds}`).toBe(sha256);
      expect(hotp(RFC_SECRET_SHA512, step, 8, 'sha512'), `sha512 ${seconds}`).toBe(sha512);
    }
  });
  it('uses 30-second steps and six digits by default', () => {
    expect(TOTP_PERIOD_SECONDS).toBe(30);
    expect(totpStep(59_000)).toBe(1);
    expect(totpStep(60_000)).toBe(2);
    expect(totpAt(RFC_SECRET_SHA1, 59_000)).toBe('287082');
  });
});

describe('verifyTotp', () => {
  const secret = RFC_SECRET_SHA1;
  const now = 1_790_000_000_000;
  const step = totpStep(now);
  const codeFor = (offset: number) => hotp(secret, step + offset);

  it('accepts the current step and one step either side, nothing wider', () => {
    for (const offset of [-1, 0, 1]) {
      expect(verifyTotp({ secret, code: codeFor(offset), nowMs: now, lastUsedStep: null })).toEqual(
        { ok: true, step: step + offset },
      );
    }
    for (const offset of [-3, -2, 2, 3]) {
      const result = verifyTotp({ secret, code: codeFor(offset), nowMs: now, lastUsedStep: null });
      expect(result, String(offset)).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it('rejects a replayed code and any code for an earlier step', () => {
    expect(verifyTotp({ secret, code: codeFor(0), nowMs: now, lastUsedStep: step })).toEqual({
      ok: false,
      reason: 'replayed',
    });
    expect(verifyTotp({ secret, code: codeFor(-1), nowMs: now, lastUsedStep: step })).toEqual({
      ok: false,
      reason: 'replayed',
    });
    expect(verifyTotp({ secret, code: codeFor(1), nowMs: now, lastUsedStep: step })).toEqual({
      ok: true,
      step: step + 1,
    });
  });

  it('rejects malformed input before any comparison', () => {
    for (const code of ['', '12345', '1234567', 'abcdef', '12 34 5x']) {
      expect(verifyTotp({ secret, code, nowMs: now, lastUsedStep: null }), code).toEqual({
        ok: false,
        reason: 'malformed',
      });
    }
  });

  it('accepts the code with the spaces authenticators display', () => {
    const code = codeFor(0);
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(normalizeTotpCode(spaced)).toBe(code);
    expect(verifyTotp({ secret, code: spaced, nowMs: now, lastUsedStep: null }).ok).toBe(true);
  });

  it('rejects a code for another secret', () => {
    const other = Buffer.from('abcdefghijabcdefghij');
    expect(verifyTotp({ secret: other, code: codeFor(0), nowMs: now, lastUsedStep: null }).ok).toBe(
      false,
    );
  });
});

describe('buildOtpauthUri', () => {
  it('produces a Key Uri Format link authenticators accept', () => {
    const secret = Buffer.from('12345678901234567890');
    const uri = buildOtpauthUri({
      secret,
      issuer: 'De Bikefit Studio',
      accountName: 'contact@toshoni.be',
    });
    const url = new URL(uri);
    expect(url.protocol).toBe('otpauth:');
    expect(url.host).toBe('totp');
    expect(decodeURIComponent(url.pathname)).toBe('/De Bikefit Studio:contact@toshoni.be');
    expect(url.searchParams.get('secret')).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(url.searchParams.get('issuer')).toBe('De Bikefit Studio');
    expect(url.searchParams.get('algorithm')).toBe('SHA1');
    expect(url.searchParams.get('digits')).toBe('6');
    expect(url.searchParams.get('period')).toBe('30');
    expect(uri).toContain('issuer=De%20Bikefit%20Studio');
    expect(uri).not.toContain('+');
  });

  it('formats the manual key in groups of four', () => {
    expect(formatSecretForDisplay(Buffer.from('12345678901234567890'))).toBe(
      'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ',
    );
  });
});
