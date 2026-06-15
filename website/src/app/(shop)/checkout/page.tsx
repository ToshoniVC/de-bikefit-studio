'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCart, selectTotalPrice } from '@/lib/cart-store';
import { formatPrice } from '@/lib/format';

export default function CheckoutPage() {
  const items = useCart((s) => s.items);
  const total = useCart(selectTotalPrice);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCheckout() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((i) => ({ slug: i.slug, quantity: i.quantity })),
        }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setError(data.error ?? 'Checkout is unavailable right now.');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center sm:px-6">
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-tight">Checkout</h1>
        <p className="mt-2 text-muted-foreground">Your cart is empty.</p>
        <Button
          render={<Link href="/shop" />}
          className="mt-6 font-display uppercase tracking-wide"
        >
          Browse the shop
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:px-6">
      <h1 className="font-display text-3xl font-extrabold uppercase tracking-tight">Checkout</h1>

      <ul className="mt-6 divide-y rounded-lg border">
        {items.map((item) => (
          <li key={item.productId} className="flex items-center justify-between p-4">
            <span className="text-sm">
              {item.name} <span className="text-muted-foreground">× {item.quantity}</span>
            </span>
            <span className="text-sm font-medium tabular-nums">
              {formatPrice(Number(item.price) * item.quantity)}
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between p-4 font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatPrice(total)}</span>
        </li>
      </ul>

      {error ? <p className="mt-4 text-sm text-brand">{error}</p> : null}

      <Button
        onClick={handleCheckout}
        disabled={loading}
        className="mt-6 w-full font-display uppercase tracking-wide"
        size="lg"
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : null}
        Pay {formatPrice(total)}
      </Button>

      <p className="mt-3 text-center text-xs text-muted-foreground">
        Card via Stripe · Bancontact &amp; iDEAL via Mollie. Prices are re-verified server-side.
      </p>
    </div>
  );
}
