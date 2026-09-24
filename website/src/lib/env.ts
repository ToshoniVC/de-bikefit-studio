import { z } from 'zod';

/**
 * Centralised, validated environment access (server-side). Every variable the
 * app reads is declared in `envSchema` below and listed in `.env.example`; no
 * other module in `src/` reads `process.env` (CLAUDE.md §3). Documented
 * exceptions, each commented where it happens:
 *  - `src/middleware.ts` runs on the edge runtime, where only literal
 *    `process.env.X` reads are wired up at build time;
 *  - `'use client'` code must use literal `process.env.NEXT_PUBLIC_…` so Next
 *    inlines the value (none today: client components get such values as
 *    props from a server component).
 *
 * Integration secrets are `.optional()` so the app boots and renders before
 * any third-party service is wired up. Branch on the `features` flags below
 * rather than on the raw values.
 *
 * Values are read LAZILY: `env.X` validates and returns the current
 * `process.env.X` on every access. Scripts (`scripts/*.mts`) load `.env.local`
 * and adjust variables after their imports are evaluated, and tests use
 * `vi.stubEnv()`; both must see the value at call time, not a snapshot taken
 * at import. The whole schema is still checked once at import, so a malformed
 * value fails fast at boot exactly as before. An empty value (`FOO=""`, as in
 * `.env.example`) counts as unset.
 */
const envSchema = z.object({
  // Database (Neon)
  DATABASE_URL: z.string().url().optional(),

  // Auth (Clerk)
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_SECRET_KEY: z.string().optional(),
  CLERK_WEBHOOK_SECRET: z.string().optional(),

  // Payments (Stripe)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),

  // App
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),

  // --- Platform (set by Vercel, never by hand) ---

  /** `production` | `preview` | `development` (`vercel dev`); unset locally. */
  VERCEL_ENV: z.enum(['production', 'preview', 'development']).optional(),
  /** Deployment host name without scheme, e.g. `bikefit-abc123.vercel.app`. */
  VERCEL_URL: z.string().optional(),

  // --- CMS / Bikefit Studio site ---

  /**
   * Pepper for session-token hashing and the signing/encryption keys derived
   * from it (`src/lib/secrets.ts`). Required in production — without it every
   * `cms_session` cookie is rejected. Generate with: `openssl rand -base64 48`
   */
  CMS_SESSION_SECRET: z.string().min(16).optional(),

  /**
   * One-shot password for the first admin created by `npm run cms:bootstrap`.
   * Set it in the shell for that command only; never commit it and never add
   * it to a Vercel environment.
   */
  CMS_BOOTSTRAP_PASSWORD: z.string().optional(),

  /** Where the local PGlite database lives (default `.pglite`); local/scripts only. */
  CMS_PGLITE_DIR: z.string().optional(),
  /** `'false'` skips PGlite's automatic migration on first use; local/scripts only. */
  CMS_PGLITE_AUTO_MIGRATE: z.string().optional(),

  /** Canonical origin of the public site — used for canonicals, sitemap, OG. */
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),

  /**
   * GA4 measurement id (`G-XXXXXXXXXX`). Read on the server by
   * `studioMeasurementId()` (`src/components/studio/analytics.tsx`) and the
   * admin analytics panel. GA4 loads only when this is set AND
   * `analytics.enabled` is on in the site settings, and then only after the
   * visitor accepts the consent banner.
   */
  NEXT_PUBLIC_GA4_MEASUREMENT_ID: z.string().optional(),

  // --- Booking: Google Calendar (per-provider OAuth) ---

  /** OAuth 2.0 client (type "Web application") from the Google Cloud console. */
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  /**
   * base64 of 32 random bytes (`openssl rand -base64 32`). Encrypts providers'
   * Google refresh tokens (AES-256-GCM). When absent, a key is derived from
   * `CMS_SESSION_SECRET` (HKDF-SHA256, info `google-token`). Rotating either
   * one makes stored tokens unreadable: providers must reconnect Google.
   */
  GOOGLE_TOKEN_ENCRYPTION_KEY: z.string().optional(),

  // --- Analytics dashboard: GA4 Data API (service account) ---

  /** Numeric GA4 property id; overrides the `analytics.ga4PropertyId` setting. */
  GA4_PROPERTY_ID: z.string().optional(),
  /** Service-account key JSON, raw or base64-encoded. Viewer on the property. */
  GA4_SERVICE_ACCOUNT_JSON: z.string().optional(),

  // --- Transactional e-mail (Resend REST API) ---

  RESEND_API_KEY: z.string().optional(),
  /** e.g. `De Bikefit Studio <afspraken@debikefitstudio.be>` (verified domain). */
  EMAIL_FROM: z.string().optional(),
  EMAIL_REPLY_TO: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;
