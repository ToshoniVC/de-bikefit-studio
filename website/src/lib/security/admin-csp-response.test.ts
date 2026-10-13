import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';

import { nextWithAdminCsp, withAdminCspHeader, type AdminCspOptions } from './admin-csp-response';

const REPORT_ONLY: AdminCspOptions = { isDev: false, mode: 'report-only' };
const ENFORCE: AdminCspOptions = { isDev: false, mode: 'enforce' };

function request(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://x.test${path}`, { headers });
}

/** `nextWithAdminCsp()` for a path that must be an admin path. */
function adminNext(req: NextRequest, options: AdminCspOptions): NextResponse {
  const response = nextWithAdminCsp(req, options);
  if (!response) throw new Error(`expected a response for ${req.nextUrl.pathname}`);
  return response;
}

/** The nonce named in the policy's script-src. */
function policyNonce(policy: string | null): string | undefined {
  return policy?.match(/script-src [^;]*'nonce-([A-Za-z0-9+/]+={0,2})'/)?.[1];
}

/** Header names Next will hand to the app (`NextResponse.next({ request })` encoding). */
function forwardedNames(response: NextResponse): string[] {
  return (response.headers.get('x-middleware-override-headers') ?? '').split(',');
}

function forwarded(response: NextResponse, name: string): string | null {
  return response.headers.get(`x-middleware-request-${name}`);
}

describe('nextWithAdminCsp on admin paths', () => {
  it('continues with the policy on the response and the nonce forwarded to the app', () => {
    const response = adminNext(request('/admin/login'), REPORT_ONLY);

    expect(response.headers.get('x-middleware-next')).toBe('1');

    const policy = response.headers.get('content-security-policy-report-only');
    expect(policy).toMatch(/^default-src 'self'; script-src 'self' 'nonce-/);
    expect(response.headers.get('content-security-policy')).toBeNull();

    const nonce = policyNonce(policy);
    expect(nonce).toBeDefined();
    expect(forwarded(response, 'x-nonce')).toBe(nonce);
    expect(forwarded(response, 'content-security-policy-report-only')).toBe(policy);
    expect(forwardedNames(response)).toEqual(
      expect.arrayContaining(['x-nonce', 'content-security-policy-report-only']),
    );
  });

  it('keeps every other request header', () => {
    const response = adminNext(
      request('/admin/pages/abc', { cookie: 'cms_session=s', 'user-agent': 'vitest' }),
      REPORT_ONLY,
    );
    expect(forwardedNames(response)).toEqual(expect.arrayContaining(['cookie', 'user-agent']));
    expect(forwarded(response, 'cookie')).toBe('cms_session=s');
    expect(forwarded(response, 'user-agent')).toBe('vitest');
  });

  it('draws a fresh nonce for every request', () => {
    const first = adminNext(request('/admin'), REPORT_ONLY);
    const second = adminNext(request('/admin'), REPORT_ONLY);
    const a = forwarded(first, 'x-nonce');
    const b = forwarded(second, 'x-nonce');
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
    expect(first.headers.get('content-security-policy-report-only')).not.toBe(
      second.headers.get('content-security-policy-report-only'),
    );
  });

  it('overwrites a nonce or policy the client sent', () => {
    const response = adminNext(
      request('/admin/login', {
        'x-nonce': 'attacker',
        'content-security-policy': "script-src 'nonce-attacker'",
        'content-security-policy-report-only': "script-src 'nonce-attacker'",
      }),
      REPORT_ONLY,
    );

    const policy = response.headers.get('content-security-policy-report-only');
    const nonce = policyNonce(policy);
    expect(nonce).not.toBe('attacker');
    expect(forwarded(response, 'x-nonce')).toBe(nonce);
    expect(forwarded(response, 'content-security-policy-report-only')).toBe(policy);
    // Not forwarded at all, so Next cannot prefer it over ours.
    expect(forwarded(response, 'content-security-policy')).toBeNull();
    expect(forwardedNames(response)).not.toContain('content-security-policy');
  });

  it('uses Content-Security-Policy, with upgrade-insecure-requests, when enforced', () => {
    const response = adminNext(
      request('/admin/settings', { 'content-security-policy-report-only': 'x' }),
      ENFORCE,
    );

    const policy = response.headers.get('content-security-policy');
    expect(policy).toMatch(/; upgrade-insecure-requests$/);
    expect(response.headers.get('content-security-policy-report-only')).toBeNull();
    expect(forwarded(response, 'content-security-policy')).toBe(policy);
    expect(forwarded(response, 'content-security-policy-report-only')).toBeNull();
    expect(forwarded(response, 'x-nonce')).toBe(policyNonce(policy));
  });

  it('uses the development policy under next dev', () => {
    const response = adminNext(request('/admin'), { isDev: true, mode: 'report-only' });
    expect(response.headers.get('content-security-policy-report-only')).toContain("'unsafe-eval'");
  });
});

describe('nextWithAdminCsp on other paths', () => {
  it('returns null, so the caller passes the request through untouched', () => {
    for (const path of ['/', '/afspraak', '/api/cms/media/x', '/administrator', '/shop']) {
      for (const options of [REPORT_ONLY, ENFORCE]) {
        expect(nextWithAdminCsp(request(path, { 'x-nonce': 'n' }), options), path).toBeNull();
      }
    }
  });
});

describe('withAdminCspHeader', () => {
  it('adds the policy to the sign-in redirect and changes nothing else', () => {
    const redirect = NextResponse.redirect('https://x.test/admin/login?next=%2Fadmin%2Fpages');
    const response = withAdminCspHeader(request('/admin/pages'), redirect, REPORT_ONLY);

    expect(response).toBe(redirect);
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://x.test/admin/login?next=%2Fadmin%2Fpages',
    );
    expect(policyNonce(response.headers.get('content-security-policy-report-only'))).toBeDefined();
    expect(response.headers.get('x-middleware-next')).toBeNull();
    expect(response.headers.get('x-middleware-override-headers')).toBeNull();
  });

  it('leaves responses for other paths alone', () => {
    for (const path of ['/', '/afspraak', '/administrator']) {
      const response = withAdminCspHeader(
        request(path),
        NextResponse.redirect('https://x.test/admin/login'),
        ENFORCE,
      );
      expect(response.headers.get('content-security-policy'), path).toBeNull();
      expect(response.headers.get('content-security-policy-report-only'), path).toBeNull();
    }
  });
});
