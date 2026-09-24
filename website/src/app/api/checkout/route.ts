import { NextResponse } from 'next/server';
import { z } from 'zod';
import { inArray } from 'drizzle-orm';
import { requireDb } from '@/db';
import { products, orders, orderItems } from '@/db/schema';
import { getSession } from '@/lib/session';

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
 * TEMPORARY "approve-all" checkout: recomputes prices from the DB, records a
 * PAID order, and returns the success URL — no real payment. Replaced by Stripe
 * Checkout in Phase 2. Prices are still recomputed server-side so the flow
 * mirrors the real one.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid cart.' }, { status: 400 });
  }

  const db = requireDb();
  const slugs = parsed.data.items.map((i) => i.slug);
  const found = await db.select().from(products).where(inArray(products.slug, slugs));
  const bySlug = new Map(found.map((p) => [p.slug, p]));

  let total = 0;
  const lines: { productId: string; quantity: number; priceAtPurchase: string }[] = [];
  for (const item of parsed.data.items) {
    const product = bySlug.get(item.slug);
    if (!product || !product.isActive) continue;
    total += Number(product.price) * item.quantity;
    lines.push({
      productId: product.id,
      quantity: item.quantity,
      priceAtPurchase: product.price,
    });
  }

  if (lines.length === 0) {
    return NextResponse.json({ error: 'No purchasable items in cart.' }, { status: 400 });
  }

  const session = await getSession();
  const orderId = crypto.randomUUID();
  await db.insert(orders).values({
    id: orderId,
    userId: session?.userId ?? null,
    totalAmount: total.toFixed(2),
    status: 'paid', // stub: auto-approved
    shippingAddress: 'STUB CHECKOUT — no address collected',
  });
  await db.insert(orderItems).values(lines.map((l) => ({ orderId, ...l })));

  return NextResponse.json({ url: '/checkout/success' });
}
