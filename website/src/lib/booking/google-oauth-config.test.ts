import { afterEach, describe, expect, it, vi } from 'vitest';

import { siteUrl } from '@/lib/env';

import {
  GOOGLE_OAUTH_PROBLEMS,
  googleOAuthProblemText,
  googleSetupView,
  resolveGoogleOAuthConfig,
  type GoogleOAuthEnv,
} from './google-oauth-config';

const STAGING = 'https://de-bikefit-studio-git-staging-toshoni.vercel.app';
const STAGING_CALLBACK = `${STAGING}/api/google/oauth/callback`;
const DEPLOYMENT_HOST = 'de-bikefit-studio-kanarie123-toshoni.vercel.app';
const CLIENT_ID = 'fixture-client-id';
const CLIENT_SECRET = 'fixture-client-secret';
/** A Vercel deployment with everything set, as staging should be. */
const STAGING_ENV: GoogleOAuthEnv = {
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  tokenKeyUsable: true,
  siteUrl: STAGING,
  appUrl: null,
  vercelUrl: DEPLOYMENT_HOST,
  production: true,
};

const DEVELOPMENT_ENV: GoogleOAuthEnv = {
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  tokenKeyUsable: true,
  production: false,
};

describe('resolveGoogleOAuthConfig: the OAuth client', () => {
  it.each([
    ['none', null, null, ['client_id_missing', 'client_secret_missing']],
    ['only the id', CLIENT_ID, null, ['client_secret_missing']],
    ['only the secret', null, CLIENT_SECRET, ['client_id_missing']],
    ['both', CLIENT_ID, CLIENT_SECRET, []],
  ] as const)('%s set', (_label, clientId, clientSecret, problems) => {
    for (const base of [STAGING_ENV, DEVELOPMENT_ENV]) {
      const config = resolveGoogleOAuthConfig({ ...base, clientId, clientSecret });
      expect(config.problems).toEqual(problems);
      expect(config.ready).toBe(problems.length === 0);
      // The URI to register is known even before the client exists.
      expect(config.redirectUri).not.toBeNull();
    }
  });

  it('counts an empty or blank value as missing, as src/lib/env.ts does for ""', () => {
    const config = resolveGoogleOAuthConfig({ ...STAGING_ENV, clientId: '', clientSecret: ' \n' });
    expect(config.problems).toEqual(['client_id_missing', 'client_secret_missing']);
  });

  it('refuses a value pasted with a line break or a space', () => {
    const config = resolveGoogleOAuthConfig({
      ...STAGING_ENV,
      clientId: `${CLIENT_ID}\n`,
      clientSecret: ` ${CLIENT_SECRET}`,
    });
    expect(config.ready).toBe(false);
    expect(config.problems).toEqual(['client_id_malformed', 'client_secret_malformed']);
  });

  it('refuses an unusable token key, so a consent never ends in "store"', () => {
    const config = resolveGoogleOAuthConfig({ ...STAGING_ENV, tokenKeyUsable: false });
    expect(config.ready).toBe(false);
    expect(config.problems).toEqual(['token_key_unusable']);
  });

  it('reports every problem at once', () => {
    const config = resolveGoogleOAuthConfig({
      clientId: null,
      clientSecret: null,
      tokenKeyUsable: false,
      siteUrl: null,
      vercelUrl: DEPLOYMENT_HOST,
      production: true,
    });
    expect(config.problems).toEqual([
      'client_id_missing',
      'client_secret_missing',
      'token_key_unusable',
      'site_url_missing',
    ]);
    expect(config.redirectUri).toBeNull();
  });
});

