import { createHash } from 'node:crypto';
import type { RateLimitScope } from '@/lib/rate-limit';
import { normalizeIp } from '@/lib/request-ip';
import {
  OFFER_ENQUIRY_DUPLICATE_WINDOW_MS,
  OFFER_ENQUIRY_RATE_LIMIT_MAX,
  OFFER_ENQUIRY_RATE_LIMIT_WINDOW_MS,
} from './delivery';

/**
 * The keys of the enquiry form's rate limit on `cms_rate_limits` (the shared,
 * race-free reservation of `src/lib/rate-limit.ts`, as for bookings), in their
 * own `aanvraag:` namespace: 5 attempts per 15 minutes per client IP (only a
 * valid one: an unknown IP is never a shared key) and per e-mail address,
 * stored as a SHA-256 hash, never the address. Plain module, unit-tested.
 */

export function enquiryEmailKey(email: string): string {
  const digest = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  return `aanvraag:email:${digest}`;
}

export function enquiryIpKey(ip: string | null | undefined): string | null {
  const known = normalizeIp(ip);
  return known ? `aanvraag:ip:${known}` : null;
}

export function offerEnquiryRateLimitScopes(attempt: {
  email: string;
  ip: string | null | undefined;
}): RateLimitScope[] {
  const keys: string[] = [];
  const ipKey = enquiryIpKey(attempt.ip);
  if (ipKey) keys.push(ipKey);
  keys.push(enquiryEmailKey(attempt.email));
  return keys.map((key) => ({
    key,
    limit: OFFER_ENQUIRY_RATE_LIMIT_MAX,
    windowMs: OFFER_ENQUIRY_RATE_LIMIT_WINDOW_MS,
  }));
}

/** The duplicate marker of one sent form: its random request id, one hit, a day. */
export function enquirySentScope(requestId: string): RateLimitScope {
  return {
    key: `aanvraag-sent:${requestId}`,
    limit: 1,
    windowMs: OFFER_ENQUIRY_DUPLICATE_WINDOW_MS,
  };
}
