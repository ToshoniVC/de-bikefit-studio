import Link from 'next/link';
import { Bike } from 'lucide-react';
import type { Product } from '@/lib/types';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { formatPrice } from '@/lib/format';
import { AddToCartButton } from './add-to-cart-button';

export function ProductCard({ product }: { product: Product }) {
  const inStock = product.availableForSale;

  return (
    <Card className="group overflow-hidden pt-0">
      <Link href={`/shop/${product.slug}`} className="block">
        <div className="relative flex aspect-[4/3] items-center justify-center bg-muted text-muted-foreground">
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.imageUrl}
              alt={product.name}
              className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <Bike className="size-12" />
          )}
          {!inStock ? (
            <span className="absolute left-3 top-3 rounded-full bg-foreground/90 px-2 py-0.5 text-xs font-medium text-background">
              Sold out
            </span>
          ) : null}
          <span className="absolute right-3 top-3 rounded-full bg-background/80 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {product.category}
          </span>
        </div>
      </Link>

      <CardContent className="space-y-1">
        <Link href={`/shop/${product.slug}`}>
          <h3 className="font-display text-lg font-semibold uppercase leading-tight tracking-tight transition-colors group-hover:text-brand">
            {product.name}
          </h3>
        </Link>
        <p className="text-base font-semibold tabular-nums">
          {formatPrice(product.price, product.currencyCode)}
        </p>
      </CardContent>

      <CardFooter>
        <AddToCartButton
          className="w-full font-display uppercase tracking-wide"
          inStock={inStock && Boolean(product.variantId)}
          item={
            product.variantId
              ? {
                  variantId: product.variantId,
                  productId: product.id,
                  slug: product.slug,
                  name: product.name,
                  price: product.price,
                  imageUrl: product.imageUrl,
                }
              : null
          }
        />
      </CardFooter>
    </Card>
  );
}
