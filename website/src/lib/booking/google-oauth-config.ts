/**
 * Whether this deployment may START a Google Calendar connection, and the
 * redirect URI it then sends to Google. Pure: no env, no database, no Next
 * runtime. `googleOAuthConfig()` in `./google.ts` feeds it the environment;
 * both OAuth routes (`src/app/api/google/oauth/`) and the admin's Google card
 * use that one result, so the URI an admin is shown is the URI the routes send.
 *
 * Ready means all of:
 *  - `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` present and
 *    without whitespace (a value pasted with a line break makes Google answer
 *    `invalid_client`, after the provider already left the site);
 *  - the token key usable (`GOOGLE_TOKEN_ENCRYPTION_KEY` base64 of exactly 32
 *    bytes, or unset: then derived from `CMS_SESSION_SECRET`). Otherwise the
 *    tokens could not be stored after the provider consented;
 *  - a redirect origin Google can be held to. Outside development
 *    (`NODE_ENV=production`: `next start` and every Vercel deployment) that is
 *    `NEXT_PUBLIC_SITE_URL` only, and only https. The other `siteUrl()`
 *    fallbacks are not used for OAuth there: `VERCEL_URL` is a different host
 *    for every deployment (never registered, so Google would answer
 *    `redirect_uri_mismatch`), and `NEXT_PUBLIC_APP_URL` is the legacy
 *    webshop's origin, not the documented source. In development the
 *    `siteUrl()` chain applies unchanged (`http://localhost:3000` by default).
 *
 * The result holds problem codes, the origin and the redirect URI, never a
 * value of the client id, the client secret or the token key. The Dutch texts
 * name variables, never values, and only a user with `provider.manage` gets
 * them (`googleSetupView()`).
 */

export const GOOGLE_OAUTH_CALLBACK_PATH = '/api/google/oauth/callback';

/** `siteUrl()`'s last fallback in `src/lib/env.ts`. */
const DEVELOPMENT_ORIGIN = 'http://localhost:3000';

export type GoogleOAuthEnv = {
  clientId?: string | null;
  clientSecret?: string | null;
  /** `google.ts` can build its token key (see `googleTokenKeyUsable()`). */
  tokenKeyUsable: boolean;
  /** `NEXT_PUBLIC_SITE_URL` */
  siteUrl?: string | null;
  /** `NEXT_PUBLIC_APP_URL` (development fallback only) */
  appUrl?: string | null;
  /** `VERCEL_URL`, a host name without scheme (development fallback only) */
  vercelUrl?: string | null;
  /** `NODE_ENV === 'production'`, as `isProduction()` reads it. */
  production: boolean;
};

export const GOOGLE_OAUTH_PROBLEMS = [
  'client_id_missing',
  'client_id_malformed',
  'client_secret_missing',
  'client_secret_malformed',
  'token_key_unusable',
  'site_url_missing',
  'site_url_invalid',
  'site_url_not_https',
] as const;

export type GoogleOAuthProblem = (typeof GOOGLE_OAUTH_PROBLEMS)[number];

/** Which variable the origin came from (`default` = localhost, development only). */
export type GoogleOAuthOriginSource = 'site_url' | 'app_url' | 'vercel_url' | 'default';

export type GoogleOAuthConfig = {
  ready: boolean;
  /** Empty exactly when `ready`. */
  problems: GoogleOAuthProblem[];
  /** Origin of the redirect URI and of the hop in the start route; null when unusable. */
  origin: string | null;
  originSource: GoogleOAuthOriginSource | null;
  /** `<origin>/api/google/oauth/callback`, to register in the OAuth client; null when unusable. */
  redirectUri: string | null;
};

function isBlank(value: string | null | undefined): boolean {
  return (value ?? '').trim() === '';
}

function credentialProblem(
  value: string | null | undefined,
  missing: GoogleOAuthProblem,
  malformed: GoogleOAuthProblem,
): GoogleOAuthProblem | null {
  if (isBlank(value)) return missing;
  return /\s/.test(value!) ? malformed : null;
}

type OriginResult = {
  origin: string | null;
  source: GoogleOAuthOriginSource | null;
  problem: GoogleOAuthProblem | null;
};

/** The URL's origin when it is an absolute http(s) URL with a host, else null. */
function httpOrigin(value: string): { origin: string; https: boolean } | null {
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname) return null;
    return { origin: url.origin, https: url.protocol === 'https:' };
  } catch {
    return null;
  }
}

