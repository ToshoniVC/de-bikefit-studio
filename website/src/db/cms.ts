// NOTE: deliberately *not* marked `server-only` — `scripts/*.mts` (migrate,
// bootstrap, seed, self-test) import this module from plain Node. The
// server-only boundary is enforced one level up, in `src/lib/cms/*`.
import { drizzle as drizzleNeon, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { env, isProduction } from '@/lib/env';
import * as webshopSchema from './schema';
import * as cmsSchema from './cms-schema';

/**
 * CMS database client.
 *
 * Two drivers, one API:
 *
 *  - **neon-http** whenever `DATABASE_URL` is set (staging/production on
 *    Vercel). Identical to what `src/db/index.ts` uses for the webshop, so the
 *    two never fight over connections.
 *  - **PGlite** when `DATABASE_URL` is absent *and* we are not in production.
 *    Postgres compiled to WASM, persisted in `website/.pglite/` (gitignored),
 *    so the whole CMS — migrations, auth, publishing — runs locally with zero
 *    credentials. In production a missing `DATABASE_URL` is a hard error.
 *
 * The webshop's sample-data fallback in `src/db/queries.ts` is untouched: it
 * still keys off `src/db/index.ts`'s `db` being null.
 *
 * `getCmsDb()` is async because PGlite is imported dynamically — that keeps the
 * WASM bundle out of any build that does not actually use it (and out of the
 * middleware/edge graph entirely).
 */

export const schema = { ...webshopSchema, ...cmsSchema };
export type CmsSchema = typeof schema;

/**
 * Both drivers expose the same Drizzle query-builder surface; we present the
 * neon-http type so callers get one concrete type instead of a union.
 *
 * Caveat: `db.transaction()` is a real transaction on PGlite but only a batched
 * request on neon-http (the HTTP driver cannot hold a session). Never rely on
 * rollback semantics in code that also runs on Neon.
 */
export type CmsDatabase = NeonHttpDatabase<CmsSchema>;

export type CmsDriver = 'neon-http' | 'pglite';

/**
 * Where the local PGlite database is persisted, relative to `website/`.
 * Read lazily (`env` reads at call time) so scripts can call `dotenv.config()`
 * before the first use.
 */
export function pgliteDataDir(): string {
  return env.CMS_PGLITE_DIR ?? '.pglite';
}

/** A production runtime (not `vercel dev`), where PGlite is never acceptable. */
function requiresNeon() {
  return isProduction() && env.VERCEL_ENV !== 'development';
}

/** Which driver `getCmsDb()` will use, without initialising anything. */
export function cmsDriver(): CmsDriver {
  return env.DATABASE_URL ? 'neon-http' : 'pglite';
}

type CmsGlobal = {
  db?: Promise<CmsDatabase>;
  driver?: CmsDriver;
};

// Cached on globalThis so Next's dev-server HMR does not open a second PGlite
// instance on the same data directory (which would fail to acquire its lock).
const globalForCms = globalThis as unknown as { __bikefitCms?: CmsGlobal };
const cache: CmsGlobal = (globalForCms.__bikefitCms ??= {});

async function createNeonDb(url: string): Promise<CmsDatabase> {
  return drizzleNeon(neon(url), { schema });
}

async function createPgliteDb(): Promise<CmsDatabase> {
  if (requiresNeon()) {
    throw new Error(
      'DATABASE_URL is required in production. PGlite is a local-development driver only.',
    );
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle: drizzlePglite } = await import('drizzle-orm/pglite');

  const client = await PGlite.create({ dataDir: pgliteDataDir() });
  const db = drizzlePglite(client, { schema });

  if (env.CMS_PGLITE_AUTO_MIGRATE !== 'false') {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    await migrate(db, { migrationsFolder: './drizzle' });
  }

  // Structurally identical query-builder surface; see `CmsDatabase` above.
  return db as unknown as CmsDatabase;
}

/**
 * Returns the shared Drizzle instance for the active driver.
 * Safe to call from server components, route handlers and server actions.
 * Never call it from middleware/proxy — that runs on the edge runtime.
 */
export function getCmsDb(): Promise<CmsDatabase> {
  if (!cache.db) {
    const url = env.DATABASE_URL;
    cache.driver = url ? 'neon-http' : 'pglite';
    cache.db = (url ? createNeonDb(url) : createPgliteDb()).catch((error) => {
      // Do not cache a rejected promise: a transient failure would otherwise
      // poison every later request for the lifetime of the process.
      cache.db = undefined;
      throw error;
    });
  }
  return cache.db;
}

/** Test/script helper: drop the cached instance so the next call reconnects. */
export function resetCmsDb() {
  cache.db = undefined;
  cache.driver = undefined;
}

export { cmsSchema, webshopSchema };
