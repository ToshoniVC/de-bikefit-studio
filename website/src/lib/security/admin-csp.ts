/**
 * Content-Security-Policy for the CMS admin (`/admin` and everything below
 * it), built around a fresh nonce per request.
 *
 * Pure and runtime-neutral on purpose: `src/middleware.ts` runs on the edge
 * runtime, so this module uses Web APIs only (Web Crypto, `btoa`), imports no
 * `server-only` and no Node built-ins, and reads no environment variables (the
 * caller passes `isDev`). The request/response wiring lives in
 * `./admin-csp-response.ts`; the reasoning behind every directive, the staging
 * browser check and the rollback live in `docs/admin-csp.md`.
 *
 * The public site deliberately has no CSP: its pages render statically where
 * they can and it runs the consent-gated GA4 tag; both would need a policy of
 * their own, and nonces force dynamic rendering (`next.config.ts`).
 */

export type AdminCspMode = 'report-only' | 'enforce';

/**
 * THE switch, and the only line to change. `'report-only'` sends the policy as
 * `Content-Security-Policy-Report-Only`: the browser reports every violation
 * in the console and blocks nothing. Change it to `'enforce'` only after the
 * staging browser check in `docs/admin-csp.md` came back clean; change it back
 * to roll back.
 */
export const ADMIN_CSP_MODE: AdminCspMode = 'report-only';

/**
 * Request header that carries the nonce to the app. Next itself takes the
 * nonce from the forwarded policy header; this copy is for a server component
 * that has to hand it to a third-party script (`(await headers()).get('x-nonce')`).
 */
export const NONCE_HEADER = 'x-nonce';

/** Both policy header names, lower-case as `Headers` stores them. */
export const CSP_HEADER_NAMES = [
  'content-security-policy',
  'content-security-policy-report-only',
] as const;

export type CspHeaderName = 'Content-Security-Policy' | 'Content-Security-Policy-Report-Only';

/** The header the policy travels in for `mode`. */
export function adminCspHeaderName(mode: AdminCspMode = ADMIN_CSP_MODE): CspHeaderName {
  return mode === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';
}

/** `/admin` and `/admin/…` only: not `/administrator`, not `/api/…`. */
export function isAdminCspPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

/** 128 bits, the minimum the CSP specification asks of a nonce. */
const NONCE_BYTES = 16;

/** Standard base64 as `btoa` writes it; anything else could smuggle `;` or `'` into the header. */
const NONCE_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/** A fresh, unguessable nonce: 16 random bytes from Web Crypto, base64-encoded. */
export function createCspNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  return btoa(String.fromCharCode(...bytes));
}

const SELF = "'self'";
const NONE = "'none'";

/**
 * The admin policy as one header value. Production:
 *
 * `default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic';
 * style-src 'self' 'nonce-…'; style-src-attr 'unsafe-inline';
 * img-src 'self' blob: data:; font-src 'self'; connect-src 'self';
 * object-src 'none'; base-uri 'none'; form-action 'self';
 * frame-ancestors 'none'; frame-src 'none'`
 *
 * plus `upgrade-insecure-requests` once enforced (browsers ignore it in a
 * report-only policy and warn). Under `next dev`, as the Next.js CSP guide
 * prescribes: `'unsafe-eval'` for React's debugging, `style-src 'self'
 * 'unsafe-inline'` (no nonce, it would disable `'unsafe-inline'`) for the dev
 * overlay and hot-reloaded CSS, and `ws:` for the hot-reload socket.
 *
 * `style-src-attr 'unsafe-inline'` is the one relaxation in production: React
 * renders `style` props as attributes in server HTML (the services colour
 * swatches, `next/image`'s `color:transparent`), and a nonce cannot cover an
 * attribute. Scripts stay strictly nonce-only; see `docs/admin-csp.md`.
 */
export function buildAdminCsp({
  nonce,
  isDev,
  mode = ADMIN_CSP_MODE,
}: {
  nonce: string;
  isDev: boolean;
  mode?: AdminCspMode;
}): string {
  if (!NONCE_PATTERN.test(nonce)) throw new Error('[csp] nonce must be standard base64');

  const directives: string[][] = [
    ['default-src', SELF],
    [
      'script-src',
      SELF,
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    ['style-src', SELF, isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`],
    ['style-src-attr', "'unsafe-inline'"],
    ['img-src', SELF, 'blob:', 'data:'],
    ['font-src', SELF],
    ['connect-src', SELF, ...(isDev ? ['ws:'] : [])],
    ['object-src', NONE],
    ['base-uri', NONE],
    ['form-action', SELF],
    ['frame-ancestors', NONE],
    ['frame-src', NONE],
  ];
  if (mode === 'enforce' && !isDev) directives.push(['upgrade-insecure-requests']);

  return directives.map((parts) => parts.join(' ')).join('; ');
}
