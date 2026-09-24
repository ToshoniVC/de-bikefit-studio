import { hkdfSync } from 'node:crypto';
import { env, isProduction } from '@/lib/env';

/**
 * The CMS secret and the keys derived from it — the one implementation behind
 * the session-token pepper (`src/lib/cms/session.ts`), the Google OAuth state
 * cookie (`src/app/api/google/oauth/state.ts`), the booking confirmation ref
 * (`src/components/studio/booking/confirmation-ref.ts`) and the fallback key
 * for Google token encryption (`src/lib/booking/google.ts`). CLAUDE.md §3.
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
