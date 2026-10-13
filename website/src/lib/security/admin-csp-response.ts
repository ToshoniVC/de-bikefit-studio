import { NextResponse, type NextRequest } from 'next/server';

import {
  ADMIN_CSP_MODE,
  adminCspHeaderName,
  buildAdminCsp,
  createCspNonce,
  CSP_HEADER_NAMES,
  isAdminCspPath,
  NONCE_HEADER,
  type AdminCspMode,
} from './admin-csp';

/**
 * The middleware half of the admin CSP (`./admin-csp.ts`), kept out of
 * `src/middleware.ts` so it can be unit-tested without Clerk.
 *
 * For an admin path every call draws a fresh nonce. `nextWithAdminCsp()`
 * forwards it to the app as two request headers, the policy header (which is
 * where Next.js reads the nonce while rendering; it accepts the report-only
 * name too) and `x-nonce`, and puts the policy on the response. Client-sent
 * copies of those headers are dropped first, so a request can never choose
 * its own nonce. Every other path is left alone.
 *
 * Next.js only stamps the nonce on pages rendered per request; the whole
 * `/admin` tree is made dynamic by `src/app/admin/layout.tsx`.
 */

export type AdminCspOptions = {
  /** `true` under `next dev` only (see `buildAdminCsp()`). */
  isDev: boolean;
  /** Defaults to `ADMIN_CSP_MODE`; tests pass it explicitly. */
  mode?: AdminCspMode;
};

type AdminCsp = { header: string; policy: string; nonce: string };

/** A fresh nonce and the policy that carries it, or null when the path is not the admin's. */
function adminCspFor(
  req: NextRequest,
  { isDev, mode = ADMIN_CSP_MODE }: AdminCspOptions,
): AdminCsp | null {
  if (!isAdminCspPath(req.nextUrl.pathname)) return null;
  const nonce = createCspNonce();
  return { header: adminCspHeaderName(mode), policy: buildAdminCsp({ nonce, isDev, mode }), nonce };
}

/**
 * For an admin path: continue to the route with the nonce and policy forwarded
 * as request headers, and the policy on the response. Null for any other path,
 * so the caller's pass-through stays exactly as it was.
 */
export function nextWithAdminCsp(req: NextRequest, options: AdminCspOptions): NextResponse | null {
  const csp = adminCspFor(req, options);
  if (!csp) return null;

  // `request.headers` replaces the request's header set wholesale (Next
  // re-adds its own routing headers), so start from a full copy.
  const requestHeaders = new Headers(req.headers);
  for (const name of [...CSP_HEADER_NAMES, NONCE_HEADER]) requestHeaders.delete(name);
  requestHeaders.set(NONCE_HEADER, csp.nonce);
  requestHeaders.set(csp.header, csp.policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(csp.header, csp.policy);
  return response;
}

/**
 * Adds the policy header to a response the middleware built itself (the
 * sign-in redirect) when `req` is on an admin path; returns `response` either
 * way. A redirect renders nothing, so this only keeps the header on every
 * `/admin` response (`curl -sI <origin>/admin` shows it).
 */
export function withAdminCspHeader(
  req: NextRequest,
  response: NextResponse,
  options: AdminCspOptions,
): NextResponse {
  const csp = adminCspFor(req, options);
  if (csp) response.headers.set(csp.header, csp.policy);
  return response;
}
