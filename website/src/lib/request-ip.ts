import { isIP } from 'node:net';

/**
 * The client IP of a request, for rate limiting and the session log — the one
 * helper for it (CLAUDE.md §3). Pure: pass it the request headers (`await
 * headers()` in a server action, `request.headers` in a route handler).
 *
 * On Vercel the platform sets `x-forwarded-for` (client first, then any
 * proxies) and `x-real-ip`. We take the FIRST `x-forwarded-for` entry, fall
 * back to `x-real-ip`, and accept a value only when it parses as an IPv4 or
 * IPv6 address, so a spoofed header cannot plant arbitrary text in the
 * database or in a rate-limit key. Anything else is `null`: callers must not
 * rate-limit on a missing IP as if it were one shared address.
 */

type HeaderSource = { get(name: string): string | null };

/** `[::1]:443` → `::1`, `203.0.113.7:8080` → `203.0.113.7`; otherwise unchanged. */
function stripPort(value: string): string {
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) return bracketed[1];
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(value);
  if (v4WithPort) return v4WithPort[1];
  return value;
}

/** A trimmed, valid IPv4/IPv6 address, or `null`. */
export function normalizeIp(value: string | null | undefined): string | null {
  if (!value) return null;
  const candidate = stripPort(value.trim());
  return candidate && isIP(candidate) !== 0 ? candidate : null;
}

export function clientIpFromHeaders(headers: HeaderSource): string | null {
  const forwarded = headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0];
  return normalizeIp(first) ?? normalizeIp(headers.get('x-real-ip'));
}
