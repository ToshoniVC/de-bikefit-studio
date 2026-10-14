import 'server-only';
import { eq } from 'drizzle-orm';
import { getCmsDb, type CmsDatabase } from '@/db/cms';
import { cmsIntegrationSettings, DEFAULT_LOCALE } from '@/db/cms-schema';
import { recordAudit, requirePermission } from '@/lib/cms/auth';
import { getSiteSettings } from '@/lib/cms/content';
import type { RepoResult } from '@/lib/cms/repo';
import { giftVoucherRecipientProblem } from '@/lib/gift-voucher/recipient';
import {
  apiKeyHint,
  apiKeyProblem,
  describeSendFailure,
  EMAIL_SETTINGS_KEY,
  emailServiceStatus,
  replyToProblem,
  resolveEmailSettings,
  senderProblem,
  sendFailureCode,
  testRecipientProblem,
  type EmailServiceConfig,
  type EmailServiceStatus,
} from './config';
import { maskEmail, sendEmail } from './send';
import { emailEnv, readStoredEmailSettings, sealEmailApiKey } from './settings';
import { layout, paragraph } from './templates';

/**
 * Admin API for `/admin/email` (permission `email.manage`, admins only). Every
 * function checks the permission itself; the page and the actions only hide UI.
 *
 * Changing the key, the sender, the reply-to or the gift voucher order inbox is
 * a sensitive change: it can swap the sending account or send visitors' orders
 * (names, e-mail addresses, messages) to another mailbox. Those writes also
 * need a full authentication on this session within the last 5 minutes
 * (sign-in or "Bevestig je identiteit"; `recentReauthentication` in
 * `src/lib/cms/guard.ts`). Reading the status and sending the test message do
 * not: they change nothing and reveal no secret.
 *
 * Write-only key: `setEmailApiKey()` seals it and stores the last four
 * characters as a hint; nothing here ever returns it. Audit entries name what
 * changed, never a value: no key, no ciphertext, no hint.
 */

const ENTITY = { entityType: 'cms_integration_setting', entityId: EMAIL_SETTINGS_KEY } as const;

/** The guard requirement of every change on this page (see above). */
const SENSITIVE_CHANGE = { recentReauthentication: true } as const;

const STORE_MISSING =
  'De tabel voor deze instellingen bestaat nog niet (databasemigratie 0004 niet toegepast). Vraag de beheerder van de server om `npm run db:migrate`.';

const ok = <T>(data: T) => ({ ok: true as const, data });
const err = (message: string) => ({ ok: false as const, message });

export async function getEmailServiceStatus(): Promise<EmailServiceStatus> {
  await requirePermission('email.manage');
  const stored = await readStoredEmailSettings();
  return emailServiceStatus(resolveEmailSettings(emailEnv(), stored), stored);
}

async function storeAvailable(db: CmsDatabase): Promise<boolean> {
  return (await readStoredEmailSettings(db)).available;
}

export async function saveEmailServiceConfig(
  input: EmailServiceConfig,
): Promise<RepoResult<EmailServiceConfig>> {
  const actor = await requirePermission('email.manage', SENSITIVE_CHANGE);
  const next: EmailServiceConfig = {
    from: input.from.trim(),
    replyTo: input.replyTo.trim(),
    giftVoucherRecipient: input.giftVoucherRecipient.trim(),
  };
  const problem =
    senderProblem(next.from) ??
    replyToProblem(next.replyTo) ??
    giftVoucherRecipientProblem(next.giftVoucherRecipient);
  if (problem) return err(problem);

  const db = await getCmsDb();
  const before = await readStoredEmailSettings(db);
  if (!before.available) return err(STORE_MISSING);

  await db
    .insert(cmsIntegrationSettings)
    .values({ key: EMAIL_SETTINGS_KEY, config: next, updatedBy: actor.id })
    .onConflictDoUpdate({
      target: cmsIntegrationSettings.key,
      set: { config: next, updatedBy: actor.id, updatedAt: new Date() },
    });

  const changed = (Object.keys(next) as (keyof EmailServiceConfig)[]).filter(
    (field) => next[field] !== before.config[field],
  );
  await recordAudit(db, actor, {
    action: 'email.settings.update',
    ...ENTITY,
    summary: 'E-mailinstellingen bijgewerkt',
    metadata: { changed },
  });
  return ok(next);
}

