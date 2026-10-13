import 'server-only';

import { redactSecrets, type ResolvedEmailSettings } from './config';
import { loadEmailSettings } from './settings';

/**
 * Transactional e-mail through Resend's REST API (`fetch`, no SDK).
 *
 * Configuration comes from `loadEmailSettings()` (`./settings.ts`): per field
 * the environment (`RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`) wins over
 * what an admin stored in `/admin/email`, so env-only deployments behave as
 * before.
 *
 *  - No API key → nothing is sent; a one-line notice is logged and
 *    `{ sent: false, reason: 'not_configured' }` comes back. Local development
 *    and the self-test run this way.
 *  - No sender → `missing_from`. The sender must be an address on a domain
 *    verified in Resend.
 *  - Never throws: a failed send returns `{ sent: false, reason }` so a booking
 *    is never lost because a mail bounced. `sent: true` means Resend ACCEPTED
 *    the message, not that it was delivered.
 *  - Logs carry masked recipients and the subject, never the key; provider
 *    messages pass through `redactSecrets()`.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const REQUEST_TIMEOUT_MS = 10_000;

export type EmailAttachment = {
  filename: string;
  /** Raw text or bytes; base64-encoded for Resend here. */
  content: string | Buffer | Uint8Array;
  contentType?: string;
};

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
  replyTo?: string | null;
};

export type SendEmailResult = { sent: true; id: string | null } | { sent: false; reason: string };

/** `jan.peeters@example.com` → `j***@example.com` — for logs only. */
export function maskEmail(address: string): string {
  const [local, domain] = address.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * `settings` lets a caller that already resolved them (the voucher service,
 * which also needs the order inbox) avoid a second read.
 */
export async function sendEmail(
  input: SendEmailInput,
  settings?: ResolvedEmailSettings,
): Promise<SendEmailResult> {
  const recipients = (Array.isArray(input.to) ? input.to : [input.to])
    .map((address) => address.trim())
    .filter(Boolean);
  if (recipients.length === 0) return { sent: false, reason: 'no_recipient' };

  const config = settings ?? (await loadEmailSettings());
  const apiKey = config.apiKey;
  if (!apiKey) {
    console.info(
      `[email] geen API-sleutel (RESEND_API_KEY of /admin/email) — niet verstuurd: “${input.subject}” → ${recipients.map(maskEmail).join(', ')}`,
    );
    return { sent: false, reason: 'not_configured' };
  }

  const from = config.from;
  if (!from) {
    console.warn('[email] geen afzender (EMAIL_FROM of /admin/email) — e-mail niet verstuurd.');
    return { sent: false, reason: 'missing_from' };
  }

  const replyTo = input.replyTo ?? (config.replyTo || null);

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: recipients,
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(input.attachments?.length
          ? {
              attachments: input.attachments.map((attachment) => ({
                filename: attachment.filename,
                content: (typeof attachment.content === 'string'
                  ? Buffer.from(attachment.content, 'utf8')
                  : Buffer.from(attachment.content)
                ).toString('base64'),
                ...(attachment.contentType ? { content_type: attachment.contentType } : {}),
              })),
            }
          : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const body = (await response.json()) as { message?: string; name?: string };
        detail = body.message ?? body.name ?? detail;
      } catch {
        // keep the status line
      }
      detail = redactSecrets(detail);
      console.error(`[email] Resend weigerde “${input.subject}”: ${detail}`);
      return { sent: false, reason: detail };
    }

    const body = (await response.json().catch(() => ({}))) as { id?: string };
    return { sent: true, id: body.id ?? null };
  } catch (error) {
    const reason = redactSecrets(error instanceof Error ? error.message : 'onbekende fout');
    console.error(`[email] versturen mislukt “${input.subject}”: ${reason}`);
    return { sent: false, reason };
  }
}
