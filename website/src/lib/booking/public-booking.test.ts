import { describe, expect, it } from 'vitest';
import { generateCancelToken, hashCancelToken } from './public-booking';

// Only the pure token helpers. Importing the module is safe: `server-only` is
// stubbed in vitest.config.ts and nothing opens a database at import time.

describe('hashCancelToken', () => {
  it('is deterministic', () => {
    const token = generateCancelToken();
    expect(hashCancelToken(token)).toBe(hashCancelToken(token));
  });

  it('is the lowercase hex SHA-256 of the token', () => {
    expect(hashCancelToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashCancelToken(generateCancelToken())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives different tokens different hashes, case-sensitively', () => {
    expect(hashCancelToken('Abc')).not.toBe(hashCancelToken('abc'));
    const token = generateCancelToken();
    expect(hashCancelToken(token)).not.toContain(token);
  });
});

describe('generateCancelToken', () => {
  it('is 32 random bytes as unpadded base64url (43 characters)', () => {
    for (let i = 0; i < 20; i += 1) {
      const token = generateCancelToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    }
  });

  it('does not repeat', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateCancelToken()));
    expect(tokens.size).toBe(200);
  });
});
