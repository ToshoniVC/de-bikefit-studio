import 'server-only';
import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * TEMPORARY dev-phase session: an HMAC-signed cookie holding the user id+email.
 *
 * ⚠️ This is NOT secure auth — there is no password or email verification, so
 * anyone can "log in" as any email. It exists only to exercise logged-in flows
 * during design validation, and the whole site is behind the staging gate.
 * Phase 2 replaces this with Auth.js email magic links.
 */
const COOKIE = 'qarakter_session';
const secret = process.env.AUTH_SECRET ?? 'dev-insecure-fallback-secret';

export type SessionData = { userId: string; email: string };

function sign(payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export async function createSession(data: SessionData): Promise<void> {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const token = `${payload}.${sign(payload)}`;
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function getSession(): Promise<SessionData | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;

  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()) as SessionData;
  } catch {
    return null;
  }
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}
