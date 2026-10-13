import { getScriptNonceFromHeader } from 'next/dist/server/app-render/get-script-nonce-from-header';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_CSP_MODE,
  adminCspHeaderName,
  buildAdminCsp,
  createCspNonce,
  isAdminCspPath,
  type AdminCspMode,
} from './admin-csp';

const NONCE = 'AAECAwQFBgcICQoLDA0ODw==';
const MODES: AdminCspMode[] = ['report-only', 'enforce'];

/** `{ 'script-src': ["'self'", …], … }` from a policy string. */
function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split(';').map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

describe('buildAdminCsp (production)', () => {
  it('is exactly the admin policy in report-only mode', () => {
    expect(buildAdminCsp({ nonce: NONCE, isDev: false, mode: 'report-only' })).toBe(
      "default-src 'self'; " +
        `script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'; ` +
        `style-src 'self' 'nonce-${NONCE}'; ` +
        "style-src-attr 'unsafe-inline'; " +
        "img-src 'self' blob: data:; " +
        "font-src 'self'; " +
        "connect-src 'self'; " +
        "object-src 'none'; " +
        "base-uri 'none'; " +
        "form-action 'self'; " +
        "frame-ancestors 'none'; " +
        "frame-src 'none'",
    );
  });

  it('adds upgrade-insecure-requests only when enforced', () => {
    const enforced = buildAdminCsp({ nonce: NONCE, isDev: false, mode: 'enforce' });
    const reportOnly = buildAdminCsp({ nonce: NONCE, isDev: false, mode: 'report-only' });
    expect(enforced).toBe(`${reportOnly}; upgrade-insecure-requests`);
    expect(reportOnly).not.toContain('upgrade-insecure-requests');
  });

  it('puts the nonce in script-src and style-src', () => {
    for (const mode of MODES) {
      const policy = directives(buildAdminCsp({ nonce: NONCE, isDev: false, mode }));
      expect(policy['script-src']).toContain(`'nonce-${NONCE}'`);
      expect(policy['style-src']).toContain(`'nonce-${NONCE}'`);
      expect(policy['style-src']).not.toContain("'unsafe-inline'");
      expect(policy['script-src']).not.toContain("'unsafe-eval'");
    }
  });

  it('is the nonce Next.js extracts from the forwarded header', () => {
    // The exact parser Next 16 runs on the request's policy header while
    // rendering; if it stops finding our nonce, scripts lose theirs.
    for (const mode of MODES) {
      expect(getScriptNonceFromHeader(buildAdminCsp({ nonce: NONCE, isDev: false, mode }))).toBe(
        NONCE,
      );
    }
  });
});

describe('buildAdminCsp (development)', () => {
  it('adds unsafe-eval, relaxes style-src to unsafe-inline and allows the HMR socket', () => {
    const policy = directives(buildAdminCsp({ nonce: NONCE, isDev: true, mode: 'report-only' }));
    expect(policy['script-src']).toEqual([
      "'self'",
      `'nonce-${NONCE}'`,
      "'strict-dynamic'",
      "'unsafe-eval'",
    ]);
    // A nonce next to 'unsafe-inline' would switch 'unsafe-inline' off.
    expect(policy['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy['connect-src']).toEqual(["'self'", 'ws:']);
  });

  it('never upgrades insecure requests (localhost is plain http)', () => {
    for (const mode of MODES) {
      expect(buildAdminCsp({ nonce: NONCE, isDev: true, mode })).not.toContain(
        'upgrade-insecure-requests',
      );
    }
  });
});

describe('buildAdminCsp (every variant)', () => {
  const variants = MODES.flatMap((mode) =>
    [false, true].map((isDev) => buildAdminCsp({ nonce: NONCE, isDev, mode })),
  );

  it("never allows inline scripts: no 'unsafe-inline' in script-src", () => {
    for (const policy of variants) {
      expect(directives(policy)['script-src']).not.toContain("'unsafe-inline'");
    }
  });

  it('names no Google or other third-party host, and no wildcard', () => {
    for (const policy of variants) {
      expect(policy).not.toMatch(/googletagmanager|google-analytics|google\.com|gstatic/i);
      expect(policy).not.toMatch(/https?:|\*/);
    }
  });

  it('locks down objects, base, framing and form targets', () => {
    for (const policy of variants) {
      const parsed = directives(policy);
      expect(parsed['object-src']).toEqual(["'none'"]);
      expect(parsed['base-uri']).toEqual(["'none'"]);
      expect(parsed['frame-ancestors']).toEqual(["'none'"]);
      expect(parsed['frame-src']).toEqual(["'none'"]);
      expect(parsed['form-action']).toEqual(["'self'"]);
      expect(parsed['default-src']).toEqual(["'self'"]);
      expect(parsed['style-src-attr']).toEqual(["'unsafe-inline'"]);
    }
  });

  it('defaults to ADMIN_CSP_MODE', () => {
    for (const isDev of [false, true]) {
      expect(buildAdminCsp({ nonce: NONCE, isDev })).toBe(
        buildAdminCsp({ nonce: NONCE, isDev, mode: ADMIN_CSP_MODE }),
      );
    }
  });

  it('refuses a nonce that is not plain base64', () => {
    for (const nonce of [
      '',
      'abc def',
      "abc'",
      'abc;',
      "x' 'unsafe-inline",
      'abc\r\nSet-Cookie: a',
    ]) {
      expect(() => buildAdminCsp({ nonce, isDev: false })).toThrow();
    }
  });
});

describe('createCspNonce', () => {
  it('is standard base64 of at least 128 bits', () => {
    const nonce = createCspNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(atob(nonce).length).toBeGreaterThanOrEqual(16);
    // Accepted as-is by the policy builder.
    expect(() => buildAdminCsp({ nonce, isDev: false })).not.toThrow();
  });

  it('is unique across calls', () => {
    const nonces = new Set(Array.from({ length: 1000 }, () => createCspNonce()));
    expect(nonces.size).toBe(1000);
  });
});

describe('isAdminCspPath', () => {
  it('matches /admin and everything below it', () => {
    for (const path of [
      '/admin',
      '/admin/',
      '/admin/login',
      '/admin/mfa',
      '/admin/logout',
      '/admin/pages/123',
    ]) {
      expect(isAdminCspPath(path), path).toBe(true);
    }
  });

  it('does not match look-alikes, API routes or the public site', () => {
    for (const path of [
      '',
      '/',
      '/afspraak',
      '/administrator',
      '/admins',
      '/admin-login',
      '/Admin',
      '/api/admin',
      '/api/cms/media/x',
      '/nl/admin',
    ]) {
      expect(isAdminCspPath(path), path).toBe(false);
    }
  });
});

describe('adminCspHeaderName', () => {
  it('maps each mode to its header', () => {
    expect(adminCspHeaderName('report-only')).toBe('Content-Security-Policy-Report-Only');
    expect(adminCspHeaderName('enforce')).toBe('Content-Security-Policy');
  });

  it('defaults to ADMIN_CSP_MODE', () => {
    expect(adminCspHeaderName()).toBe(adminCspHeaderName(ADMIN_CSP_MODE));
  });
});
