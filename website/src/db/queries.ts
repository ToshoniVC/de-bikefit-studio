import 'server-only';
import { eq, desc } from 'drizzle-orm';
import { db } from './index';
import { products, type Product } from './schema';
import { sampleProducts } from '@/lib/sample-products';

/**
 * Product data access. Every helper is an async server function so it can be
 * called directly from React Server Components (no API layer needed).
 *
 * When DATABASE_URL is not yet configured, helpers fall back to the in-repo
 * `sampleProducts` fixture so the catalog still renders during development.
 * Remove the fallbacks (or keep them as seed data) once Neon is live.
 */

export async function getActiveProducts(): Promise<Product[]> {
  if (!db) return sampleProducts;
  return db
    .select()
    .from(products)
    .where(eq(products.isActive, true))
    .orderBy(desc(products.createdAt));
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  if (!db) {
    return sampleProducts.find((p) => p.slug === slug) ?? null;
  }
  const rows = await db.select().from(products).where(eq(products.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function getProductsByCategory(category: string): Promise<Product[]> {
  if (!db) {
    return sampleProducts.filter((p) => p.category === category);
  }
  return db
    .select()
    .from(products)
    .where(eq(products.category, category))
    .orderBy(desc(products.createdAt));
}
