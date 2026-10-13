import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM "sealed box" for secrets stored in the database: the Google
 * tokens (`src/lib/booking/google.ts`), the e-mail service API key
 * (`src/lib/email/settings.ts`) and the CMS TOTP secrets
 * (`src/lib/cms/mfa/crypto.ts`). The caller owns the 32-byte key.
 *
 * Format: `v1.<iv>.<tag>.<ciphertext>`, base64url parts, 96-bit random IV.
 * `aad` (additional authenticated data) binds the ciphertext to its context,
 * e.g. the owning user id, so a sealed value copied into another row no longer
 * opens. Without `aad` the output is byte-compatible with the format the Google
 * tokens have always used.
 *
 * Deliberately not `server-only` so the self-test can load it; it holds no key.
 */

const VERSION = 'v1';
const KEY_BYTES = 32;
const IV_BYTES = 12;

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) throw new Error('sealed-box: key must be 32 bytes.');
}

export function seal(plain: string, key: Buffer, aad?: string): string {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (aad !== undefined) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

/** Inverse of {@link seal}; `null` when the value is malformed, tampered with, or the key or `aad` differ. */
export function unseal(
  sealed: string | null | undefined,
  key: Buffer,
  aad?: string,
): string | null {
  if (!sealed) return null;
  const [version, iv, tag, ciphertext, extra] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || ciphertext === undefined || extra !== undefined) {
    return null;
  }
  try {
    assertKey(key);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    if (aad !== undefined) decipher.setAAD(Buffer.from(aad, 'utf8'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
