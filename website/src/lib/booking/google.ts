import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env, features, isProduction } from '@/lib/env';
import { derivedSecret } from '@/lib/secrets';

/**
 * Google Calendar over plain REST (`fetch`) — no `googleapis` dependency.
 *
 * Per-provider OAuth 2.0 ("Web application" client):
 *  - `buildAuthUrl()` → consent screen, `access_type=offline` + `prompt=consent`
 *    so Google always returns a refresh token;
 *  - `exchangeCode()` → tokens (+ the account e-mail from the `id_token`);
 *  - `refreshAccessToken()` → a fresh 1-hour access token;
 *  - `getFreeBusy()`, `insertEvent()`, `deleteEvent()` → Calendar API v3.
 *
 * Refresh tokens are stored encrypted with {@link encryptSecret} (AES-256-GCM).
 * The key is `GOOGLE_TOKEN_ENCRYPTION_KEY` (base64, 32 bytes) or, when that is
 * unset, HKDF-SHA256 of `CMS_SESSION_SECRET` with info `google-token`.
 * **Rotating either value makes stored tokens undecryptable: every provider
 * then has to reconnect Google.**
 *
 * Secrets are read through `src/lib/env.ts`, which reads lazily, so scripts
 * and the self-test can set them before the first call. The fallback key comes
 * from `derivedSecret('google-token')` in `src/lib/secrets.ts`.
 */

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
  // Non-sensitive; lets the callback read the account e-mail from the id_token.
  'openid',
  'email',
] as const;

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

const REQUEST_TIMEOUT_MS = 10_000;

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Google's error code, e.g. `invalid_grant` when a refresh token was revoked. */
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

/** Both OAuth client values are present. */
export function isGoogleConfigured(): boolean {
  return features.googleCalendar;
}

function clientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new GoogleApiError(
      'Google Calendar is niet geconfigureerd op deze server.',
      0,
      'not_configured',
    );
  }
  return { clientId, clientSecret };
}

// ---------------------------------------------------------------------------
// Token encryption
// ---------------------------------------------------------------------------

const ENCRYPTION_VERSION = 'v1';

function encryptionKey(): Buffer {
  const explicit = env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (explicit) {
    const key = Buffer.from(explicit, 'base64');
    if (key.length !== 32) {
      throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY must be base64 of exactly 32 bytes.');
    }
    return key;
  }
  if (!env.CMS_SESSION_SECRET && isProduction()) {
    throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY or CMS_SESSION_SECRET must be set in production.');
  }
  // HKDF-SHA256(CMS_SESSION_SECRET or the dev pepper, info `google-token`) — unchanged key.
  return derivedSecret('google-token');
}

/** AES-256-GCM → `v1.<iv>.<tag>.<ciphertext>` (base64url parts). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENCRYPTION_VERSION, iv, tag, ciphertext]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

/** Inverse of {@link encryptSecret}; `null` when the value is malformed or the key changed. */
export function decryptSecret(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null;
  const [version, iv, tag, ciphertext] = encrypted.split('.');
  if (version !== ENCRYPTION_VERSION || !iv || !tag || ciphertext === undefined) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function googleFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
  });
}

async function readError(response: Response, fallback: string): Promise<GoogleApiError> {
  let code: string | null = null;
  let message = fallback;
  try {
    const body = (await response.json()) as {
      error?: string | { message?: string; status?: string; errors?: { reason?: string }[] };
      error_description?: string;
    };
    if (typeof body.error === 'string') {
      code = body.error;
      message = body.error_description ?? body.error;
    } else if (body.error) {
      code = body.error.errors?.[0]?.reason ?? body.error.status ?? null;
      message = body.error.message ?? fallback;
    }
  } catch {
    // Non-JSON error body — keep the fallback.
  }
  return new GoogleApiError(message, response.status, code);
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export type GoogleTokens = {
  accessToken: string;
  /** Only present on a consent (Google omits it on silent re-authorisation). */
  refreshToken: string | null;
  expiresAt: Date;
  scope: string;
  idToken: string | null;
  /** From the `id_token` when the `email` scope was granted. */
  email: string | null;
};

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  token_type?: string;
};

/** Consent-screen URL. `state` must be verified by the callback (Worker D). */
export function buildAuthUrl({
  state,
  redirectUri,
  loginHint,
}: {
  state: string;
  redirectUri: string;
  loginHint?: string | null;
}): string {
  const { clientId } = clientCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  if (loginHint) params.set('login_hint', loginHint);
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/** Decodes (does not verify) the e-mail claim of an id_token received straight from Google. */
export function emailFromIdToken(idToken: string | null | undefined): string | null {
  if (!idToken) return null;
  const payload = idToken.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      email?: string;
    };
    return typeof claims.email === 'string' ? claims.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

function toTokens(body: TokenResponse): GoogleTokens {
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: new Date(Date.now() + Math.max(0, (body.expires_in ?? 3600) - 30) * 1000),
    scope: body.scope ?? '',
    idToken: body.id_token ?? null,
    email: emailFromIdToken(body.id_token),
  };
}

