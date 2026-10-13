import { normalizeIp } from '@/lib/request-ip';

/**
 * How many second-step checks (sign-in, enrolment and replacement codes,
 * re-authentication) may run, as pure data: unit-tested in
 * `rate-limit-policy.test.ts`, enforced on the database by `./rate-limit.ts`.
 *
 * - {@link MFA_MAX_FAILURES_PER_USER_IP} per user AND IP in
 *   {@link MFA_WINDOW_MS}: someone guessing from elsewhere does not block the
 *   owner's device for long.
 * - {@link MFA_MAX_FAILURES_PER_IP} per IP for anyone in the same window.
 * - {@link MFA_MAX_DAILY_FAILURES_PER_USER} per user from anywhere in
 *   {@link MFA_DAILY_WINDOW_MS}: the backstop against guessing from many
 *   addresses.
 *
 * An unknown (or malformed) client IP is not treated as one shared address:
 * the IP scope is skipped and the user's short-window scope is the single
 * `user:<id>|ip:unknown`, so the user rule applies alone.
 */

export const MFA_WINDOW_MS = 15 * 60 * 1000;
export const MFA_MAX_FAILURES_PER_USER_IP = 5;
export const MFA_MAX_FAILURES_PER_IP = 10;
export const MFA_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MFA_MAX_DAILY_FAILURES_PER_USER = 50;

export type MfaRateLimitScope = {
  /** Primary key of the scope's row in `cms_mfa_rate_limits`. */
  key: string;
  /** Owner of the row (deleted with the user, cleared by the remedies); null for the IP scope. */
  userId: string | null;
  limit: number;
  windowMs: number;
};

/** The scopes one check counts against, in the order they are reserved. */
export function mfaRateLimitScopes(
  userId: string,
  ip: string | null | undefined,
): MfaRateLimitScope[] {
  const knownIp = normalizeIp(ip);
  const scopes: MfaRateLimitScope[] = [
    {
      key: `user:${userId}|ip:${knownIp ?? 'unknown'}`,
      userId,
      limit: MFA_MAX_FAILURES_PER_USER_IP,
      windowMs: MFA_WINDOW_MS,
    },
  ];
  if (knownIp) {
    scopes.push({
      key: `ip:${knownIp}`,
      userId: null,
      limit: MFA_MAX_FAILURES_PER_IP,
      windowMs: MFA_WINDOW_MS,
    });
  }
  scopes.push({
    key: `user:${userId}|day`,
    userId,
    limit: MFA_MAX_DAILY_FAILURES_PER_USER,
    windowMs: MFA_DAILY_WINDOW_MS,
  });
  return scopes;
}