export async function setEmailApiKey(value: string): Promise<RepoResult<true>> {
  const actor = await requirePermission('email.manage', SENSITIVE_CHANGE);
  const problem = apiKeyProblem(value);
  if (problem) return err(problem);
  const key = value.trim();

  let sealed: string;
  try {
    sealed = sealEmailApiKey(key);
  } catch {
    return err(
      'De sleutel kan op deze server niet veilig bewaard worden: CMS_SESSION_SECRET ontbreekt.',
    );
  }

  const db = await getCmsDb();
  if (!(await storeAvailable(db))) return err(STORE_MISSING);
  const now = new Date();
  const secret = {
    secretCiphertext: sealed,
    secretHint: apiKeyHint(key),
    secretUpdatedAt: now,
    updatedBy: actor.id,
  };
  try {
    await db
      .insert(cmsIntegrationSettings)
      .values({ key: EMAIL_SETTINGS_KEY, ...secret })
      .onConflictDoUpdate({
        target: cmsIntegrationSettings.key,
        set: { ...secret, updatedAt: now },
      });
  } catch {
    // A fixed code, never the error: a driver error carries the SQL and the
    // bound values (ciphertext and hint).
    console.error('[email] api_key_store_failed');
    return err('De sleutel kon niet opgeslagen worden. Probeer het opnieuw.');
  }
  await recordAudit(db, actor, {
    action: 'email.key.set',
    ...ENTITY,
    summary: 'API-sleutel van de e-maildienst ingesteld',
  });
  return ok(true);
}

export async function clearEmailApiKey(): Promise<RepoResult<true>> {
  const actor = await requirePermission('email.manage', SENSITIVE_CHANGE);
  const db = await getCmsDb();
  const before = await readStoredEmailSettings(db);
  if (!before.available) return err(STORE_MISSING);
  if (!before.apiKeyStored) return ok(true);
  await db
    .update(cmsIntegrationSettings)
    .set({
      secretCiphertext: null,
      secretHint: null,
      secretUpdatedAt: new Date(),
      updatedBy: actor.id,
      updatedAt: new Date(),
    })
    .where(eq(cmsIntegrationSettings.key, EMAIL_SETTINGS_KEY));
  await recordAudit(db, actor, {
    action: 'email.key.clear',
    ...ENTITY,
    summary: 'API-sleutel van de e-maildienst verwijderd',
  });
  return ok(true);
}

/**
 * Sends one real test message through the configured service, on an explicit
 * admin click only. `sent` means the provider accepted it. No step-up: the
 * text is fixed, nothing is stored and the key never leaves the server.
 */
export async function sendEmailServiceTest(
  to: string,
): Promise<RepoResult<{ sent: boolean; message: string }>> {
  const actor = await requirePermission('email.manage');
  const problem = testRecipientProblem(to);
  if (problem) return err(problem);
  const address = to.trim();

  const settings = await getSiteSettings(DEFAULT_LOCALE);
  const siteName = settings.site.name || 'De Bikefit Studio';
  const subject = `Testbericht van ${siteName}`;
  const lines = [
    'Dit is een testbericht vanuit Beheer → E-mail.',
    'Komt het aan, dan werken de API-sleutel en de afzender. Antwoorden gaan naar het ingestelde antwoordadres, als dat er is.',
  ];
  const result = await sendEmail({
    to: address,
    subject,
    text: lines.join('\n\n'),
    html: layout(siteName, subject, lines.map(paragraph).join('')),
  });

  await recordAudit(await getCmsDb(), actor, {
    action: 'email.test',
    ...ENTITY,
    summary: result.sent
      ? 'Testbericht aanvaard door de e-maildienst'
      : 'Testbericht niet verstuurd',
    metadata: {
      to: maskEmail(address),
      sent: result.sent,
      reason: result.sent ? null : sendFailureCode(result.reason),
    },
  });

  return ok(
    result.sent
      ? {
          sent: true,
          message: `De e-maildienst heeft het testbericht naar ${address} aanvaard. Kijk of het aankomt (ook in de spammap); “aanvaard” is nog niet “afgeleverd”.`,
        }
      : { sent: false, message: describeSendFailure(result.reason) },
  );
}
