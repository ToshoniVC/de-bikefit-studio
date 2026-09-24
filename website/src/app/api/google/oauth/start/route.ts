import { NextResponse, type NextRequest } from 'next/server';

import type { CmsUserPublic } from '@/db/cms-schema';
import { buildAuthUrl } from '@/lib/booking/google';
import { getOwnProvider, getProvider } from '@/lib/booking/repo';
import { getCurrentCmsUser } from '@/lib/cms/auth';
import { can } from '@/lib/cms/permissions';
import { features } from '@/lib/env';

import {
  OAUTH_STATE_COOKIE,
  canonicalOrigin,
  createOAuthState,
  notConfiguredResponse,
  oauthRedirectUri,
  plainResponse,
  stateCookieOptions,
  type OAuthReturnTo,
} from '../state';

/**
 * `GET /api/google/oauth/start?provider=<id>[&return=agenda|provider]`
 *
 * Starts the Google Calendar connection for one provider. Lives outside the
 * `/admin` middleware gate, so it checks the CMS session itself:
 *  - signed in (else → `/admin/login`), password already changed;
 *  - the provider row is the user's own (`provider.self`, via
 *    `getOwnProvider()`) OR the user has `provider.manage`.
 *
 * Then it sets the signed `cms_google_oauth` state cookie (see `../state.ts`)
 * and redirects (302) to Google's consent screen from `buildAuthUrl()`
 * (calendar.events + calendar.freebusy + openid email, `access_type=offline`,
 * `prompt=consent`, `include_granted_scopes`). Without the OAuth client env
 * vars: 503 with a Dutch message.
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
  if (!features.googleCalendar) return notConfiguredResponse();

  const url = request.nextUrl;
  const providerId = url.searchParams.get('provider')?.trim() ?? '';
  if (!providerId) return plainResponse(400, 'Geen aanbieder opgegeven.');

  // The state cookie must be set on the host Google sends the browser back to
  // (the redirect URI is built from NEXT_PUBLIC_SITE_URL). Hop there once.
  const origin = canonicalOrigin();
  if (url.origin !== origin && !url.searchParams.has('hop')) {
    const target = new URL(`${url.pathname}${url.search}`, origin);
    target.searchParams.set('hop', '1');
    return NextResponse.redirect(target, 302);
  }

  const user = await getCurrentCmsUser();
  if (!user) {
    const login = new URL('/admin/login', url.origin);
    login.searchParams.set('next', '/admin/agenda');
    return NextResponse.redirect(login, 302);
  }
  if (user.mustChangePassword) {
    return NextResponse.redirect(new URL('/admin/password', url.origin), 302);
  }

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

  const { state, cookieValue } = createOAuthState({ providerId, userId: user.id, returnTo });

  let authUrl: string;
  try {
    authUrl = buildAuthUrl({
      state: state.nonce,
      redirectUri: oauthRedirectUri(),
      loginHint: access.googleEmail,
    });
  } catch {
    return notConfiguredResponse();
  }

  const response = NextResponse.redirect(authUrl, 302);
  response.headers.set('Cache-Control', 'no-store');
  response.cookies.set(OAUTH_STATE_COOKIE, cookieValue, stateCookieOptions());
  return response;
}
