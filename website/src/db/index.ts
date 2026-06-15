import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';

/**
 * Neon serverless Postgres client over the HTTP driver.
 *
 * The HTTP driver (neon-http) issues each query as a stateless fetch, so it
 * never holds a Postgres connection open. That is exactly what we want on
 * Vercel's serverless/edge runtime, where long-lived pools get exhausted fast.
 *
 * `db` is null until DATABASE_URL is set, which keeps the app runnable during
 * early development before Neon is provisioned. Data-access helpers in
 * `src/db/queries.ts` degrade gracefully when it is null.
 */
function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return drizzle(neon(url), { schema });
}

export const db = createDb();

/** Narrowing helper for code paths that require a live database. */
export function requireDb() {
  if (!db) {
    throw new Error(
      'DATABASE_URL is not set. Provision a Neon database and add it to .env.local.',
    );
  }
  return db;
}
