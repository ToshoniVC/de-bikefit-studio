import 'server-only';
import { createMollieClient, type MollieClient } from '@mollie/api-client';
import { env } from './env';

/**
 * Mollie server client (Bancontact / iDEAL for the EU market). Null until
 * MOLLIE_API_KEY is set. Use this instead of Stripe for Belgian/Dutch
 * local payment methods.
 */
export const mollie: MollieClient | null = env.MOLLIE_API_KEY
  ? createMollieClient({ apiKey: env.MOLLIE_API_KEY })
  : null;

export function requireMollie() {
  if (!mollie) {
    throw new Error('MOLLIE_API_KEY is not set. Add it to .env.local to enable Bancontact/iDEAL.');
  }
  return mollie;
}
