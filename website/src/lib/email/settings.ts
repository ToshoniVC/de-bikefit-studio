import 'server-only';
import { eq } from 'drizzle-orm';
import { getCmsDb, type CmsDatabase } from '@/db/cms';
import { cmsIntegrationSettings } from '@/db/cms-schema';
import { env } from '@/lib/env';
import { seal, unseal } from '@/lib/sealed-box';
import { derivedSecret } from '@/lib/secrets';
import {
  EMAIL_SETTINGS_KEY,
  NO_STORED_EMAIL_SETTINGS,
  parseEmailServiceConfig,
  resolveEmailSettings,
  type EmailEnv,
  type ResolvedEmailSettings,
  type StoredEmailSettings,
} from './config';

/**
 * Reads the e-mail service settings for sending (no permission check: used by
 * `sendEmail()` on behalf of visitors). Admin reads and writes go through
 * `./repo.ts`, which checks `email.manage`.
 *
 * The API key stored in the admin is sealed with AES-256-GCM (`seal()` in
 * `src/lib/sealed-box.ts`) under HKDF-SHA256(`CMS_SESSION_SECRET`, info
 * `email-service-credential`) (`derivedSecret()` in `src/lib/secrets.ts`).
 * Rotating `CMS_SESSION_SECRET` makes it unreadable: the admin then says the
 * stored key "kan niet meer ontsleuteld worden" and nothing is sent until an
 * admin enters the key again.
 *
 * Never throws: a missing table (before migration 0004) or a database error
 * means "nothing stored", so the environment variables alone still work.
 */

const CREDENTIAL_PURPOSE = 'email-service-credential';

/** Throws when no key can be derived (production without `CMS_SESSION_SECRET`). */
export function sealEmailApiKey(plain: string): string {
  return seal(plain, derivedSecret(CREDENTIAL_PURPOSE));
}

function openEmailApiKey(sealed: string): string | null {
  try {
    return unseal(sealed, derivedSecret(CREDENTIAL_PURPOSE));
  } catch {
    return null;
  }
}

export async function readStoredEmailSettings(db?: CmsDatabase): Promise<StoredEmailSettings> {
  try {
    const database = db ?? (await getCmsDb());
    const [row] = await database
      .select()
      .from(cmsIntegrationSettings)
      .where(eq(cmsIntegrationSettings.key, EMAIL_SETTINGS_KEY))
      .limit(1);
    if (!row) return { ...NO_STORED_EMAIL_SETTINGS, available: true };
    return {
      available: true,
      config: parseEmailServiceConfig(row.config),
      apiKey: row.secretCiphertext ? openEmailApiKey(row.secretCiphertext) : null,
      apiKeyStored: Boolean(row.secretCiphertext),
      apiKeyHint: row.secretHint,
      apiKeyUpdatedAt: row.secretUpdatedAt,
    };
  } catch {
    // Usually migration 0004 not applied: only the environment variables count.
    // A fixed code, never the error: a driver error carries the SQL and params.
    console.error('[email] stored_settings_unreadable');
    return NO_STORED_EMAIL_SETTINGS;
  }
}

export function emailEnv(): EmailEnv {
  return {
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    replyTo: env.EMAIL_REPLY_TO,
    giftVoucherRecipient: env.GIFT_VOUCHER_RECIPIENT,
  };
}

/** Env over admin, per field. Holds the key: server only, never pass it to a client component. */
export async function loadEmailSettings(db?: CmsDatabase): Promise<ResolvedEmailSettings> {
  return resolveEmailSettings(emailEnv(), await readStoredEmailSettings(db));
}
