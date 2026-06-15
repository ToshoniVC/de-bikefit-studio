import 'server-only';
import Stripe from 'stripe';
import { env } from './env';

/**
 * Stripe server client (global card payments). Null until STRIPE_SECRET_KEY is
 * set. The API version is left to the installed SDK's pinned default.
 */
export const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY, { typescript: true })
  : null;

export function requireStripe() {
  if (!stripe) {
    throw new Error('STRIPE_SECRET_KEY is not set. Add it to .env.local to enable checkout.');
  }
  return stripe;
}
