import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * PGlite ships a WASM build of Postgres and must never be traced or bundled
   * by Turbopack — it is loaded with a runtime `import()` in `src/db/cms.ts`
   * and only ever runs in the Node.js server runtime. Listing it here keeps it
   * external (and therefore out of every edge/client bundle).
   */
  serverExternalPackages: ['@electric-sql/pglite'],
};

export default nextConfig;
