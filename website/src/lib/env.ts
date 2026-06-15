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
} as const;
