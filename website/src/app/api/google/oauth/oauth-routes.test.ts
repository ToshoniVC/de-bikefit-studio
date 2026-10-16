import { inspect } from 'node:util';

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { GET as callback } from './callback/route';
import { GET as start } from './start/route';

/**
 * The Google OAuth routes, start and callback, inside one process. Replaced:
 * the CMS session (`@/lib/cms/auth`), the provider look-ups and the token store
 * (`@/lib/booking/repo`), and Google's token endpoint (a stubbed `fetch`). The
 * environment is stubbed per test. Everything else is the real code: the guard,
 * the HMAC-signed state cookie, the redirect-URI decision and `buildAuthUrl()`.
 * No database, no network.
 */

const fake = vi.hoisted(() => ({
  getCurrentCmsUser: vi.fn(),
  getOwnProvider: vi.fn(),
  getProvider: vi.fn(),
  storeGoogleConnection: vi.fn(),
}));

vi.mock('@/lib/cms/auth', async () => {
  const guard = await vi.importActual<typeof import('@/lib/cms/guard')>('@/lib/cms/guard');
  return { getCurrentCmsUser: fake.getCurrentCmsUser, CmsAuthError: guard.CmsAuthError };
});
vi.mock('@/lib/booking/repo', () => ({
  getOwnProvider: fake.getOwnProvider,
  getProvider: fake.getProvider,
  storeGoogleConnection: fake.storeGoogleConnection,
}));

const STAGING = 'https://de-bikefit-studio-git-staging-toshoni.vercel.app';
const CALLBACK_URI = `${STAGING}/api/google/oauth/callback`;
/** A per-deployment host, as `VERCEL_URL` holds it: never registered at Google. */
const DEPLOYMENT_HOST = 'de-bikefit-studio-kanarie123-toshoni.vercel.app';
const CLIENT_ID = 'fixture-client-id';
const CLIENT_SECRET = 'fixture-client-secret';
const TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');
const SESSION_SECRET = 'kanarie-session-secret-value-'.padEnd(64, 'k');
const PROVIDER_ID = '11111111-2222-4333-8444-555555555555';
const STATE_COOKIE = 'cms_google_oauth';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
];

/** Configuration internals that no response may carry, to anyone. */
const INTERNALS = [
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_TOKEN_ENCRYPTION_KEY',
  'NEXT_PUBLIC_SITE_URL',
  'VERCEL_URL',
  'CMS_SESSION_SECRET',
  'booking-runbook',
  CLIENT_SECRET,
  TOKEN_KEY,
  SESSION_SECRET,
];

const ADMIN = {
  id: 'admin-user-kanarie',
  role: 'admin',
  mustChangePassword: false,
  mfaVerified: true,
  reauthenticatedAt: null,
};
const PROVIDER = { ...ADMIN, id: 'provider-user-kanarie', role: 'provider' };
const EDITOR = { ...ADMIN, id: 'editor-user-kanarie', role: 'editor' };

type EnvName =
  | 'NODE_ENV'
  | 'VERCEL_ENV'
  | 'CMS_SESSION_SECRET'
  | 'GOOGLE_OAUTH_CLIENT_ID'
  | 'GOOGLE_OAUTH_CLIENT_SECRET'
  | 'GOOGLE_TOKEN_ENCRYPTION_KEY'
  | 'NEXT_PUBLIC_SITE_URL'
  | 'NEXT_PUBLIC_APP_URL'
  | 'VERCEL_URL';

/** Staging as it should be: a Vercel deployment with every Google variable set. */
const READY: Record<EnvName, string> = {
  NODE_ENV: 'production',
  VERCEL_ENV: 'preview',
  CMS_SESSION_SECRET: SESSION_SECRET,
  GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET: CLIENT_SECRET,
  GOOGLE_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
  NEXT_PUBLIC_SITE_URL: STAGING,
  NEXT_PUBLIC_APP_URL: '',
  VERCEL_URL: DEPLOYMENT_HOST,
};
/** Staging today: no Google variables at all. */
const NOT_CONFIGURED: Record<EnvName, string> = {
  ...READY,
  GOOGLE_OAUTH_CLIENT_ID: '',
  GOOGLE_OAUTH_CLIENT_SECRET: '',
  GOOGLE_TOKEN_ENCRYPTION_KEY: '',
};

