import { createCipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { seal, unseal } from './sealed-box';

const key = randomBytes(32);

/** The Google-token encryption exactly as `google.ts` wrote it before it used this module. */
function legacyEncrypt(plain: string, legacyKey: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', legacyKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv, tag, ciphertext]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

describe('sealed box (AES-256-GCM)', () => {
  it('round-trips, with and without AAD', () => {
    expect(unseal(seal('geheim', key), key)).toBe('geheim');
    expect(unseal(seal('geheim', key, 'user-1'), key, 'user-1')).toBe('geheim');
    expect(unseal(seal('', key), key)).toBe('');
  });

  it('uses a fresh IV every time', () => {
    expect(seal('geheim', key)).not.toBe(seal('geheim', key));
  });

  it('refuses another AAD, a missing AAD, another key, tampering and junk', () => {
    const sealed = seal('geheim', key, 'user-1');
    expect(unseal(sealed, key, 'user-2')).toBeNull();
    expect(unseal(sealed, key)).toBeNull();
    expect(unseal(sealed, randomBytes(32), 'user-1')).toBeNull();
    const parts = sealed.split('.');
    const flipped = Buffer.from(parts[3], 'base64url');
    flipped[0] ^= 1;
    expect(
      unseal([...parts.slice(0, 3), flipped.toString('base64url')].join('.'), key, 'user-1'),
    ).toBeNull();
    for (const junk of [null, undefined, '', 'v1', 'v2.a.b.c', `${sealed}.extra`]) {
      expect(unseal(junk, key, 'user-1'), String(junk)).toBeNull();
    }
  });

  it('opens values written by the previous Google token code (format unchanged)', () => {
    expect(unseal(legacyEncrypt('1//refresh-token', key), key)).toBe('1//refresh-token');
  });

  it('insists on a 32-byte key', () => {
    expect(() => seal('x', randomBytes(16))).toThrow();
    expect(unseal(seal('x', key), randomBytes(16))).toBeNull();
  });
});
