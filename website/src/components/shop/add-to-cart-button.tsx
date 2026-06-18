'use client';

import { ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCart, type CartItem } from '@/lib/cart-store';

type Props = {
  /** Null when the product has no purchasable variant. */
  item: Omit<CartItem, 'quantity'> | null;
  inStock: boolean;
  className?: string;
};

export function AddToCartButton({ item, inStock, className }: Props) {
  const addItem = useCart((s) => s.addItem);
  const disabled = !inStock || !item;

  return (
    <Button
      className={className}
      disabled={disabled}
      onClick={() => item && addItem(item)}
    >
      <ShoppingBag className="size-4" />
      {inStock ? 'Add to cart' : 'Out of stock'}
    </Button>
  );
}
