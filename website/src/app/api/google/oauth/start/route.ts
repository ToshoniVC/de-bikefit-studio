import { NextResponse, type NextRequest } from 'next/server';

import type { CmsUserPublic } from '@/db/cms-schema';
import { buildAuthUrl, googleOAuthConfig } from '@/lib/booking/google';
import { getOwnProvider, getProvider } from '@/lib/booking/repo';
import { getCurrentCmsUser } from '@/lib/cms/auth';
import { cmsAccessDenial } from '@/lib/cms/guard';
import { can } from '@/lib/cms/permissions';

import {
  OAUTH_STATE_COOKIE,
  createOAuthState,
  flashRedirect,
  plainResponse,
  returnPath,
  stateCookieOptions,
  type OAuthReturnTo,
} from '../state';

/**
 * `GET /api/google/oauth/start?provider=<id>[&return=agenda|provider]`
 *
 * Starts the Google Calendar connection for one provider. Lives outside the
 * `/admin` middleware gate, so it checks the CMS session itself. In order:
 *  1. when the redirect URI's origin is usable (`googleOAuthConfig().origin`:
 *     outside development only an https `NEXT_PUBLIC_SITE_URL`), hop there
 *     once, where the state cookie must live. Whether the rest of the
 *     configuration is ready plays no part, so the hop reveals nothing;
 *  2. signed in (else → `/admin/login`), second step done, password already
 *     changed;
 *  3. the provider row is the user's own (`provider.self`, via
 *     `getOwnProvider()`) OR the user has `provider.manage` (else 403);
 *  4. the server is ready: OAuth client set and well-formed, token key usable,
 *     outside development an https `NEXT_PUBLIC_SITE_URL`. Else back to the
 *     Google card with `?google=error&reason=config`; the card says what is
 *     missing to an admin and whom to ask to anyone else. Only now, so an
 *     anonymous caller learns nothing about the configuration.
 *
 * Then it sets the signed `cms_google_oauth` state cookie (see `../state.ts`)
 * and redirects (302) to Google's consent screen from `buildAuthUrl()`
 * (calendar.events + calendar.freebusy + openid email, `access_type=offline`,
 * `prompt=consent`, `include_granted_scopes`).
 */

export const dynamic = 'force-dynamic';

type Access = { own: boolean; manage: boolean; googleEmail: string | null };

/** How the user may reach this provider, or null when not at all / not found. */
async function resolveAccess(user: CmsUserPublic, providerId: string): Promise<Access | null> {
  const manage = can(user.role, 'provider.manage');

  if (can(user.role, 'provider.self')) {
    try {
      const own = await getOwnProvider();
      if (own && own.id === providerId) return { own: true, manage, googleEmail: own.googleEmail };
    } catch {
      // Fall through to the manage check.
    }
  }

  if (manage) {
    try {
      const provider = await getProvider(providerId);
      if (provider) return { own: false, manage: true, googleEmail: provider.googleEmail };
    } catch {
      return null;
    }
  }

  return null;
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const providerId = url.searchParams.get('provider')?.trim() ?? '';
  if (!providerId) return plainResponse(400, 'Geen aanbieder opgegeven.');

  const config = googleOAuthConfig();

  // 1. The state cookie must be set on the host Google sends the browser back
  // to: the redirect URI's origin. Hop there once. Decided on the origin alone,
  // never on `config.ready`, so an anonymous caller cannot tell a configured
  // server from one that is not. Without a trusted origin, step 4 answers here.
  if (config.origin && url.origin !== config.origin && !url.searchParams.has('hop')) {
    const target = new URL(`${url.pathname}${url.search}`, config.origin);
    target.searchParams.set('hop', '1');
    return NextResponse.redirect(target, 302);
  }

  // 2. Who is asking.
  const user = await getCurrentCmsUser();
  if (!user) {
    const login = new URL('/admin/login', url.origin);
    login.searchParams.set('next', '/admin/agenda');
    return NextResponse.redirect(login, 302);
  }
  const denial = cmsAccessDenial(user);
  if (denial === 'password_change_required') {
    return NextResponse.redirect(new URL('/admin/password', url.origin), 302);
  }
  if (denial !== null) {
    return NextResponse.redirect(new URL('/admin/login?mfa=1', url.origin), 302);
  }

  // 3. For which provider.
  const access = await resolveAccess(user, providerId);
  if (!access) {
    return plainResponse(403, 'Je kan Google Agenda niet verbinden voor deze aanbieder.');
  }

  // Return to a page the user can open: own profile → Mijn agenda, someone
  // else's → that provider's admin page. An admin who is also the provider may
  // ask for either with `return=`.
  const requested = url.searchParams.get('return');
  const returnTo: OAuthReturnTo = !access.own
    ? 'provider'
    : access.manage && requested === 'provider'
      ? 'provider'
      : 'agenda';
  const notReady = () =>
    flashRedirect(url.origin, returnPath(returnTo, providerId), {
      google: 'error',
      reason: 'config',
    });

  // 4. Never send the provider to Google when the round trip cannot succeed:
  // no client, a malformed value, a token key that cannot store the result, or
  // no stable https origin (a per-deployment VERCEL_URL would end in Google's
  // redirect_uri_mismatch). Codes only in the log, never a value.
  if (!config.ready || !config.redirectUri) {
    console.error('[google-oauth] not_ready', { problems: config.problems });
    return notReady();
  }

  const { state, cookieValue } = createOAuthState({ providerId, userId: user.id, returnTo });

  let authUrl: string;
  try {
    authUrl = buildAuthUrl({
      state: state.nonce,
      redirectUri: config.redirectUri,
      loginHint: access.googleEmail,
    });
  } catch {
    // Only throws without a client id, which `config.ready` already rules out.
    return notReady();
  }

  const response = NextResponse.redirect(authUrl, 302);
  response.headers.set('Cache-Control', 'no-store');
  response.cookies.set(OAUTH_STATE_COOKIE, cookieValue, stateCookieOptions());
  return response;
}
