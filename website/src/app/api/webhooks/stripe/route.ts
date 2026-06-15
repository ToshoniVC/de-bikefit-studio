import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { db } from '@/db';
import { orders } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { env } from '@/lib/env';

/**
 * Stripe → Neon order sync. Point a Stripe webhook at /api/webhooks/stripe with
 * the `checkout.session.completed` event; the signing secret goes in
 * STRIPE_WEBHOOK_SECRET. The raw request body is required for signature
 * verification, so we read it with request.text().
 */
export async function POST(request: Request) {
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Stripe is not configured.' }, { status: 501 });
  }

  const body = await request.text();
  const signature = request.headers.get('stripe-signature') ?? '';

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return new NextResponse('Invalid signature', { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (db) {
      await db
        .update(orders)
        .set({ status: 'paid' })
        .where(eq(orders.stripeSessionId, session.id));
    }
  }

  return NextResponse.json({ received: true });
}
