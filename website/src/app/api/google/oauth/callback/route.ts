import type { NextRequest } from 'next/server';

import {
  exchangeCode,
  fetchGoogleEmail,
  googleOAuthConfig,
  type GoogleTokens,
} from '@/lib/booking/google';
import { storeGoogleConnection } from '@/lib/booking/repo';
import { CmsAuthError, getCurrentCmsUser } from '@/lib/cms/auth';
import { cmsAccessDenial } from '@/lib/cms/guard';

import {
  OAUTH_STATE_COOKIE,
  flashRedirect,
  nonceMatches,
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
 *  2. the signed-in CMS user is the one who started, second step done, no
 *     temporary password → else `session`;
 *  3. the server is still ready (`googleOAuthConfig()`, as in the start
 *     route; a redeploy in between can change it) → else `config`. It also
 *     gives the redirect URI for step 5. Only after 1–2, so an anonymous
 *     caller learns nothing about the configuration;
 *  4. Google's own `error` query → `access_denied` (Cancel) or `google`;
 *  5. code exchange (`exchangeCode`) → else `exchange`;
 *  6. both calendar scopes actually granted (granular consent) → else
 *     `missing_scope`;
 *  7. account e-mail from the `id_token`, else the userinfo endpoint;
 *  8. `storeGoogleConnection()` (re-checks `provider.manage` / own scope,
 *     encrypts the tokens, audits) → `forbidden`, `no_refresh_token` or `store`.
 *
 * Success → `/admin/agenda?google=connected` (or `/admin/providers/<id>?…`
 * when started from there). The state cookie is cleared on every outcome.
 * Failures 3, 5 and 8 log a fixed `[google-oauth] <event>` code only (3 with
 * its problem codes), never the error: it can hold Google's
 * `error_description` or, for a failed query, the encrypted tokens and the
 * account e-mail.
 */

export const dynamic = 'force-dynamic';

const REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
];

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const state = readOAuthState(request.cookies.get(OAUTH_STATE_COOKIE)?.value);

  const finish = (path: string, params: Record<string, string>) => {
    const response = flashRedirect(url.origin, path, params);
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
  // A temporary-password or pre-MFA session could not store the tokens (the
  // repo below refuses it); stop before exchanging the code, like the start
  // route does.
  if (!user || user.id !== state.userId || cmsAccessDenial(user) !== null) return fail('session');

  // 3: still ready, and the redirect URI the start route sent.
  const config = googleOAuthConfig();
  if (!config.ready || !config.redirectUri) {
    console.error('[google-oauth] not_ready', { problems: config.problems });
    return fail('config');
  }

  // 4: the provider declined, or Google reported a problem.
  const googleError = url.searchParams.get('error');
  if (googleError) return fail(googleError === 'access_denied' ? 'access_denied' : 'google');

  const code = url.searchParams.get('code');
  if (!code) return fail('google');

  // 5: code → tokens (same redirect URI as in the start route).
  let tokens: GoogleTokens;
  try {
    tokens = await exchangeCode(code, config.redirectUri);
  } catch {
    console.error('[google-oauth] code_exchange_failed');
    return fail('exchange');
  }

  // 6: Google's granular consent lets people untick the calendar boxes.
  const granted = new Set(tokens.scope.split(/\s+/).filter(Boolean));
  if (!REQUIRED_SCOPES.every((scope) => granted.has(scope))) return fail('missing_scope');

  // 7: which Google account was connected.
  let googleEmail = tokens.email;
  if (!googleEmail) {
    try {
      googleEmail = await fetchGoogleEmail(tokens.accessToken);
    } catch {
      googleEmail = null;
    }
  }

  // 8: persist (encrypted) through the repo, which re-checks authorisation.
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
      console.error('[google-oauth] store_refused');
      return fail(tokens.refreshToken ? 'store' : 'no_refresh_token');
    }
  } catch (error) {
    if (error instanceof CmsAuthError)
      return fail(error.code === 'forbidden' ? 'forbidden' : 'session');
    console.error('[google-oauth] store_failed');
    return fail('store');
  }

  return finish(returnPath(state.returnTo, state.providerId), { google: 'connected' });
}
