import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * PGlite ships a WASM build of Postgres and must never be traced or bundled
   * by Turbopack — it is loaded with a runtime `import()` in `src/db/cms.ts`
   * and only ever runs in the Node.js server runtime. Listing it here keeps it
   * external (and therefore out of every edge/client bundle).
   */
  serverExternalPackages: ['@electric-sql/pglite'],

  experimental: {
    serverActions: {
      /**
       * Media uploads travel through a server action. Next's default body
       * limit is 1 MB; the upload limit is 5 MB (`UPLOAD_MAX_BYTES` in
       * `src/lib/cms/actions/media-limits.ts`), plus multipart overhead.
       * Raise both together, and keep this under `repo.createMedia()`'s 8 MB.
       */
      bodySizeLimit: '6mb',
    },
  },

  /**
   * Minimal security headers (GDPR pass, 24 Sep 2026; see §11.4 "Security
   * headers", part of §11 "GDPR en bewaartermijnen", in
   * docs/booking-runbook.md).
   *
   * No Content-Security-Policy here. The admin (`/admin` and below) gets a
   * per-request nonce CSP from `src/middleware.ts`
   * (`src/lib/security/admin-csp.ts`, `docs/admin-csp.md`): a nonce cannot
   * come from this static header list. The public site still has no CSP: it
   * runs the consent-gated GA4 tag and prerenders pages, and a nonce policy
   * would make every page dynamic; out of scope for now. X-Frame-Options
   * stays on the admin for browsers without `frame-ancestors`, and because
   * the CSP is report-only for now.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
        ],
      },
      {
        // The admin is never framed: no clickjacking of the CMS.
        source: '/admin/:path*',
        headers: [{ key: 'X-Frame-Options', value: 'DENY' }],
      },
    ];
  },
};

export default nextConfig;