/** An empty value counts as unset in `src/lib/env.ts`. */
function setEnv(values: Record<EnvName, string>): void {
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
}

function startRequest(origin = STAGING): NextRequest {
  return new NextRequest(`${origin}/api/google/oauth/start?provider=${PROVIDER_ID}`);
}

/** Everything a browser gets to see of a response. */
async function visible(response: Response): Promise<string> {
  return [
    String(response.status),
    response.headers.get('location') ?? '',
    response.headers.getSetCookie().join('\n'),
    await response.clone().text(),
  ].join('\n');
}

function expectNoInternals(text: string): void {
  for (const value of INTERNALS) expect(text).not.toContain(value);
}

function location(response: Response): URL {
  const value = response.headers.get('location');
  expect(value).toBeTruthy();
  return new URL(value!);
}

type StateCookie = { value: string; attributes: string[] };

function stateCookie(response: Response): StateCookie | null {
  const line = response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${STATE_COOKIE}=`));
  if (!line) return null;
  const [pair, ...attributes] = line.split(';').map((part) => part.trim());
  return { value: pair.slice(STATE_COOKIE.length + 1), attributes };
}

function statePayload(cookie: StateCookie): Record<string, unknown> {
  return JSON.parse(Buffer.from(cookie.value.split('.')[0], 'base64url').toString('utf8'));
}

function expectFlash(response: Response, path: string, params: Record<string, string>): void {
  const target = location(response);
  expect(target.pathname).toBe(path);
  for (const [key, value] of Object.entries(params)) {
    expect(target.searchParams.get(key)).toBe(value);
  }
}

/** The admin starts on the staging alias; returns the cookie and Google's `state`. */
async function startAsAdmin(): Promise<{ cookie: StateCookie; nonce: string }> {
  fake.getCurrentCmsUser.mockResolvedValue(ADMIN);
  const response = await start(startRequest());
  const cookie = stateCookie(response);
  expect(cookie).not.toBeNull();
  return { cookie: cookie!, nonce: location(response).searchParams.get('state')! };
}

function callbackRequest(query: string, cookie?: StateCookie): NextRequest {
  return new NextRequest(`${STAGING}/api/google/oauth/callback?${query}`, {
    headers: cookie ? { cookie: `${STATE_COOKIE}=${cookie.value}` } : {},
  });
}

function idToken(email: string): string {
  const payload = Buffer.from(JSON.stringify({ email })).toString('base64url');
  return `e30.${payload}.kanarie-signature`;
}

let tokenFetch: ReturnType<typeof vi.fn>;
let errorLog: MockInstance<typeof console.error>;

/** Everything the routes wrote to the server log, as Node would print it. */
function logged(): string {
  return errorLog.mock.calls.map((call) => inspect(call, { depth: 5 })).join('\n');
}

/** The not-ready line: a fixed event plus problem codes, never a variable's value or name. */
function expectNotReadyLogged(): void {
  expect(errorLog).toHaveBeenCalledWith('[google-oauth] not_ready', expect.any(Object));
  expectNoInternals(logged());
}

beforeEach(() => {
  vi.resetAllMocks();
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  fake.getOwnProvider.mockImplementation(async () => null);
  fake.getProvider.mockImplementation(async (id: string) =>
    id === PROVIDER_ID ? { id, googleEmail: null } : null,
  );
  fake.storeGoogleConnection.mockResolvedValue({ ok: true, data: {} });
  tokenFetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          access_token: 'ya29.kanarie-access-token',
          expires_in: 3600,
          refresh_token: '1//kanarie-refresh-token',
          scope: [...CALENDAR_SCOPES, 'openid'].join(' '),
          id_token: idToken('kanarie.provider@example.test'),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
  );
  vi.stubGlobal('fetch', tokenFetch);
  setEnv(READY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /api/google/oauth/start', () => {
  it('gives an anonymous caller the sign-in page and nothing about the configuration', async () => {
    for (const env of [NOT_CONFIGURED, READY]) {
      setEnv(env);
      fake.getCurrentCmsUser.mockResolvedValue(null);
      const response = await start(startRequest());

      expect(response.status).toBe(302);
      expect(location(response).origin).toBe(STAGING);
      expect(location(response).pathname).toBe('/admin/login');
      expect(stateCookie(response)).toBeNull();
      expectNoInternals(await visible(response));
    }
  });

  it('answers an anonymous caller on another host the same, configured or not', async () => {
    const answers: string[] = [];
    for (const env of [NOT_CONFIGURED, READY]) {
      setEnv(env);
      fake.getCurrentCmsUser.mockResolvedValue(null);
      const response = await start(startRequest(`https://${DEPLOYMENT_HOST}`));

      expect(fake.getCurrentCmsUser).not.toHaveBeenCalled();
      expect(stateCookie(response)).toBeNull();
      answers.push(await visible(response));
    }
    expect(answers[0]).toBe(answers[1]);
    expect(answers[0]).toContain(`${STAGING}/api/google/oauth/start?provider=${PROVIDER_ID}&hop=1`);
  });

  it('sends a provider back to Mijn agenda when Google is not configured, naming nothing', async () => {
    setEnv(NOT_CONFIGURED);
    fake.getCurrentCmsUser.mockResolvedValue(PROVIDER);
    fake.getOwnProvider.mockResolvedValue({ id: PROVIDER_ID, googleEmail: null });

    const response = await start(startRequest());

    expect(response.status).toBe(302);
    expectFlash(response, '/admin/agenda', { google: 'error', reason: 'config' });
    expect(stateCookie(response)).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expectNoInternals(await visible(response));
    expectNotReadyLogged();
  });

  it('sends a provider session without two-step verification back to the second step', async () => {
    for (const env of [NOT_CONFIGURED, READY]) {
      setEnv(env);
      fake.getCurrentCmsUser.mockResolvedValue({ ...PROVIDER, mfaVerified: false });
      fake.getOwnProvider.mockResolvedValue({ id: PROVIDER_ID, googleEmail: null });
      const response = await start(startRequest());

      expect(response.status).toBe(302);
      expect(location(response).pathname).toBe('/admin/login');
      expect(location(response).searchParams.get('mfa')).toBe('1');
      expect(stateCookie(response)).toBeNull();
      expect(fake.getOwnProvider).not.toHaveBeenCalled();
      expectNoInternals(await visible(response));
    }
  });

  it('refuses a user without access to the provider before looking at the configuration', async () => {
    for (const env of [NOT_CONFIGURED, READY]) {
      setEnv(env);
      fake.getCurrentCmsUser.mockResolvedValue(EDITOR);
      const response = await start(startRequest());

      expect(response.status).toBe(403);
      expect(stateCookie(response)).toBeNull();
      expectNoInternals(await visible(response));
    }
  });

  it('never sends Google a per-deployment redirect URI when NEXT_PUBLIC_SITE_URL is missing', async () => {
    setEnv({ ...READY, NEXT_PUBLIC_SITE_URL: '' });
    fake.getCurrentCmsUser.mockResolvedValue(ADMIN);

    const response = await start(startRequest(`https://${DEPLOYMENT_HOST}`));

    expect(location(response).host).toBe(DEPLOYMENT_HOST);
    expectFlash(response, `/admin/providers/${PROVIDER_ID}`, {
      google: 'error',
      reason: 'config',
    });
    expect(stateCookie(response)).toBeNull();
    expect(tokenFetch).not.toHaveBeenCalled();
    expectNotReadyLogged();
  });

  it('refuses an http origin outside development', async () => {
    const httpOrigin = STAGING.replace('https://', 'http://');
    setEnv({ ...READY, NEXT_PUBLIC_SITE_URL: httpOrigin });
    fake.getCurrentCmsUser.mockResolvedValue(ADMIN);

    const response = await start(startRequest(httpOrigin));

    expectFlash(response, `/admin/providers/${PROVIDER_ID}`, {
      google: 'error',
      reason: 'config',
    });
    expect(location(response).origin).toBe(httpOrigin);
    expect(stateCookie(response)).toBeNull();
    expectNotReadyLogged();
  });

  it('refuses a token key that is not base64 of 32 bytes, before the provider consents', async () => {
    for (const key of [
      Buffer.alloc(48, 1).toString('base64'), // openssl rand -base64 48 by mistake
      'ab'.repeat(32), // openssl rand -hex 32 by mistake
    ]) {
      setEnv({ ...READY, GOOGLE_TOKEN_ENCRYPTION_KEY: key });
      fake.getCurrentCmsUser.mockResolvedValue(ADMIN);

      const response = await start(startRequest());

      expectFlash(response, `/admin/providers/${PROVIDER_ID}`, {
        google: 'error',
        reason: 'config',
      });
      expect(stateCookie(response)).toBeNull();
      expect(await visible(response)).not.toContain(key);
      expectNotReadyLogged();
      expect(logged()).not.toContain(key);
    }
  });

  it('hops to the NEXT_PUBLIC_SITE_URL origin before anything else when ready', async () => {
    fake.getCurrentCmsUser.mockResolvedValue(ADMIN);

    const response = await start(startRequest(`https://${DEPLOYMENT_HOST}`));

    const target = location(response);
    expect(target.origin).toBe(STAGING);
    expect(target.pathname).toBe('/api/google/oauth/start');
    expect(target.searchParams.get('provider')).toBe(PROVIDER_ID);
    expect(target.searchParams.get('hop')).toBe('1');
    expect(stateCookie(response)).toBeNull();
    expect(fake.getCurrentCmsUser).not.toHaveBeenCalled();
  });

  it('sends a ready admin to Google with the canonical redirect URI and a locked-down state cookie', async () => {
    fake.getCurrentCmsUser.mockResolvedValue(ADMIN);

    const response = await start(startRequest());

    const target = location(response);
    expect(`${target.origin}${target.pathname}`).toBe(AUTH_ENDPOINT);
    expect(target.searchParams.get('redirect_uri')).toBe(CALLBACK_URI);
    expect(target.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(target.searchParams.get('response_type')).toBe('code');
    expect(target.searchParams.get('scope')).toBe(
      [...CALENDAR_SCOPES, 'openid', 'email'].join(' '),
    );
    expect(target.searchParams.get('access_type')).toBe('offline');
    expect(target.searchParams.get('prompt')).toBe('consent');
    expect(response.headers.get('cache-control')).toBe('no-store');

    const cookie = stateCookie(response)!;
    expect(cookie.attributes).toEqual(
      expect.arrayContaining([
        'Path=/api/google/oauth',
        'Max-Age=600',
        'Secure',
        'HttpOnly',
        'SameSite=lax',
      ]),
    );
    const payload = statePayload(cookie);
    expect(payload).toMatchObject({
      providerId: PROVIDER_ID,
      userId: ADMIN.id,
      returnTo: 'provider',
    });
    expect(target.searchParams.get('state')).toBe(payload.nonce);
    expect(response.headers.get('location')).not.toContain(CLIENT_SECRET);
  });
});

