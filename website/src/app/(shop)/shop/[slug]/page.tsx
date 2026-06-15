import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Bike, ChevronLeft } from 'lucide-react';
import { AddToCartButton } from '@/components/shop/add-to-cart-button';
import { getProductBySlug, getActiveProducts } from '@/db/queries';
import { formatPrice } from '@/lib/format';

export async function generateStaticParams() {
  const products = await getActiveProducts();
  return products.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: 'Product not found' };
  return { title: product.name, description: product.description };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const inStock = product.stockCount > 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <Link
        href="/shop"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> Back to shop
      </Link>

      <div className="grid gap-10 md:grid-cols-2">
        <div className="flex aspect-square items-center justify-center rounded-xl bg-muted text-muted-foreground">
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.imageUrl}
              alt={product.name}
              className="size-full rounded-xl object-cover"
            />
          ) : (
            <Bike className="size-24" />
          )}
        </div>

        <div className="flex flex-col gap-5">
          <div>
            <p className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-brand">
              {product.category}
            </p>
            <h1 className="mt-1 font-display text-4xl font-extrabold uppercase leading-tight tracking-tight">
              {product.name}
            </h1>
          </div>

          <p className="text-2xl font-semibold tabular-nums">{formatPrice(product.price)}</p>

          <p className="text-muted-foreground">{product.description}</p>

          <p className="text-sm">
            {inStock ? (
              <span className="text-foreground">
                In stock — {product.stockCount} available
              </span>
            ) : (
              <span className="text-muted-foreground">Currently sold out</span>
            )}
          </p>

          <AddToCartButton
            className="font-display uppercase tracking-wide sm:w-64"
            inStock={inStock}
            item={{
              productId: product.id,
              slug: product.slug,
              name: product.name,
              price: product.price,
              imageUrl: product.imageUrl,
            }}
          />
        </div>
      </div>
    </div>
  );
}
