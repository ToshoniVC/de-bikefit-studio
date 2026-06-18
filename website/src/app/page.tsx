import Link from 'next/link';
import { ArrowRight, Wrench, Truck, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProductCard } from '@/components/shop/product-card';
import { getProducts } from '@/lib/shopify';
import { shopCategories } from '@/lib/nav';

export default async function HomePage() {
  const products = await getProducts();
  const featured = products.slice(0, 3);

  return (
    <>
      {/* Hero */}
      <section className="bg-foreground text-background">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-24 sm:px-6 md:py-32">
          <p className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-brand">
            Boutique bike store
          </p>
          <h1 className="max-w-3xl font-display text-5xl font-extrabold uppercase leading-[0.95] tracking-tight md:text-7xl">
            Bikes with character.
          </h1>
          <p className="max-w-xl text-lg text-background/70">
            Hand-picked road and gravel machines, built and serviced by people who actually ride.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              render={<Link href="/shop" />}
              size="lg"
              className="font-display uppercase tracking-wide"
            >
              Shop bikes <ArrowRight className="size-4" />
            </Button>
            <Button
              render={<Link href="/blog" />}
              size="lg"
              variant="outline"
              className="border-background/30 bg-transparent font-display uppercase tracking-wide text-background hover:bg-background hover:text-foreground"
            >
              Read the journal
            </Button>
          </div>
        </div>
      </section>

      {/* Value props */}
      <section className="border-b">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-3">
          <ValueProp
            icon={<Wrench className="size-6" />}
            title="Expert build"
            body="Every bike assembled and safety-checked by our mechanics before it ships."
          />
          <ValueProp
            icon={<Truck className="size-6" />}
            title="Free EU shipping"
            body="On all complete bikes. Bancontact and iDEAL supported at checkout."
          />
          <ValueProp
            icon={<ShieldCheck className="size-6" />}
            title="2-year warranty"
            body="Frames and components covered, with local support when you need it."
          />
        </div>
      </section>

      {/* Featured */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="mb-8 flex items-end justify-between">
          <h2 className="font-display text-3xl font-extrabold uppercase tracking-tight">Featured</h2>
          <Link
            href="/shop"
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            View all →
          </Link>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>

      {/* Categories */}
      <section className="border-t bg-muted/40">
        <div className="mx-auto grid max-w-7xl gap-4 px-4 py-12 sm:grid-cols-3 sm:px-6">
          {shopCategories.map((cat) => (
            <Link
              key={cat.href}
              href={cat.href}
              className="group flex items-center justify-between rounded-lg border bg-background p-6 transition-colors hover:border-foreground"
            >
              <span className="font-display text-xl font-semibold uppercase tracking-tight">
                {cat.title}
              </span>
              <ArrowRight className="size-5 transition-transform group-hover:translate-x-1" />
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

function ValueProp({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
        {icon}
      </div>
      <div>
        <h3 className="font-display text-lg font-semibold uppercase tracking-tight">{title}</h3>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