describe('GET /api/google/oauth/callback', () => {
  it('answers a request without the state cookie with the state error, configured or not', async () => {
    for (const env of [NOT_CONFIGURED, READY]) {
      setEnv(env);
      fake.getCurrentCmsUser.mockResolvedValue(null);
      const response = await callback(callbackRequest('state=kanarie&code=kanarie'));

      expect(response.status).toBe(302);
      expectFlash(response, '/admin/agenda', { google: 'error', reason: 'state' });
      expectNoInternals(await visible(response));
    }
    expect(tokenFetch).not.toHaveBeenCalled();
  });

  it('exchanges the code with exactly the redirect URI the start route sent', async () => {
    const { cookie, nonce } = await startAsAdmin();

    const response = await callback(callbackRequest(`state=${nonce}&code=kanarie-code`, cookie));

    expectFlash(response, `/admin/providers/${PROVIDER_ID}`, { google: 'connected' });
    expect(tokenFetch).toHaveBeenCalledTimes(1);
    const [url, init] = tokenFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TOKEN_ENDPOINT);
    const body = new URLSearchParams(String(init.body));
    expect(body.get('redirect_uri')).toBe(CALLBACK_URI);
    expect(body.get('code')).toBe('kanarie-code');
    expect(fake.storeGoogleConnection).toHaveBeenCalledWith(
      PROVIDER_ID,
      expect.objectContaining({ refreshToken: '1//kanarie-refresh-token' }),
      'kanarie.provider@example.test',
    );
    expect(stateCookie(response)?.attributes).toContain('Max-Age=0');
    expectNoInternals(await visible(response));
  });

  it('checks state and session first, then ends with reason=config on a server that is not ready', async () => {
    const { cookie, nonce } = await startAsAdmin();
    setEnv({ ...READY, GOOGLE_OAUTH_CLIENT_SECRET: '' });

    const response = await callback(callbackRequest(`state=${nonce}&code=kanarie-code`, cookie));

    expectFlash(response, `/admin/providers/${PROVIDER_ID}`, { google: 'error', reason: 'config' });
    expect(tokenFetch).not.toHaveBeenCalled();
    expect(stateCookie(response)?.attributes).toContain('Max-Age=0');
    expectNoInternals(await visible(response));
    expectNotReadyLogged();
  });

  it('still refuses another signed-in user than the one who started', async () => {
    const { cookie, nonce } = await startAsAdmin();
    fake.getCurrentCmsUser.mockResolvedValue({ ...ADMIN, id: 'someone-else' });

    const response = await callback(callbackRequest(`state=${nonce}&code=kanarie-code`, cookie));

    expectFlash(response, `/admin/providers/${PROVIDER_ID}`, {
      google: 'error',
      reason: 'session',
    });
    expect(tokenFetch).not.toHaveBeenCalled();
  });

  it('refuses to store tokens for a provider session without two-step verification', async () => {
    fake.getCurrentCmsUser.mockResolvedValue(PROVIDER);
    fake.getOwnProvider.mockResolvedValue({ id: PROVIDER_ID, googleEmail: null });
    const started = await start(startRequest());
    const cookie = stateCookie(started)!;
    const nonce = location(started).searchParams.get('state')!;
    fake.getCurrentCmsUser.mockResolvedValue({ ...PROVIDER, mfaVerified: false });

    const response = await callback(callbackRequest(`state=${nonce}&code=kanarie-code`, cookie));

    expectFlash(response, '/admin/agenda', { google: 'error', reason: 'session' });
    expect(tokenFetch).not.toHaveBeenCalled();
    expect(fake.storeGoogleConnection).not.toHaveBeenCalled();
  });

  it('still refuses a state value that does not match the cookie', async () => {
    const { cookie } = await startAsAdmin();

    const response = await callback(callbackRequest('state=kanarie-forged&code=x', cookie));

    expectFlash(response, `/admin/providers/${PROVIDER_ID}`, { google: 'error', reason: 'state' });
    expect(tokenFetch).not.toHaveBeenCalled();
  });
});
