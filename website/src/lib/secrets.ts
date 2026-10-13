import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { env, isProduction } from '@/lib/env';

/**
 * The CMS secret and the keys derived from it — the one implementation behind
 * the session-token pepper (`src/lib/cms/session.ts`), the Google OAuth state
 * cookie (`src/app/api/google/oauth/state.ts`), the booking confirmation ref
 * (`src/components/studio/booking/confirmation-ref.ts`), the fallback key
 * for Google token encryption (`src/lib/booking/google.ts`) and the key for
 * the e-mail service credential (`src/lib/email/settings.ts`). CLAUDE.md §3.
 *
 * Also the one AES-256-GCM envelope ({@link sealSecret} / {@link openSecret})
 * for credentials stored in the database.
 *
 * Deliberately NOT `server-only`: `session.ts` is also loaded by the plain Node
 * scripts (`cms:seed`, `cms:selftest`). Never import it into a client
 * component — it reads the secret.
 *
 * Changing anything here changes stored hashes and signatures: rotating
 * `CMS_SESSION_SECRET` signs every CMS user out and, without
 * `GOOGLE_TOKEN_ENCRYPTION_KEY`, makes stored Google tokens unreadable.
 */

/**
 * Local development only: keeps PGlite sessions stable across restarts when
 * `CMS_SESSION_SECRET` is unset. Never accepted in production.
 */
export const DEV_SESSION_PEPPER = 'bikefit-local-development-session-pepper';

/** `CMS_SESSION_SECRET`; outside production the dev pepper when it is unset. Throws in production when unset. */
export function sessionSecret(): string {
  const secret = env.CMS_SESSION_SECRET;
  if (secret) return secret;
  if (isProduction()) {
    throw new Error('CMS_SESSION_SECRET must be set in production.');
  }
  return DEV_SESSION_PEPPER;
}

/**
 * A key for one purpose: HKDF-SHA256 over {@link sessionSecret}, empty salt,
 * `info = purpose`. `derivedSecret('google-token')` is byte-for-byte the key
 * `google.ts` has always derived, so existing encrypted tokens stay readable.
 */
export function derivedSecret(purpose: string, bytes = 32): Buffer {
  return Buffer.from(hkdfSync('sha256', sessionSecret(), Buffer.alloc(0), purpose, bytes));
}

const SEAL_VERSION = 'v1';

/**
 * AES-256-GCM → `v1.<iv>.<tag>.<ciphertext>` (base64url parts). The format of
 * the Google tokens already stored, so it must not change.
 */
export function sealSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [SEAL_VERSION, iv, tag, ciphertext]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

/** Inverse of {@link sealSecret}; `null` when the value is malformed, tampered with or the key changed. */
export function openSecret(sealed: string | null | undefined, key: Buffer): string | null {
  if (!sealed) return null;
  const [version, iv, tag, ciphertext] = sealed.split('.');
  if (version !== SEAL_VERSION || !iv || !tag || ciphertext === undefined) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
