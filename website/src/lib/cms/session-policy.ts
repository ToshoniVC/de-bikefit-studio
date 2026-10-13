import type { CmsRole } from '@/db/cms-schema';
import { roleRequiresMfa } from './guard';

/**
 * Session lifetime rules, kept pure (no database, cookies or Next runtime) so
 * every edge is unit-tested in `session-policy.test.ts`. `./session.ts` only
 * reads the row, asks {@link evaluateSession} and writes back what it says.
 *
 * Two policies, chosen by the user's role at the moment the session is used
 * (a promotion or demotion takes effect on the next request):
 *
 * - **admin** (every role that requires MFA, so it fails closed for unknown
 *   roles): ends after {@link ADMIN_IDLE_TIMEOUT_MS} without a request, and
 *   at the latest {@link ADMIN_ABSOLUTE_LIFETIME_MS} after sign-in, however
 *   active the admin is. Use moves `expires_at` forward but never past the
 *   absolute end; a session that replaces another (password change, new
 *   authenticator) inherits that end instead of starting a new one.
 * - **standard** (editors, providers): unchanged from before, 14 days with
 *   sliding renewal past the halfway point. A separate decision; see
 *   `docs/cms-architecture.md` §4.
 *
 * `last_used_at` is written at most once per {@link SESSION_TOUCH_INTERVAL_MS},
 * so a burst of requests (an admin page fires several) costs one write. The
 * price: the idle timeout can end a session up to that interval early.
 */

export const ADMIN_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const ADMIN_ABSOLUTE_LIFETIME_MS = 8 * 60 * 60 * 1000;

export const STANDARD_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Standard sessions renew when less than half the lifetime remains. */
export const STANDARD_RENEW_AFTER_MS = STANDARD_SESSION_TTL_MS / 2;

export const SESSION_TOUCH_INTERVAL_MS = 30 * 1000;

export type SessionPolicyName = 'admin' | 'standard';

export function sessionPolicyFor(role: CmsRole | string): SessionPolicyName {
  return roleRequiresMfa(role) ? 'admin' : 'standard';
}

export type SessionTimes = {
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date | null;
};

/** Expiry columns for a new session row. */
export type InitialSessionTimes = { expiresAt: Date; absoluteExpiresAt: Date | null };

/**
 * `replaces`: the absolute end of the session being replaced, if any. The new
 * session never outlives it.
 */
export function initialSessionTimes(
  role: CmsRole | string,
  now: Date,
  replaces?: { absoluteExpiresAt: Date | null } | null,
): InitialSessionTimes {
  if (sessionPolicyFor(role) === 'standard') {
    return {
      expiresAt: new Date(now.getTime() + STANDARD_SESSION_TTL_MS),
      absoluteExpiresAt: replaces?.absoluteExpiresAt ?? null,
    };
  }
  const absolute = earliest(
    new Date(now.getTime() + ADMIN_ABSOLUTE_LIFETIME_MS),
    replaces?.absoluteExpiresAt ?? null,
  );
  return {
    expiresAt: earliest(new Date(now.getTime() + ADMIN_IDLE_TIMEOUT_MS), absolute),
    absoluteExpiresAt: absolute,
  };
}

/** The effective hard end of an admin session: stored value, capped at `created_at` + 8 h. */
export function adminAbsoluteEnd(times: Pick<SessionTimes, 'createdAt' | 'absoluteExpiresAt'>) {
  return earliest(
    new Date(times.createdAt.getTime() + ADMIN_ABSOLUTE_LIFETIME_MS),
    times.absoluteExpiresAt,
  );
}

export type SessionDecision =
  | { valid: false; reason: 'expired' | 'idle' | 'absolute' }
  | {
      valid: true;
      /** Expiry after this request (unchanged unless `touch`). */
      expiresAt: Date;
      /** Write `last_used_at = now` and `expires_at` back. */
      touch: boolean;
      /** Standard sessions only: the expiry slid, so refresh the cookie. */
      renewed: boolean;
    };

/** Whether a session may be used at `now`, and what to write back if so. */
export function evaluateSession(
  role: CmsRole | string,
  times: SessionTimes,
  now: Date,
): SessionDecision {
  const t = now.getTime();
  const sinceUse = t - times.lastUsedAt.getTime();

  if (sessionPolicyFor(role) === 'standard') {
    if (times.expiresAt.getTime() <= t) return { valid: false, reason: 'expired' };
    const renewed = times.expiresAt.getTime() - t < STANDARD_RENEW_AFTER_MS;
    return {
      valid: true,
      expiresAt: renewed ? new Date(t + STANDARD_SESSION_TTL_MS) : times.expiresAt,
      touch: renewed || sinceUse >= SESSION_TOUCH_INTERVAL_MS,
      renewed,
    };
  }

  const absolute = adminAbsoluteEnd(times);
  if (absolute.getTime() <= t) return { valid: false, reason: 'absolute' };
  if (sinceUse >= ADMIN_IDLE_TIMEOUT_MS) return { valid: false, reason: 'idle' };
  if (times.expiresAt.getTime() <= t) return { valid: false, reason: 'expired' };

  const touch = sinceUse >= SESSION_TOUCH_INTERVAL_MS;
  return {
    valid: true,
    expiresAt: touch ? earliest(new Date(t + ADMIN_IDLE_TIMEOUT_MS), absolute) : times.expiresAt,
    touch,
    renewed: false,
  };
}

/**
 * When the session cookie should expire. Admin: at the absolute end, so the
 * browser drops it no later than the server does (the idle timeout is
 * enforced server-side; a cookie cannot be refreshed during a plain page
 * render). Standard: at the sliding expiry, as before.
 */
export function sessionCookieExpiry(
  role: CmsRole | string,
  times: Pick<SessionTimes, 'createdAt' | 'expiresAt' | 'absoluteExpiresAt'>,
): Date {
  return sessionPolicyFor(role) === 'admin' ? adminAbsoluteEnd(times) : times.expiresAt;
}

function earliest(a: Date, b: Date | null): Date {
  return b && b.getTime() < a.getTime() ? b : a;
}
