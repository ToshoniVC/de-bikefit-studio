/**
 * Applies the SQL migrations in ./drizzle to whichever driver is active.
 *
 *   npm run db:migrate
 *
 * DATABASE_URL set  → Neon (neon-http). Both migrations are idempotent, so
 *                     running this against the existing staging database only
 *                     adds the `cms_*` tables and leaves the webshop alone.
 * DATABASE_URL unset → local PGlite in website/.pglite/ (created on demand).
 *
 * Refuses to run against production unless DATABASE_URL is explicitly set.
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

config({ path: '.env.local' });

const MIGRATIONS_FOLDER = './drizzle';

async function main() {
  if (!existsSync(resolve(process.cwd(), MIGRATIONS_FOLDER))) {
    throw new Error(
      `No migrations found at ${MIGRATIONS_FOLDER}. Run \`npm run db:generate\` first.`,
    );
  }

  const url = process.env.DATABASE_URL;

  if (url) {
    const { drizzle } = await import('drizzle-orm/neon-http');
    const { migrate } = await import('drizzle-orm/neon-http/migrator');
    const { neon } = await import('@neondatabase/serverless');

    const host = safeHost(url);
    console.log(`→ driver: neon-http (${host})`);
    const db = drizzle(neon(url));
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log('✓ migrations applied to Neon');
    return;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required in production. Refusing to migrate a PGlite file.');
  }

  const dataDir = process.env.CMS_PGLITE_DIR ?? '.pglite';
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');

  console.log(`→ driver: pglite (${resolve(process.cwd(), dataDir)})`);
  const client = await PGlite.create({ dataDir });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  const tables = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables
     where table_schema = 'public' order by table_name`,
  );
  console.log('✓ migrations applied to PGlite');
  console.log(`  tables: ${tables.rows.map((r) => r.table_name).join(', ')}`);
  await client.close();
}

/** Never print credentials, even on a local run. */
function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'unknown host';
  }
}

main().catch((error) => {
  console.error('✗ migration failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
