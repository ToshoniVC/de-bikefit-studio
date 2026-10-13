import 'server-only';
import { headers } from 'next/headers';
import { clientIpFromHeaders } from '@/lib/request-ip';
import type { SessionContext } from '@/lib/cms/session';

/**
 * Request helpers shared by the auth and MFA server actions. Kept out of the
 * `'use server'` files, which may only export async actions.
 */

/** Only ever redirect inside the admin, never to an attacker-supplied origin. */
export function safeAdminPath(value: string, fallback = '/admin'): string {
  if (!value.startsWith('/admin')) return fallback;
  if (value.startsWith('//') || value.includes('\\')) return fallback;
  return value;
}

/** User agent and client IP, for sessions, challenges and rate limiting. */
export async function requestContext(): Promise<SessionContext> {
  const headerList = await headers();
  return {
    userAgent: headerList.get('user-agent') ?? undefined,
    ipAddress: clientIpFromHeaders(headerList) ?? 'unknown',
  };
}
