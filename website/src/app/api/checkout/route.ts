import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createCartCheckoutUrl, isShopifyConfigured } from '@/lib/shopify';

const bodySchema = z.object({
  items: z
    .array(
      z.object({
        variantId: z.string().min(1),
        quantity: z.number().int().positive().max(99),
      }),
    )
    .min(1),
});

/**
 * Build a Shopify cart from the submitted lines and return its hosted checkout
 * URL. Pricing, tax, shipping and payment are all handled by Shopify Checkout —
 * the client only contributes variant ids and quantities.
 */
export async function POST(request: Request) {
  if (!isShopifyConfigured) {
    return NextResponse.json(
      { error: 'The shop is not connected yet. Add your Shopify credentials to enable checkout.' },
      { status: 501 },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid cart.' }, { status: 400 });
  }

  try {
    const url = await createCartCheckoutUrl(parsed.data.items);
    if (!url) {
      return NextResponse.json({ error: 'Could not create a checkout.' }, { status: 502 });
    }
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json({ error: 'Checkout failed. Please try again.' }, { status: 502 });
  }
}
