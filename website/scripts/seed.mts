// Seed / refresh the products table from the in-repo sample catalog.
// Idempotent: re-running upserts by id. Run with:
//   node --env-file=.env.local scripts/seed.mts
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { products } from '../src/db/schema.ts';
import { sampleProducts } from '../src/lib/sample-products.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set (use: node --env-file=.env.local scripts/seed.mts)');
  process.exit(1);
}

const db = drizzle(neon(url));

let count = 0;
for (const product of sampleProducts) {
  await db
    .insert(products)
    .values(product)
    .onConflictDoUpdate({
      target: products.id,
      set: {
        slug: product.slug,
        name: product.name,
        description: product.description,
        price: product.price,
        stockCount: product.stockCount,
        category: product.category,
        imageUrl: product.imageUrl,
        isActive: product.isActive,
      },
    });
  count++;
}

console.log(`Seeded ${count} products ✓`);
process.exit(0);
