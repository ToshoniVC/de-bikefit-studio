'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShoppingBag, Plus, Minus, Trash2, Bike } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  SheetTrigger,
  SheetClose,
} from '@/components/ui/sheet';
import { useCart, selectTotalItems, selectTotalPrice } from '@/lib/cart-store';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';

export function CartSheet() {
  // Avoid a hydration mismatch: the persisted cart only exists on the client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const items = useCart((s) => s.items);
  const totalItems = useCart(selectTotalItems);
  const totalPrice = useCart(selectTotalPrice);
  const setQuantity = useCart((s) => s.setQuantity);
  const removeItem = useCart((s) => s.removeItem);

  return (
    <Sheet>
      <SheetTrigger
        render={<Button variant="ghost" size="icon" className="relative" aria-label="Open cart" />}
      >
        <ShoppingBag className="size-5" />
        {mounted && totalItems > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-brand text-[10px] font-semibold text-brand-foreground">
            {totalItems}
          </span>
        ) : null}
      </SheetTrigger>

      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="font-display uppercase tracking-wide">Your cart</SheetTitle>
        </SheetHeader>

        {!mounted || items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
            <ShoppingBag className="size-10" />
            <p className="text-sm">Your cart is empty.</p>
          </div>
        ) : (
          <ul className="flex-1 space-y-4 overflow-y-auto px-4">
            {items.map((item) => (
              <li key={item.productId} className="flex gap-3">
                <div className="flex size-16 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Bike className="size-6" />
                </div>
                <div className="flex flex-1 flex-col">
                  <span className="text-sm font-medium leading-tight">{item.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {formatPrice(item.price)}
                  </span>
                  <div className="mt-auto flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-7"
                      onClick={() => setQuantity(item.productId, item.quantity - 1)}
                      aria-label="Decrease quantity"
                    >
                      <Minus className="size-3" />
                    </Button>
                    <span className="w-6 text-center text-sm tabular-nums">{item.quantity}</span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-7"
                      onClick={() => setQuantity(item.productId, item.quantity + 1)}
                      aria-label="Increase quantity"
                    >
                      <Plus className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto size-7 text-muted-foreground"
                      onClick={() => removeItem(item.productId)}
                      aria-label="Remove item"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {mounted && items.length > 0 ? (
          <SheetFooter>
            <div className="flex items-center justify-between text-base font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatPrice(totalPrice)}</span>
            </div>
            <SheetClose
              render={<Link href="/checkout" />}
              className={cn(buttonVariants(), 'w-full font-display uppercase tracking-wide')}
            >
              Checkout
            </SheetClose>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
