import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { z } from 'zod';
import { stripe } from '@/lib/stripe';
import { getProductBySlug } from '@/db/queries';
import { env } from '@/lib/env';

const bodySchema = z.object({
  items: z
    .array(
      z.object({
        slug: z.string().min(1),
        quantity: z.number().int().positive().max(99),
      }),
    )
    .min(1),
});

/**
 * Create a Stripe Checkout session. Prices are recomputed from the database —
 * the client-submitted cart only contributes slugs and quantities, never money.
 */
export async function POST(request: Request) {
  if (!stripe) {
    return NextResponse.json(
      { error: 'Payments are not configured yet. Add STRIPE_SECRET_KEY to enable checkout.' },
      { status: 501 },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid cart.' }, { status: 400 });
  }

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
  for (const item of parsed.data.items) {
    const product = await getProductBySlug(item.slug);
    if (!product || !product.isActive || product.stockCount < item.quantity) continue;
    lineItems.push({
      quantity: item.quantity,
      price_data: {
        currency: 'eur',
        unit_amount: Math.round(Number(product.price) * 100),
        product_data: { name: product.name },
      },
    });
  }

  if (lineItems.length === 0) {
    return NextResponse.json({ error: 'No purchasable items in cart.' }, { status: 400 });
  }

  const origin = env.NEXT_PUBLIC_APP_URL ?? request.headers.get('origin') ?? '';
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: lineItems,
    success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/checkout`,
  });

  return NextResponse.json({ url: session.url });
}
