import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MfaConfigError,
  mfaConfigured,
  mfaEncryptionKey,
  openTotpSecret,
  sealTotpSecret,
} from './crypto';
import { generateTotpSecret } from './totp';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('TOTP secret encryption', () => {
  it('round-trips with the dedicated key and binds the ciphertext to its user', () => {
    vi.stubEnv('CMS_MFA_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
    const secret = generateTotpSecret();
    const sealed = sealTotpSecret('user-1', secret);
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain(secret.toString('hex'));
    expect(openTotpSecret('user-1', sealed)?.equals(secret)).toBe(true);
    expect(openTotpSecret('user-2', sealed)).toBeNull();
  });

  it('cannot open a secret after the key changed', () => {
    vi.stubEnv('CMS_MFA_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
    const sealed = sealTotpSecret('user-1', generateTotpSecret());
    vi.stubEnv('CMS_MFA_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
    expect(openTotpSecret('user-1', sealed)).toBeNull();
  });

  it('is independent of CMS_SESSION_SECRET when the dedicated key is set', () => {
    vi.stubEnv('CMS_MFA_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
    vi.stubEnv('CMS_SESSION_SECRET', 'first-session-secret-value-123456');
    const sealed = sealTotpSecret('user-1', generateTotpSecret());
    vi.stubEnv('CMS_SESSION_SECRET', 'second-session-secret-value-12345');
    expect(openTotpSecret('user-1', sealed)).not.toBeNull();
  });

  it('fails closed on a deployment without the key, and on a malformed key', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CMS_MFA_ENCRYPTION_KEY', '');
    vi.stubEnv('CMS_SESSION_SECRET', 'a-production-session-secret-1234567');
    expect(() => mfaEncryptionKey()).toThrow(MfaConfigError);
    expect(mfaConfigured()).toBe(false);
    expect(() => sealTotpSecret('user-1', generateTotpSecret())).toThrow(MfaConfigError);

    vi.stubEnv('CMS_MFA_ENCRYPTION_KEY', Buffer.alloc(16).toString('base64'));
    expect(() => mfaEncryptionKey()).toThrow(MfaConfigError);
    expect(mfaConfigured()).toBe(false);
  });

  it('falls back to a derived development key outside production only', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CMS_MFA_ENCRYPTION_KEY', '');
    expect(mfaConfigured()).toBe(true);
    expect(mfaEncryptionKey()).toHaveLength(32);
  });
});