describe('resolveGoogleOAuthConfig: the redirect URI', () => {
  it.each([
    STAGING,
    `${STAGING}/`,
    `${STAGING}/nl`,
    `${STAGING}/nl/afspraak/?x=1#boeken`,
    ` ${STAGING}\n`,
  ])('is the origin of NEXT_PUBLIC_SITE_URL plus the callback path (%j)', (value) => {
    const config = resolveGoogleOAuthConfig({ ...STAGING_ENV, siteUrl: value });
    expect(config.ready).toBe(true);
    expect(config.problems).toEqual([]);
    expect(config.origin).toBe(STAGING);
    expect(config.originSource).toBe('site_url');
    expect(config.redirectUri).toBe(STAGING_CALLBACK);
  });

  it('gives the exact staging callback URI for the staging NEXT_PUBLIC_SITE_URL', () => {
    expect(resolveGoogleOAuthConfig(STAGING_ENV).redirectUri).toBe(
      'https://de-bikefit-studio-git-staging-toshoni.vercel.app/api/google/oauth/callback',
    );
  });

  it('requires https outside development', () => {
    const config = resolveGoogleOAuthConfig({
      ...STAGING_ENV,
      siteUrl: 'http://de-bikefit-studio-git-staging-toshoni.vercel.app',
    });
    expect(config.ready).toBe(false);
    expect(config.problems).toEqual(['site_url_not_https']);
    expect(config.origin).toBeNull();
    expect(config.redirectUri).toBeNull();
  });

  it('refuses localhost over http outside development (a local `next start` too)', () => {
    const config = resolveGoogleOAuthConfig({ ...STAGING_ENV, siteUrl: 'http://localhost:3000' });
    expect(config.problems).toEqual(['site_url_not_https']);
  });

  it.each([
    ['VERCEL_URL only', { siteUrl: null, vercelUrl: DEPLOYMENT_HOST }],
    ['NEXT_PUBLIC_APP_URL only', { siteUrl: '', appUrl: 'https://shop.example.test' }],
    ['nothing at all', { siteUrl: null, vercelUrl: null }],
  ])('never falls back outside development: %s', (_label, patch) => {
    const config = resolveGoogleOAuthConfig({ ...STAGING_ENV, ...patch });
    expect(config.ready).toBe(false);
    expect(config.problems).toEqual(['site_url_missing']);
    expect(config.origin).toBeNull();
    expect(config.redirectUri).toBeNull();
    expect(JSON.stringify(config)).not.toContain(DEPLOYMENT_HOST);
  });

  it.each(['not a url', 'ftp://de-bikefit-studio.example', 'https://', 'mailto:x@example.test'])(
    'refuses a NEXT_PUBLIC_SITE_URL that is no http(s) origin (%j)',
    (value) => {
      for (const production of [true, false]) {
        const config = resolveGoogleOAuthConfig({ ...STAGING_ENV, siteUrl: value, production });
        expect(config.problems).toEqual(['site_url_invalid']);
        expect(config.redirectUri).toBeNull();
      }
    },
  );

  it('uses http://localhost:3000 in development when nothing is set', () => {
    const config = resolveGoogleOAuthConfig(DEVELOPMENT_ENV);
    expect(config.ready).toBe(true);
    expect(config.originSource).toBe('default');
    expect(config.redirectUri).toBe('http://localhost:3000/api/google/oauth/callback');
  });

  it('accepts localhost over http in development', () => {
    const config = resolveGoogleOAuthConfig({
      ...DEVELOPMENT_ENV,
      siteUrl: 'http://localhost:3000/',
    });
    expect(config.ready).toBe(true);
    expect(config.redirectUri).toBe('http://localhost:3000/api/google/oauth/callback');
  });

  it.each([
    [
      'NEXT_PUBLIC_SITE_URL first',
      { siteUrl: STAGING, appUrl: 'https://shop.example.test' },
      STAGING,
      'site_url',
    ],
    [
      'then NEXT_PUBLIC_APP_URL',
      { appUrl: 'https://shop.example.test/x' },
      'https://shop.example.test',
      'app_url',
    ],
    [
      'then https://VERCEL_URL',
      { vercelUrl: DEPLOYMENT_HOST },
      `https://${DEPLOYMENT_HOST}`,
      'vercel_url',
    ],
  ] as const)('follows the siteUrl() chain in development: %s', (_label, patch, origin, source) => {
    const config = resolveGoogleOAuthConfig({ ...DEVELOPMENT_ENV, ...patch });
    expect(config.ready).toBe(true);
    expect(config.origin).toBe(origin);
    expect(config.originSource).toBe(source);
  });
});

