import { env, isProduction } from '@/lib/env';
import { seal, unseal } from '@/lib/sealed-box';
import { derivedSecret } from '@/lib/secrets';
import { base32Decode, base32Encode } from './totp';

/**
 * Encryption at rest for TOTP secrets (`cms_mfa_factors.secret_enc`).
 *
 * The key is `CMS_MFA_ENCRYPTION_KEY`, base64 of 32 random bytes, dedicated to
 * this one purpose: a leak of `CMS_SESSION_SECRET` or of the Google token key
 * does not expose the factors, and either can rotate without touching them.
 * **Required on every deployment** (`NODE_ENV=production`, Vercel previews
 * included). When it is missing there, enrolment and verification fail closed
 * with {@link MfaConfigError} and admins cannot finish signing in; nothing
 * else on the site is affected. Only local development and the self-test fall
 * back to a key derived from the dev pepper (`derivedSecret('cms-mfa-totp')`).
 *
 * AES-256-GCM via `src/lib/sealed-box.ts`, with the owning user id as
 * additional authenticated data: a ciphertext moved to another user's row does
 * not decrypt. Rotating the key makes every stored factor unreadable; affected
 * admins sign in with a recovery code (those do not depend on this key) and
 * replace their authenticator (docs/cms-architecture.md §4, MFA).
 */

export class MfaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MfaConfigError';
  }
}

export function mfaEncryptionKey(): Buffer {
  const explicit = env.CMS_MFA_ENCRYPTION_KEY;
  if (explicit) {
    const key = Buffer.from(explicit, 'base64');
    if (key.length !== 32) {
      throw new MfaConfigError('CMS_MFA_ENCRYPTION_KEY must be base64 of exactly 32 bytes.');
    }
    return key;
  }
  if (isProduction()) {
    throw new MfaConfigError('CMS_MFA_ENCRYPTION_KEY must be set on every deployment.');
  }
  return derivedSecret('cms-mfa-totp');
}

/** Whether TOTP secrets can be sealed and opened in this environment. Never throws. */
export function mfaConfigured(): boolean {
  try {
    mfaEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

function aadFor(userId: string): string {
  return `cms-mfa-totp:v1:${userId}`;
}

export function sealTotpSecret(userId: string, secret: Uint8Array): string {
  return seal(base32Encode(secret), mfaEncryptionKey(), aadFor(userId));
}

/** `null` when the value was tampered with, belongs to another user, or the key changed. */
export function openTotpSecret(userId: string, sealed: string): Buffer | null {
  const base32 = unseal(sealed, mfaEncryptionKey(), aadFor(userId));
  return base32 === null ? null : base32Decode(base32);
}