type EnvKey = keyof Env;

const envShape = envSchema.shape;

function isEnvKey(key: string): key is EnvKey {
  return Object.prototype.hasOwnProperty.call(envShape, key);
}

/** The raw current value; an empty string counts as unset (`FOO=""` in a dotenv file). */
function rawValue(key: EnvKey): string | undefined {
  const value = process.env[key];
  return value === '' ? undefined : value;
}

// Fail fast at boot: one full check of everything that is set.
const initial = envSchema.safeParse(
  Object.fromEntries(Object.keys(envShape).map((key) => [key, rawValue(key as EnvKey)])),
);
if (!initial.success) {
  console.error('[env] invalid environment variables:', z.flattenError(initial.error).fieldErrors);
  throw new Error('Invalid environment variables. See errors above.');
}

/** Validates and returns the CURRENT value of one variable. */
function readEnv<K extends EnvKey>(key: K): Env[K] {
  const schema: z.ZodType = envShape[key];
  const parsed = schema.safeParse(rawValue(key));
  if (!parsed.success) {
    console.error(`[env] invalid value for ${key}`);
    throw new Error(`Invalid environment variable ${key}.`);
  }
  return parsed.data as Env[K];
}

/** `env.X` — the validated current value of `X` (see the lazy-read note above). */
export const env: Readonly<Env> = new Proxy({} as Env, {
  get(_target, key) {
    return typeof key === 'string' && isEnvKey(key) ? readEnv(key) : undefined;
  },
  has(_target, key) {
    return typeof key === 'string' && isEnvKey(key);
  },
});

/**
 * `NODE_ENV` as Next/Node set it (`development`, `production` or `test`). The
 * literal `process.env.NODE_ENV` is inlined by Next at build time, so branches
 * on it are still eliminated in production bundles.
 */
export function nodeEnv(): string {
  return process.env.NODE_ENV ?? 'development';
}

/** `true` in a production build/runtime (`next build`/`next start`, Vercel previews included). */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** Whether each integration has the credentials it needs to function (read at call time). */
export const features = {
  get database() {
    return Boolean(env.DATABASE_URL);
  },
  get clerk() {
    return Boolean(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && env.CLERK_SECRET_KEY);
  },
  /** Clerk's publishable key is present, which is what mounts the webshop's auth UI. */
  get clerkUi() {
    return Boolean(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  },
  get stripe() {
    return Boolean(env.STRIPE_SECRET_KEY);
  },
  /** Sessions are only durable across deploys once the pepper is fixed. */
  get cmsSessions() {
    return Boolean(env.CMS_SESSION_SECRET);
  },
  /**
   * A measurement id is *present*, which is not the same as analytics being
   * on: that also needs the `analytics.enabled` site setting and, per
   * visitor, consent. See `studioMeasurementId()`.
   */
  get ga4Configured() {
    return Boolean(env.NEXT_PUBLIC_GA4_MEASUREMENT_ID);
  },
  /** Providers can connect Google Calendar (OAuth client configured). */
  get googleCalendar() {
    return Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET);
  },
  /**
   * GA4 Data API credentials present. The property id may still come from the
   * `analytics.ga4PropertyId` setting instead of `GA4_PROPERTY_ID`.
   */
  get ga4Data() {
    return Boolean(env.GA4_SERVICE_ACCOUNT_JSON);
  },
  /** Transactional e-mail is sent (otherwise logged and skipped). */
  get email() {
    return Boolean(env.RESEND_API_KEY);
  },
};

/** Canonical public origin, with sensible fallbacks for local/preview. */
export function siteUrl(): string {
  return (
    env.NEXT_PUBLIC_SITE_URL ??
    env.NEXT_PUBLIC_APP_URL ??
    (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : 'http://localhost:3000')
  );
}
