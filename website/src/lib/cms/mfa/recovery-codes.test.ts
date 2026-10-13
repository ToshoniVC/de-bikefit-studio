import { describe, expect, it } from 'vitest';
import {
  RECOVERY_CODE_COUNT,
  formatRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from './recovery-codes';

const FORMAT = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/;

describe('recovery codes', () => {
  it('generates ten distinct, well-formed codes of 80 bits each', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of codes) {
      expect(code).toMatch(FORMAT);
      expect(normalizeRecoveryCode(code)).toHaveLength(16); // 16 × 5 bits
    }
  });

  it('does not repeat across many batches', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) for (const code of generateRecoveryCodes()) seen.add(code);
    expect(seen.size).toBe(200 * RECOVERY_CODE_COUNT);
  });

  it('normalises case, spaces, dashes and look-alike letters', () => {
    expect(normalizeRecoveryCode('abcd-efgh-jkmn-pqrs')).toBe('ABCDEFGHJKMNPQRS');
    expect(normalizeRecoveryCode(' ABCD EFGH JKMN PQRS ')).toBe('ABCDEFGHJKMNPQRS');
    expect(normalizeRecoveryCode('OOOO-IIII-LLLL-0000')).toBe('0000111111110000');
    expect(formatRecoveryCode('ABCDEFGHJKMNPQRS')).toBe('ABCD-EFGH-JKMN-PQRS');
  });

  it('rejects what cannot be a code', () => {
    for (const input of [
      '',
      '123456',
      'ABCD-EFGH-JKMN',
      'ABCD-EFGH-JKMN-PQRSX',
      'UUUU-EFGH-JKMN-PQRS',
    ]) {
      expect(normalizeRecoveryCode(input), input).toBeNull();
    }
  });

  it('hashes deterministically per user and differently across users', () => {
    const code = 'ABCDEFGHJKMNPQRS';
    expect(hashRecoveryCode('user-1', code)).toBe(hashRecoveryCode('user-1', code));
    expect(hashRecoveryCode('user-1', code)).not.toBe(hashRecoveryCode('user-2', code));
    expect(hashRecoveryCode('user-1', code)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRecoveryCode('user-1', code)).not.toContain(code);
  });
});
