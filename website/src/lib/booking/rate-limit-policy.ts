import { createHash } from 'node:crypto';
import type { RateLimitScope } from '@/lib/rate-limit';
import { normalizeIp } from '@/lib/request-ip';

/**
 * How many public booking attempts may run, as pure data: unit-tested in
 * `rate-limit-policy.test.ts`, enforced on the database by `@/lib/rate-limit`
 * (`createPublicBooking()` in `./public-booking.ts` reserves before it looks
 * at the service and the slot).
 *
 * At most {@link BOOKING_RATE_LIMIT_MAX} attempts per
 * {@link BOOKING_RATE_LIMIT_WINDOW_MS} for EACH of these keys on its own:
 *
 * - the client IP, `booking:ip:<ip>`, only when it is a valid IPv4 or IPv6
 *   address (`normalizeIp()`). An unknown or malformed IP is never one shared
 *   key (it would lump every such visitor together): the e-mail rule then
 *   applies alone;
 * - every address the attempt would mail: the customer's and, when given and
 *   different, the guardian's. One namespace, `booking:email:<key>`, so an
 *   address gets at most five attempts whether it is typed as customer or as
 *   guardian.
 *
 * An e-mail key is the SHA-256 hex of the trimmed, lower-cased address: the
 * counters only need equality, so the address itself is never stored. It is
 * a pseudonym, not anonymous (whoever knows an address can recompute it), and
 * the row is pruned a day after its last attempt.
 */

export const BOOKING_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const BOOKING_RATE_LIMIT_MAX = 5;

/** `booking:email:<SHA-256 hex of the trimmed, lower-cased address>`. */
export function bookingEmailKey(email: string): string {
  const digest = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  return `booking:email:${digest}`;
}

/** `booking:ip:<address>` for a valid client IP, otherwise null. */
export function bookingIpKey(ip: string | null | undefined): string | null {
  const knownIp = normalizeIp(ip);
  return knownIp ? `booking:ip:${knownIp}` : null;
}

/**
 * The scopes one booking attempt counts against, in the order they are
 * reserved: the IP (when known), the customer's e-mail, then a different
 * guardian e-mail. The e-mails have been validated by `validateBookingFields()`.
 */
export function bookingRateLimitScopes(attempt: {
  email: string;
  guardianEmail?: string | null;
  ip: string | null | undefined;
}): RateLimitScope[] {
  const keys: string[] = [];
  const ipKey = bookingIpKey(attempt.ip);
  if (ipKey) keys.push(ipKey);
  keys.push(bookingEmailKey(attempt.email));
  if (attempt.guardianEmail?.trim()) {
    const guardianKey = bookingEmailKey(attempt.guardianEmail);
    if (!keys.includes(guardianKey)) keys.push(guardianKey);
  }
  return keys.map((key) => ({
    key,
    limit: BOOKING_RATE_LIMIT_MAX,
    windowMs: BOOKING_RATE_LIMIT_WINDOW_MS,
  }));
}
