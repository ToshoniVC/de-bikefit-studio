import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Unit tests for pure modules (CLAUDE.md §5): `src/**\/*.test.ts` next to the
 * module, Node environment, no DOM, no database, no network.
 *
 * `server-only` is aliased to an empty stub so a server module can be imported
 * when only its pure helpers are under test. Import `describe`/`it`/`expect`
 * from `vitest` explicitly; globals are off.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./src/test/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
