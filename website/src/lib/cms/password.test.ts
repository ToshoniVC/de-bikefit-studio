import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  generateTemporaryPassword,
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
} from './password';

// scrypt with N = 2^15 costs ~64 MB and a noticeable fraction of a second per
// call, so this file keeps the number of real hashes small.
const SLOW = 30_000;

describe('hashPassword / verifyPassword', () => {
  it(
    'stores a self-describing, salted scrypt hash that verifies only the right password',
    async () => {
      const password = 'Correct-Horse-9-Battery';
      const [first, second] = await Promise.all([hashPassword(password), hashPassword(password)]);
      expect(first).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*$/);
      expect(first).not.toBe(second);
      expect(await verifyPassword(password, first)).toBe(true);
      expect(await verifyPassword(password, second)).toBe(true);
      expect(await verifyPassword('correct-horse-9-battery', first)).toBe(false);
    },
    SLOW,
  );

  it(
    'returns false instead of throwing for malformed or unknown hash formats',
    async () => {
      const broken = [
        '',
        'plain-text',
        '$2b$12$abcdefghijklmnopqrstuv',
        'scrypt$x$8$1$c2FsdA==$aGFzaA==',
        'scrypt$32768$8$1$$aGFzaA==',
        'scrypt$3$8$1$c2FsdA==$aGFzaA==', // N not a power of two → scrypt throws
      ];
      for (const stored of broken) {
        await expect(verifyPassword('whatever', stored), stored).resolves.toBe(false);
      }
    },
    SLOW,
  );
});

describe('generateTemporaryPassword', () => {
  it('always meets the password policy and avoids ambiguous characters', () => {
    const samples = Array.from({ length: 50 }, () => generateTemporaryPassword());
    for (const password of samples) {
      expect(validatePasswordStrength(password), password).toBeNull();
      expect(password).toMatch(/^Bf[A-HJ-NP-Za-km-np-z2-9]{20}7$/);
    }
    expect(new Set(samples).size).toBe(samples.length);
  });
});

describe('validatePasswordStrength', () => {
  it('enforces the length limits', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(validatePasswordStrength('Kort1')).toContain(`${PASSWORD_MIN_LENGTH}`);
    expect(validatePasswordStrength(`Aa1${'x'.repeat(PASSWORD_MAX_LENGTH)}`)).toContain(
      `${PASSWORD_MAX_LENGTH}`,
    );
  });

  it('requires a lowercase letter, an uppercase letter and a digit', () => {
    expect(validatePasswordStrength('alleenkleineletters1')).toMatch(/hoofdletter/);
    expect(validatePasswordStrength('ALLEENHOOFDLETTERS1')).toMatch(/kleine letter/);
    expect(validatePasswordStrength('GeenCijfersHierIn')).toMatch(/cijfer/);
    expect(validatePasswordStrength('GoedWachtwoord12')).toBeNull();
  });
});