/** Authorization code → tokens. `redirectUri` must equal the one used in {@link buildAuthUrl}. */
export async function exchangeCode(code: string, redirectUri: string): Promise<GoogleTokens> {
  const { clientId, clientSecret } = clientCredentials();
  const response = await googleFetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!response.ok) throw await readError(response, 'Google weigerde de autorisatiecode.');
  return toTokens((await response.json()) as TokenResponse);
}

/** Refresh token → new access token. Throws `GoogleApiError` (`code: 'invalid_grant'` when revoked). */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: Date; scope: string }> {
  const { clientId, clientSecret } = clientCredentials();
  const response = await googleFetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) throw await readError(response, 'Google-toegang kon niet vernieuwd worden.');
  const tokens = toTokens((await response.json()) as TokenResponse);
  return { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt, scope: tokens.scope };
}

/** Best-effort revocation (disconnect). Never throws. */
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const response = await googleFetch(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Account e-mail via the OpenID userinfo endpoint (fallback when no id_token). */
export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  const response = await googleFetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { email?: string };
  return body.email?.toLowerCase() ?? null;
}

// ---------------------------------------------------------------------------
// Calendar API v3
// ---------------------------------------------------------------------------

export type GoogleBusyInterval = { start: string; end: string };

/** Busy intervals of one calendar in `[timeMin, timeMax)`. */
export async function getFreeBusy({
  accessToken,
  calendarId,
  timeMin,
  timeMax,
}: {
  accessToken: string;
  calendarId: string;
  timeMin: Date | string;
  timeMax: Date | string;
}): Promise<GoogleBusyInterval[]> {
  const response = await googleFetch(`${CALENDAR_API}/freeBusy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: new Date(timeMin).toISOString(),
      timeMax: new Date(timeMax).toISOString(),
      items: [{ id: calendarId }],
    }),
  });
  if (!response.ok) throw await readError(response, 'Beschikbaarheid ophalen bij Google mislukte.');
  const body = (await response.json()) as {
    calendars?: Record<string, { busy?: GoogleBusyInterval[]; errors?: { reason?: string }[] }>;
  };
  const calendar = body.calendars?.[calendarId];
  if (calendar?.errors?.length) {
    throw new GoogleApiError(
      `Agenda ${calendarId} kon niet gelezen worden (${calendar.errors[0]?.reason ?? 'onbekend'}).`,
      200,
      calendar.errors[0]?.reason ?? null,
    );
  }
  return calendar?.busy ?? [];
}

export type GoogleEventInput = {
  summary: string;
  description?: string;
  location?: string;
  /** ISO instants. */
  start: string;
  end: string;
  timeZone: string;
  /** Extra private properties, e.g. `{ bookingId }`. */
  privateProperties?: Record<string, string>;
};

/** Creates an event WITHOUT attendees (the customer gets our own e-mail + .ics). */
export async function insertEvent({
  accessToken,
  calendarId,
  event,
  sendUpdates = 'none',
}: {
  accessToken: string;
  calendarId: string;
  event: GoogleEventInput;
  sendUpdates?: 'all' | 'externalOnly' | 'none';
}): Promise<{ id: string; htmlLink: string | null }> {
  const url = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=${sendUpdates}`;
  const response = await googleFetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: event.summary,
      description: event.description,
      location: event.location,
      start: { dateTime: event.start, timeZone: event.timeZone },
      end: { dateTime: event.end, timeZone: event.timeZone },
      reminders: { useDefault: true },
      extendedProperties: event.privateProperties
        ? { private: event.privateProperties }
        : undefined,
    }),
  });
  if (!response.ok) throw await readError(response, 'Afspraak aanmaken in Google Agenda mislukte.');
  const body = (await response.json()) as { id: string; htmlLink?: string };
  return { id: body.id, htmlLink: body.htmlLink ?? null };
}

/** Deletes an event; an already-deleted event (404/410) counts as success. */
export async function deleteEvent({
  accessToken,
  calendarId,
  eventId,
  sendUpdates = 'none',
}: {
  accessToken: string;
  calendarId: string;
  eventId: string;
  sendUpdates?: 'all' | 'externalOnly' | 'none';
}): Promise<void> {
  const url = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=${sendUpdates}`;
  const response = await googleFetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.ok || response.status === 404 || response.status === 410) return;
  throw await readError(response, 'Afspraak verwijderen uit Google Agenda mislukte.');
}
