import { z } from 'zod';

/**
 * Centralised, validated environment access (server-side).
 *
 * Integration secrets are `.optional()` so the app boots and renders before
 * any third-party service is wired up. Use the `features` flags below to branch
 * on whether a given integration is configured rather than reading
 * `process.env` directly elsewhere.
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

  // Payments (Mollie — Bancontact / iDEAL for the EU market)
  MOLLIE_API_KEY: z.string().optional(),

  // App
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),

  // --- CMS / Bikefit Studio site ---

  /**
   * Pepper for session-token hashing (`src/lib/cms/session.ts`).
   * Required in production — without it every `cms_session` cookie is rejected.
   * Generate with: `openssl rand -base64 48`
   */
  CMS_SESSION_SECRET: z.string().min(16).optional(),

  /**
   * One-shot password for the first admin created by `npm run cms:bootstrap`.
   * Set it in the shell for that command only; never commit it and never add
   * it to a Vercel environment.
   */
  CMS_BOOTSTRAP_PASSWORD: z.string().optional(),

  /** Canonical origin of the public site — used for canonicals, sitemap, OG. */
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),

  /**
   * READINESS ONLY — deliberately NOT loaded or used anywhere.
   * No analytics script and no analytics cookie ships until this is wired up
   * on purpose. Worker C provides a no-op wrapper component as the hook point.
   */
  NEXT_PUBLIC_GA4_MEASUREMENT_ID: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment variables. See errors above.');
}

export const env = parsed.data;

/** Whether each integration has the credentials it needs to function. */
export const features = {
  database: Boolean(env.DATABASE_URL),
  clerk: Boolean(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && env.CLERK_SECRET_KEY),
  stripe: Boolean(env.STRIPE_SECRET_KEY),
  mollie: Boolean(env.MOLLIE_API_KEY),
  /** Sessions are only durable across deploys once the pepper is fixed. */
  cmsSessions: Boolean(env.CMS_SESSION_SECRET),
  /**
   * A measurement id is *present*, which is not the same as analytics being
   * on. Nothing in the app reads this yet — see the comment on the env key.
   */
  ga4Configured: Boolean(env.NEXT_PUBLIC_GA4_MEASUREMENT_ID),
} as const;

/** Canonical public origin, with sensible fallbacks for local/preview. */
export function siteUrl(): string {
  return (
    env.NEXT_PUBLIC_SITE_URL ??
    env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  );
}
