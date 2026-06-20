import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Site access gate ("firewall") for the staging/dev phase.
 *
 * When SITE_GATE_PASSWORD is set, the whole site is locked behind HTTP Basic
 * Auth. It's off when the var is absent, so:
 *   - Staging   → set the vars in Vercel  → locked
 *   - Production → don't set them          → public
 *   - Local      → set in .env.local or not → your choice
 */
const GATE_USER = process.env.SITE_GATE_USER ?? '';
const GATE_PASSWORD = process.env.SITE_GATE_PASSWORD ?? '';
const gateEnabled = GATE_PASSWORD.length > 0;

/** Constant-time string compare (no Node crypto, works in any runtime). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function unauthorized() {
  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Qarakter (staging)"' },
  });
}

export function middleware(request: NextRequest) {
  if (!gateEnabled) return NextResponse.next();

  const header = request.headers.get('authorization');
  if (header?.startsWith('Basic ')) {
    let decoded = '';
    try {
      decoded = atob(header.slice(6));
    } catch {
      return unauthorized();
    }
    const sep = decoded.indexOf(':');
    const user = decoded.slice(0, sep);
    const pass = decoded.slice(sep + 1);
    // Username is optional: if SITE_GATE_USER is unset, only the password matters.
    const userOk = GATE_USER.length === 0 || safeEqual(user, GATE_USER);
    if (userOk && safeEqual(pass, GATE_PASSWORD)) {
      return NextResponse.next();
    }
  }
  return unauthorized();
}

export const config = {
  // Gate everything except Next's static assets and the favicon.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