function resolveOrigin(env: GoogleOAuthEnv): OriginResult {
  if (env.production) {
    if (isBlank(env.siteUrl)) return { origin: null, source: null, problem: 'site_url_missing' };
    const parsed = httpOrigin(env.siteUrl!);
    if (!parsed) return { origin: null, source: null, problem: 'site_url_invalid' };
    if (!parsed.https) return { origin: null, source: null, problem: 'site_url_not_https' };
    return { origin: parsed.origin, source: 'site_url', problem: null };
  }

  // Development: the first value that is set wins, as in `siteUrl()`.
  const [source, value]: [GoogleOAuthOriginSource, string] = !isBlank(env.siteUrl)
    ? ['site_url', env.siteUrl!]
    : !isBlank(env.appUrl)
      ? ['app_url', env.appUrl!]
      : !isBlank(env.vercelUrl)
        ? ['vercel_url', `https://${env.vercelUrl!.trim()}`]
        : ['default', DEVELOPMENT_ORIGIN];
  const parsed = httpOrigin(value);
  return parsed
    ? { origin: parsed.origin, source, problem: null }
    : { origin: null, source: null, problem: 'site_url_invalid' };
}

export function resolveGoogleOAuthConfig(env: GoogleOAuthEnv): GoogleOAuthConfig {
  const problems: GoogleOAuthProblem[] = [];
  const clientId = credentialProblem(env.clientId, 'client_id_missing', 'client_id_malformed');
  if (clientId) problems.push(clientId);
  const clientSecret = credentialProblem(
    env.clientSecret,
    'client_secret_missing',
    'client_secret_malformed',
  );
  if (clientSecret) problems.push(clientSecret);
  if (!env.tokenKeyUsable) problems.push('token_key_unusable');

  const origin = resolveOrigin(env);
  if (origin.problem) problems.push(origin.problem);
  const redirectUri = origin.origin ? `${origin.origin}${GOOGLE_OAUTH_CALLBACK_PATH}` : null;

  return {
    ready: problems.length === 0 && redirectUri !== null,
    problems,
    origin: origin.origin,
    originSource: origin.source,
    redirectUri,
  };
}

const PROBLEM_TEXT: Record<GoogleOAuthProblem, string> = {
  client_id_missing: 'GOOGLE_OAUTH_CLIENT_ID ontbreekt.',
  client_id_malformed:
    'GOOGLE_OAUTH_CLIENT_ID bevat een spatie of regeleinde. Plak de waarde opnieuw, zonder witruimte.',
  client_secret_missing: 'GOOGLE_OAUTH_CLIENT_SECRET ontbreekt.',
  client_secret_malformed:
    'GOOGLE_OAUTH_CLIENT_SECRET bevat een spatie of regeleinde. Plak de waarde opnieuw, zonder witruimte.',
  token_key_unusable:
    'GOOGLE_TOKEN_ENCRYPTION_KEY is geen base64 van precies 32 bytes. Maak een sleutel met openssl rand -base64 32.',
  site_url_missing:
    'NEXT_PUBLIC_SITE_URL ontbreekt. Op een deployment komt de terugkeer-URL voor Google alleen daaruit, nooit uit het adres van één deployment.',
  site_url_invalid: 'NEXT_PUBLIC_SITE_URL is geen geldig http(s)-adres.',
  site_url_not_https: 'NEXT_PUBLIC_SITE_URL moet met https:// beginnen.',
};

/** Dutch, for an admin: names the variable, never its value. */
export function googleOAuthProblemText(problem: GoogleOAuthProblem): string {
  return PROBLEM_TEXT[problem];
}

/** What the admin's Google card may show; plain data, safe to pass to a client component. */
export type GoogleSetupView = {
  ready: boolean;
  /** Only for a user with `provider.manage`; null for everyone else. */
  admin: { problems: string[]; redirectUri: string | null } | null;
};

export function googleSetupView(
  config: GoogleOAuthConfig,
  { canManage }: { canManage: boolean },
): GoogleSetupView {
  return {
    ready: config.ready,
    admin: canManage
      ? { problems: config.problems.map(googleOAuthProblemText), redirectUri: config.redirectUri }
      : null,
  };
}
