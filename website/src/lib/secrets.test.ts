import { createCipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEV_SESSION_PEPPER,
  derivedSecret,
  openSecret,
  sealSecret,
  sessionSecret,
} from './secrets';

const SECRET = 'unit-test-session-secret-0123456789';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sessionSecret', () => {
  it('returns CMS_SESSION_SECRET when it is set', () => {
    vi.stubEnv('CMS_SESSION_SECRET', SECRET);
    vi.stubEnv('NODE_ENV', 'production');
    expect(sessionSecret()).toBe(SECRET);
  });

  it('falls back to the dev pepper outside production', () => {
    vi.stubEnv('CMS_SESSION_SECRET', undefined);
    vi.stubEnv('NODE_ENV', 'development');
    expect(sessionSecret()).toBe(DEV_SESSION_PEPPER);
    expect(DEV_SESSION_PEPPER).toBe('bikefit-local-development-session-pepper');
  });

  it('treats an empty CMS_SESSION_SECRET as unset', () => {
    vi.stubEnv('CMS_SESSION_SECRET', '');
    vi.stubEnv('NODE_ENV', 'test');
    expect(sessionSecret()).toBe(DEV_SESSION_PEPPER);
  });

  it('throws in production when CMS_SESSION_SECRET is missing', () => {
    vi.stubEnv('CMS_SESSION_SECRET', undefined);
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => sessionSecret()).toThrow('CMS_SESSION_SECRET must be set in production.');
  });

  it('refuses a secret shorter than 16 characters instead of using it', () => {
    vi.stubEnv('CMS_SESSION_SECRET', 'too-short');
    expect(() => sessionSecret()).toThrow(/CMS_SESSION_SECRET/);
  });
});

describe('derivedSecret', () => {
  it('is HKDF-SHA256(secret, empty salt, info = purpose), 32 bytes — the key google.ts always used', () => {
    vi.stubEnv('CMS_SESSION_SECRET', SECRET);
    const expected = Buffer.from(hkdfSync('sha256', SECRET, Buffer.alloc(0), 'google-token', 32));
    const key = derivedSecret('google-token');
    expect(key.length).toBe(32);
    expect(key.equals(expected)).toBe(true);
  });

  it('separates purposes and follows the secret', () => {
    vi.stubEnv('CMS_SESSION_SECRET', SECRET);
    const a = derivedSecret('google-token');
    expect(a.equals(derivedSecret('something-else'))).toBe(false);
    vi.stubEnv('CMS_SESSION_SECRET', `${SECRET}-rotated`);
    expect(a.equals(derivedSecret('google-token'))).toBe(false);
  });

  it('uses the dev pepper outside production and throws in production without a secret', () => {
    vi.stubEnv('CMS_SESSION_SECRET', undefined);
    vi.stubEnv('NODE_ENV', 'development');
    const expected = Buffer.from(
      hkdfSync('sha256', DEV_SESSION_PEPPER, Buffer.alloc(0), 'google-token', 32),
    );
    expect(derivedSecret('google-token').equals(expected)).toBe(true);
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => derivedSecret('google-token')).toThrow(
      'CMS_SESSION_SECRET must be set in production.',
    );
  });
});

describe('sealSecret / openSecret', () => {
  const key = randomBytes(32);

  it('round-trips and never contains the plain text', () => {
    const sealed = sealSecret('re_unit_test_value_123456', key);
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(sealed).not.toContain('re_unit_test_value_123456');
    expect(openSecret(sealed, key)).toBe('re_unit_test_value_123456');
    // A fresh IV every time.
    expect(sealSecret('same', key)).not.toBe(sealSecret('same', key));
  });

  it('returns null for a wrong key, tampering or junk', () => {
    const sealed = sealSecret('value', key);
    expect(openSecret(sealed, randomBytes(32))).toBeNull();
    const [v, iv, tag, data] = sealed.split('.');
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] ^= 1;
    expect(openSecret([v, iv, tag, flipped.toString('base64url')].join('.'), key)).toBeNull();
    expect(openSecret('v2.a.b.c', key)).toBeNull();
    expect(openSecret('', key)).toBeNull();
    expect(openSecret(null, key)).toBeNull();
  });

  it('reads the envelope google.ts has always written (format unchanged)', () => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update('refresh-token', 'utf8'), cipher.final()]);
    const legacy = ['v1', iv, cipher.getAuthTag(), data]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
    expect(openSecret(legacy, key)).toBe('refresh-token');
  });
});
