'use client';

import { ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCart, type CartItem } from '@/lib/cart-store';

type Props = {
  item: Omit<CartItem, 'quantity'>;
  inStock: boolean;
  className?: string;
};

export function AddToCartButton({ item, inStock, className }: Props) {
  const addItem = useCart((s) => s.addItem);

  return (
    <Button
      className={className}
      disabled={!inStock}
      onClick={() => addItem(item)}
    >
      <ShoppingBag className="size-4" />
      {inStock ? 'Add to cart' : 'Out of stock'}
    </Button>
  );
}
