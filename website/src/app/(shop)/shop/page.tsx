import type { Metadata } from 'next';
import Link from 'next/link';
import { ProductCard } from '@/components/shop/product-card';
import { getActiveProducts } from '@/db/queries';
import { shopCategories } from '@/lib/nav';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Shop',
  description: 'Road bikes, gravel bikes and accessories from Qarakter.',
};

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const all = await getActiveProducts();
  const products = category ? all.filter((p) => p.category === category) : all;

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <header className="mb-8">
        <h1 className="font-display text-4xl font-extrabold uppercase tracking-tight">Shop</h1>
        <p className="mt-1 text-muted-foreground">
          {products.length} {products.length === 1 ? 'product' : 'products'}
          {category ? ` in ${category}` : ''}
        </p>
      </header>

      <nav className="mb-8 flex flex-wrap gap-2 font-display text-sm font-semibold uppercase tracking-wide">
        <FilterPill href="/shop" active={!category}>
          All
        </FilterPill>
        {shopCategories.map((cat) => (
          <FilterPill
            key={cat.href}
            href={cat.href}
            active={category === new URL(cat.href, 'http://x').searchParams.get('category')}
          >
            {cat.title}
          </FilterPill>
        ))}
      </nav>

      {products.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">No products in this category yet.</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterPill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'rounded-full border px-4 py-1.5 transition-colors',
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground',
      )}
    >
      {children}
    </Link>
  );
}
