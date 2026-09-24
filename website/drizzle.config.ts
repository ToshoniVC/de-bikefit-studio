import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Next.js reads .env.local; load the same file for Drizzle Kit CLI commands.
config({ path: '.env.local' });

/**
 * `drizzle-kit generate` only diffs the TypeScript schema against the snapshots
 * in ./drizzle/meta — it never connects. Fall back to a non-routable placeholder
 * so generating migrations works without DATABASE_URL. `push`/`studio` still
 * need a real URL and will fail loudly against the placeholder.
 */
const url = process.env.DATABASE_URL ?? 'postgres://drizzle-kit:generate-only@127.0.0.1:5432/unset';

export default defineConfig({
  // Webshop schema (unchanged) + CMS schema. Both must be listed so the
  // snapshot stays complete and generated migrations stay additive.
  schema: ['./src/db/schema.ts', './src/db/cms-schema.ts'],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
