import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  encryptSecret,
  googleConnectSetup,
  googleOAuthConfig,
  googleTokenKeyUsable,
} from './google';

// `server-only` is stubbed in vitest.config.ts; nothing here calls Google.

const STAGING = 'https://de-bikefit-studio-git-staging-toshoni.vercel.app';
const DEPLOYMENT_HOST = 'de-bikefit-studio-kanarie123-toshoni.vercel.app';
const CLIENT_SECRET = 'fixture-client-secret';
const VARS = {
  NODE_ENV: 'production',
  CMS_SESSION_SECRET: 'kanarie-session-secret-value-'.padEnd(64, 'k'),
  GOOGLE_OAUTH_CLIENT_ID: 'fixture-client-id',
  GOOGLE_OAUTH_CLIENT_SECRET: CLIENT_SECRET,
  GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  NEXT_PUBLIC_SITE_URL: STAGING,
  NEXT_PUBLIC_APP_URL: '',
  VERCEL_URL: DEPLOYMENT_HOST,
};

function setEnv(vars: Partial<typeof VARS>): void {
  for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
}

beforeEach(() => setEnv(VARS));
afterEach(() => vi.unstubAllEnvs());

describe('googleTokenKeyUsable', () => {
  it.each([
    ['a base64 key of 32 bytes', Buffer.alloc(32, 3).toString('base64'), true],
    ['base64 of 48 bytes (openssl rand -base64 48)', Buffer.alloc(48, 3).toString('base64'), false],
    ['64 hex characters (openssl rand -hex 32)', 'ab'.repeat(32), false],
    ['unset: derived from CMS_SESSION_SECRET', '', true],
  ])('%s', (_label, key, usable) => {
    setEnv({ GOOGLE_TOKEN_ENCRYPTION_KEY: key });
    expect(googleTokenKeyUsable()).toBe(usable);

    // The same rule as storing a token: usable exactly when one can be sealed.
    let sealed = true;
    try {
      encryptSecret('1//kanarie-refresh-token');
    } catch {
      sealed = false;
    }
    expect(sealed).toBe(usable);
  });

  it('is false on a deployment with neither the key nor CMS_SESSION_SECRET', () => {
    setEnv({ GOOGLE_TOKEN_ENCRYPTION_KEY: '', CMS_SESSION_SECRET: '' });
    expect(googleTokenKeyUsable()).toBe(false);
  });
});

describe('googleOAuthConfig reads the environment', () => {
  it('is ready on staging with the staging callback URI', () => {
    expect(googleOAuthConfig()).toEqual({
      ready: true,
      problems: [],
      origin: STAGING,
      originSource: 'site_url',
      redirectUri: `${STAGING}/api/google/oauth/callback`,
    });
  });

  it('is not ready on a deployment without NEXT_PUBLIC_SITE_URL, whatever VERCEL_URL says', () => {
    setEnv({ NEXT_PUBLIC_SITE_URL: '' });
    const config = googleOAuthConfig();
    expect(config.ready).toBe(false);
    expect(config.problems).toEqual(['site_url_missing']);
    expect(config.redirectUri).toBeNull();
  });

  it('follows siteUrl() in development', () => {
    setEnv({ NODE_ENV: 'development', NEXT_PUBLIC_SITE_URL: '' });
    expect(googleOAuthConfig().redirectUri).toBe(
      `https://${DEPLOYMENT_HOST}/api/google/oauth/callback`,
    );
  });

  it('sees a token key that cannot be used', () => {
    setEnv({ GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString('base64') });
    expect(googleOAuthConfig().problems).toEqual(['token_key_unusable']);
  });

  it('hands the card details only for provider.manage, and never the secret', () => {
    setEnv({ GOOGLE_OAUTH_CLIENT_ID: '' });
    const admin = googleConnectSetup({ canManage: true });
    const provider = googleConnectSetup({ canManage: false });

    expect(admin.ready).toBe(false);
    expect(admin.admin?.problems).toEqual(['GOOGLE_OAUTH_CLIENT_ID ontbreekt.']);
    expect(admin.admin?.redirectUri).toBe(`${STAGING}/api/google/oauth/callback`);
    expect(provider).toEqual({ ready: false, admin: null });
    expect(JSON.stringify([admin, provider])).not.toContain(CLIENT_SECRET);
  });
});
