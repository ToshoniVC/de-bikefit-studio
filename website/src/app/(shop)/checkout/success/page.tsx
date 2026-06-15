'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCart } from '@/lib/cart-store';

export default function CheckoutSuccessPage() {
  const clear = useCart((s) => s.clear);

  // Order is confirmed server-side via the Stripe webhook; clear the local cart.
  useEffect(() => {
    clear();
  }, [clear]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center sm:px-6">
      <CheckCircle2 className="size-12 text-brand" />
      <h1 className="font-display text-3xl font-extrabold uppercase tracking-tight">
        Thanks for your order
      </h1>
      <p className="text-muted-foreground">
        We&apos;ve received your payment and will email you a confirmation shortly.
      </p>
      <Button render={<Link href="/shop" />} className="font-display uppercase tracking-wide">
        Keep shopping
      </Button>
    </div>
  );
}
