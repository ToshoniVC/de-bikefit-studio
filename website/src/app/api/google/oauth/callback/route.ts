import { NextResponse, type NextRequest } from 'next/server';

import { exchangeCode, fetchGoogleEmail, type GoogleTokens } from '@/lib/booking/google';
import { storeGoogleConnection } from '@/lib/booking/repo';
import { CmsAuthError, getCurrentCmsUser } from '@/lib/cms/auth';
import { features } from '@/lib/env';

import {
  OAUTH_STATE_COOKIE,
  nonceMatches,
  notConfiguredResponse,
  oauthRedirectUri,
  readOAuthState,
  returnPath,
  stateCookieOptions,
} from '../state';

/**
 * `GET /api/google/oauth/callback` — Google's redirect target.
 *
 * Order of checks (each failure → `?google=error&reason=<code>`):
 *  1. `state` cookie valid (HMAC, not expired) and its nonce equals the
 *     `state` query → else `state`;
 *  2. the signed-in CMS user is the one who started → else `session`;
 *  3. Google's own `error` query → `access_denied` (Cancel) or `google`;
 *  4. code exchange (`exchangeCode`) → else `exchange`;
 *  5. both calendar scopes actually granted (granular consent) → else
 *     `missing_scope`;
 *  6. account e-mail from the `id_token`, else the userinfo endpoint;
 *  7. `storeGoogleConnection()` (re-checks `provider.manage` / own scope,
 *     encrypts the tokens, audits) → `forbidden`, `no_refresh_token` or `store`.
 *
 * Success → `/admin/agenda?google=connected` (or `/admin/providers/<id>?…`
 * when started from there). The state cookie is cleared on every outcome.
 */

export const dynamic = 'force-dynamic';

const REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
];

export async function GET(request: NextRequest) {
  if (!features.googleCalendar) return notConfiguredResponse();

  const url = request.nextUrl;
  const state = readOAuthState(request.cookies.get(OAUTH_STATE_COOKIE)?.value);

  const finish = (path: string, params: Record<string, string>) => {
    const target = new URL(path, url.origin);
    for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
    const response = NextResponse.redirect(target, 302);
    response.headers.set('Cache-Control', 'no-store');
    response.cookies.set(OAUTH_STATE_COOKIE, '', stateCookieOptions(0));
    return response;
  };
  const fail = (reason: string) =>
    finish(state ? returnPath(state.returnTo, state.providerId) : '/admin/agenda', {
      google: 'error',
      reason,
    });

  // 1–2: CSRF / mix-up protection before anything else is looked at.
  if (!state || !nonceMatches(state, url.searchParams.get('state'))) return fail('state');

  const user = await getCurrentCmsUser();
  if (!user || user.id !== state.userId) return fail('session');

  // 3: the provider declined, or Google reported a problem.
  const googleError = url.searchParams.get('error');
  if (googleError) return fail(googleError === 'access_denied' ? 'access_denied' : 'google');

  const code = url.searchParams.get('code');
  if (!code) return fail('google');

  // 4: code → tokens (same redirect URI as in the start route).
  let tokens: GoogleTokens;
  try {
    tokens = await exchangeCode(code, oauthRedirectUri());
  } catch (error) {
    console.error(
      '[google-oauth] code exchange failed:',
      error instanceof Error ? error.message : error,
    );
    return fail('exchange');
  }

  // 5: Google's granular consent lets people untick the calendar boxes.
  const granted = new Set(tokens.scope.split(/\s+/).filter(Boolean));
  if (!REQUIRED_SCOPES.every((scope) => granted.has(scope))) return fail('missing_scope');

  // 6: which Google account was connected.
  let googleEmail = tokens.email;
  if (!googleEmail) {
    try {
      googleEmail = await fetchGoogleEmail(tokens.accessToken);
    } catch {
      googleEmail = null;
    }
  }

  // 7: persist (encrypted) through the repo, which re-checks authorisation.
  try {
    const stored = await storeGoogleConnection(
      state.providerId,
      {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      },
      googleEmail,
    );
    if (!stored.ok) {
      console.error('[google-oauth] storing the connection failed:', stored.message);
      return fail(tokens.refreshToken ? 'store' : 'no_refresh_token');
    }
  } catch (error) {
    if (error instanceof CmsAuthError)
      return fail(error.code === 'forbidden' ? 'forbidden' : 'session');
    console.error(
      '[google-oauth] storing the connection failed:',
      error instanceof Error ? error.message : error,
    );
    return fail('store');
  }

  return finish(returnPath(state.returnTo, state.providerId), { google: 'connected' });
}
