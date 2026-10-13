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
 *  - Logs and `reason` carry only safe facts: the number of recipients, the
 *    HTTP status, Resend's error code (its `name`, only when it is a plain
 *    code such as `validation_error`) and the name of a thrown error
 *    (`TimeoutError`, `TypeError`). Never the subject (booking subjects hold
 *    the customer's name), an address (not even masked), the body, Resend's
 *    error `message` (it can echo the request) or an error's message; never
 *    the key. `redactSecrets()` still runs on top, as defence in depth.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const REQUEST_TIMEOUT_MS = 10_000;
/** Resend's error names are codes (`validation_error`, `rate_limit_exceeded`); anything else is dropped. */
const PROVIDER_CODE_RE = /^[a-z_]{1,64}$/;
/** A thrown error's name (`TimeoutError`, `AbortError`, `TypeError`); anything else is `unknown`. */
const ERROR_NAME_RE = /^[A-Za-z]{1,64}$/;

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

/**
 * `reason` is a fixed vocabulary, safe to log, audit and show an admin:
 * `no_recipient`, `not_configured`, `missing_from`; `HTTP <status>` or
 * `HTTP <status>: <Resend code>` when Resend refused; `request_failed:
 * <ErrorName>` when no response came (timeout, network). Never free text from
 * outside: `sendFailureCode()` and `describeSendFailure()` in `./config.ts`
 * and the gift voucher's `reasonCode()` map it.
 */
export type SendEmailResult = { sent: true; id: string | null } | { sent: false; reason: string };

/** `jan.peeters@example.com` → `j***@example.com` — for the test-mail audit entry; `sendEmail()` logs no address. */
export function maskEmail(address: string): string {
  const [local, domain] = address.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

function recipientCount(count: number): string {
  return count === 1 ? '1 ontvanger' : `${count} ontvangers`;
}

/** `HTTP 422: validation_error`, or just `HTTP 422`: never Resend's `message`. */
async function refusalReason(response: Response): Promise<string> {
  let code: string | null = null;
  try {
    const body: unknown = await response.json();
    const name = typeof body === 'object' && body !== null && 'name' in body ? body.name : null;
    if (typeof name === 'string' && PROVIDER_CODE_RE.test(name)) code = name;
  } catch {
    // no JSON body: the status alone
  }
  return redactSecrets(code ? `HTTP ${response.status}: ${code}` : `HTTP ${response.status}`);
}

/** `request_failed: TimeoutError`: the error's name, never its message. */
function failureReason(error: unknown): string {
  const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : null;
  const safeName = typeof name === 'string' && ERROR_NAME_RE.test(name) ? name : 'unknown';
  return redactSecrets(`request_failed: ${safeName}`);
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
      `[email] geen API-sleutel (RESEND_API_KEY of /admin/email) — niet verstuurd (${recipientCount(recipients.length)}).`,
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
      const reason = await refusalReason(response);
      console.error(
        `[email] Resend weigerde het bericht (${reason}, ${recipientCount(recipients.length)}).`,
      );
      return { sent: false, reason };
    }

    const body = (await response.json().catch(() => ({}))) as { id?: string };
    return { sent: true, id: body.id ?? null };
  } catch (error) {
    const reason = failureReason(error);
    console.error(`[email] versturen mislukt (${reason}, ${recipientCount(recipients.length)}).`);
    return { sent: false, reason };
  }
}