describe('resolveGoogleOAuthConfig in development agrees with siteUrl()', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    { NEXT_PUBLIC_SITE_URL: STAGING, NEXT_PUBLIC_APP_URL: '', VERCEL_URL: DEPLOYMENT_HOST },
    { NEXT_PUBLIC_SITE_URL: '', NEXT_PUBLIC_APP_URL: 'https://shop.example.test/', VERCEL_URL: '' },
    { NEXT_PUBLIC_SITE_URL: '', NEXT_PUBLIC_APP_URL: '', VERCEL_URL: DEPLOYMENT_HOST },
    { NEXT_PUBLIC_SITE_URL: '', NEXT_PUBLIC_APP_URL: '', VERCEL_URL: '' },
  ])('%o', (vars) => {
    for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
    const config = resolveGoogleOAuthConfig({
      ...DEVELOPMENT_ENV,
      siteUrl: vars.NEXT_PUBLIC_SITE_URL,
      appUrl: vars.NEXT_PUBLIC_APP_URL,
      vercelUrl: vars.VERCEL_URL,
    });
    expect(config.origin).toBe(new URL(siteUrl()).origin);
  });
});

describe('googleSetupView', () => {
  const notReady = resolveGoogleOAuthConfig({ ...STAGING_ENV, clientId: null, clientSecret: null });

  it('gives an admin the problems in Dutch and the URI to register', () => {
    const view = googleSetupView(notReady, { canManage: true });
    expect(view).toEqual({
      ready: false,
      admin: {
        problems: ['GOOGLE_OAUTH_CLIENT_ID ontbreekt.', 'GOOGLE_OAUTH_CLIENT_SECRET ontbreekt.'],
        redirectUri: STAGING_CALLBACK,
      },
    });
  });

  it('gives everyone else nothing but "not ready": no variable names, no URI', () => {
    const view = googleSetupView(notReady, { canManage: false });
    expect(view).toEqual({ ready: false, admin: null });
  });

  it('shows a ready admin the URI that the routes send', () => {
    const view = googleSetupView(resolveGoogleOAuthConfig(STAGING_ENV), { canManage: true });
    expect(view).toEqual({ ready: true, admin: { problems: [], redirectUri: STAGING_CALLBACK } });
  });

  it('has a Dutch text for every problem that names a variable', () => {
    for (const problem of GOOGLE_OAUTH_PROBLEMS) {
      expect(googleOAuthProblemText(problem)).toMatch(
        /^(GOOGLE_OAUTH_CLIENT_ID|GOOGLE_OAUTH_CLIENT_SECRET|GOOGLE_TOKEN_ENCRYPTION_KEY|NEXT_PUBLIC_SITE_URL) /,
      );
    }
  });
});

describe('no secret ever leaves the module', () => {
  const SECRET_VALUES = [
    CLIENT_SECRET,
    CLIENT_ID,
    'kanarie-user',
    'kanarie-p4ss',
    'KanarieSecretWithSpace',
  ];
  const envs: GoogleOAuthEnv[] = [
    STAGING_ENV,
    { ...STAGING_ENV, clientSecret: 'Kanarie SecretWithSpace' },
    { ...STAGING_ENV, clientSecret: 'KanarieSecretWithSpace\n', clientId: `${CLIENT_ID} ` },
    { ...STAGING_ENV, siteUrl: `https://kanarie-user:kanarie-p4ss@${STAGING.slice(8)}/` },
    { ...STAGING_ENV, siteUrl: 'http://kanarie-user:kanarie-p4ss@example.test' },
    { ...STAGING_ENV, tokenKeyUsable: false, clientId: null },
    { ...DEVELOPMENT_ENV, siteUrl: 'https://kanarie-user:kanarie-p4ss@localhost:3000' },
  ];

  it.each(envs.map((env, index) => [index, env] as const))(
    'environment #%i: config, admin view and texts carry no value',
    (_index, env) => {
      const config = resolveGoogleOAuthConfig(env);
      const shown = [
        JSON.stringify(config),
        JSON.stringify(googleSetupView(config, { canManage: true })),
        JSON.stringify(googleSetupView(config, { canManage: false })),
        ...config.problems.map(googleOAuthProblemText),
      ].join('\n');
      for (const value of SECRET_VALUES) expect(shown).not.toContain(value);
      // The secret's prefix alone would already be a leak.
      expect(shown).not.toContain('GOCSPX');
    },
  );
});
