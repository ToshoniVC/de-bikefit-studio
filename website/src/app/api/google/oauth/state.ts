import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { isProduction, siteUrl } from '@/lib/env';
import { sessionSecret } from '@/lib/secrets';

/**
 * Signed, short-lived state for the Google OAuth round trip, plus the small
 * helpers both routes need — shared by `start/route.ts` and
 * `callback/route.ts` (not a route itself: Next only routes `route.ts`, and a
 * route file may not export anything but its handlers).
 *
 * Double-submit design:
 *  - `start` puts a random nonce in Google's `state` parameter and the same
 *    nonce, plus the provider id, the CMS user id, where to return and an
 *    expiry, in an httpOnly cookie signed with HMAC-SHA256
 *    (`CMS_SESSION_SECRET` via `sessionSecret()` in `src/lib/secrets.ts`,
 *    domain-separated by a fixed prefix).
 *  - `callback` accepts the response only when the cookie's signature and
 *    expiry are valid, its nonce equals the `state` Google echoes back
 *    (constant-time), and the signed-in CMS user is the one who started.
 *
 * The cookie is `SameSite=Lax` (it must ride along on Google's top-level GET
 * redirect back to us), scoped to `/api/google/oauth`, and lives 10 minutes.
 * The return target is an enum, never a URL, so there is no open redirect.
 */

export const OAUTH_STATE_COOKIE = 'cms_google_oauth';
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;
export const OAUTH_COOKIE_PATH = '/api/google/oauth';
export const OAUTH_CALLBACK_PATH = '/api/google/oauth/callback';

export type OAuthReturnTo = 'agenda' | 'provider';

export type OAuthState = {
  v: 1;
  /** Provider row id (`cms_providers.id`). */
  providerId: string;
  /** CMS user who started the flow. */
  userId: string;
  nonce: string;
  returnTo: OAuthReturnTo;
  /** Epoch milliseconds. */
  expiresAt: number;
};

const HMAC_CONTEXT = 'cms-google-oauth-state:v1:';

function sign(payload: string): string {
  return createHmac('sha256', sessionSecret())
    .update(HMAC_CONTEXT + payload)
    .digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createOAuthState(input: {
  providerId: string;
  userId: string;
  returnTo: OAuthReturnTo;
}): { state: OAuthState; cookieValue: string } {
  const state: OAuthState = {
    v: 1,
    providerId: input.providerId,
    userId: input.userId,
    returnTo: input.returnTo,
    nonce: randomBytes(24).toString('base64url'),
    expiresAt: Date.now() + OAUTH_STATE_TTL_SECONDS * 1000,
  };
  const payload = Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
  return { state, cookieValue: `${payload}.${sign(payload)}` };
}

/** Verifies signature and expiry; null for anything tampered, stale or malformed. */
export function readOAuthState(cookieValue: string | undefined | null): OAuthState | null {
  if (!cookieValue) return null;
  const [payload, signature, extra] = cookieValue.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  if (!safeEqual(signature, sign(payload))) return null;

  try {
    const state = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as Partial<OAuthState>;
    if (
      state.v !== 1 ||
      typeof state.providerId !== 'string' ||
      typeof state.userId !== 'string' ||
      typeof state.nonce !== 'string' ||
      (state.returnTo !== 'agenda' && state.returnTo !== 'provider') ||
      typeof state.expiresAt !== 'number' ||
      state.expiresAt < Date.now()
    ) {
      return null;
    }
    return state as OAuthState;
  } catch {
    return null;
  }
}

/** Constant-time comparison of the `state` query value with the cookie nonce. */
export function nonceMatches(state: OAuthState, queryState: string | null): boolean {
  return Boolean(queryState) && safeEqual(state.nonce, queryState!);
}

export function stateCookieOptions(maxAgeSeconds = OAUTH_STATE_TTL_SECONDS) {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax' as const,
    path: OAUTH_COOKIE_PATH,
    maxAge: maxAgeSeconds,
  };
}

/** Canonical public origin (`NEXT_PUBLIC_SITE_URL` → … → localhost). */
export function canonicalOrigin(): string {
  return new URL(siteUrl()).origin;
}

/** `${siteUrl()}/api/google/oauth/callback` — must be registered in the OAuth client. */
export function oauthRedirectUri(): string {
  return `${canonicalOrigin()}${OAUTH_CALLBACK_PATH}`;
}

export function plainResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export function notConfiguredResponse(): Response {
  return plainResponse(
    503,
    'Google Agenda is nog niet ingesteld op deze website: GOOGLE_OAUTH_CLIENT_ID en GOOGLE_OAUTH_CLIENT_SECRET ontbreken. Zie docs/booking-runbook.md.',
  );
}

/** Where the admin lands afterwards. Provider ids are app-generated, but encode anyway. */
export function returnPath(returnTo: OAuthReturnTo, providerId: string): string {
  return returnTo === 'provider'
    ? `/admin/providers/${encodeURIComponent(providerId)}`
    : '/admin/agenda';
}
