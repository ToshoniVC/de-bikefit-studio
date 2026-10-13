import { connection } from 'next/server';

/**
 * Root of the whole `/admin` tree: renders its children unchanged.
 *
 * Its one job is `await connection()`, which makes every admin route render
 * per request, `/admin/logout` included (it would otherwise be prerendered at
 * build time). The admin's Content-Security-Policy is nonce-based
 * (`src/middleware.ts`, `docs/admin-csp.md`), and Next.js can only stamp the
 * request's nonce on its scripts while rendering that request: a page built
 * ahead of time would carry no nonce, and under the policy none of its
 * scripts would run. `connection()` is the documented Next 16 way to say
 * "wait for a real request"; no `force-dynamic` is needed.
 *
 * Auth stays where it was: `(dashboard)/layout.tsx` is the rendering gate, and
 * `login`, `mfa`, `password` and `logout` sit outside that group.
 */
export default async function AdminRootLayout({ children }: { children: React.ReactNode }) {
  await connection();
  return children;
}
