import { describe, expect, it } from 'vitest';
import {
  ADMIN_ABSOLUTE_LIFETIME_MS,
  ADMIN_IDLE_TIMEOUT_MS,
  SESSION_TOUCH_INTERVAL_MS,
  STANDARD_RENEW_AFTER_MS,
  STANDARD_SESSION_TTL_MS,
  adminAbsoluteEnd,
  evaluateSession,
  initialSessionTimes,
  sessionCookieExpiry,
  sessionPolicyFor,
  type SessionTimes,
} from './session-policy';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const SIGN_IN = new Date('2026-10-13T08:00:00Z');
const at = (ms: number) => new Date(SIGN_IN.getTime() + ms);

/** An admin session as `createSession()` writes it at sign-in. */
function adminSession(overrides: Partial<SessionTimes> = {}): SessionTimes {
  return {
    createdAt: SIGN_IN,
    lastUsedAt: SIGN_IN,
    ...initialSessionTimes('admin', SIGN_IN),
    ...overrides,
  };
}

/**
 * Plays an admin who makes a request every `stepMs` from sign-in onwards,
 * writing back what `evaluateSession()` says, as `resolveSession()` does.
 * Returns the time of the first refused request.
 */
function useUntilRefused(stepMs: number, limitMs = 24 * HOUR) {
  let times = adminSession();
  for (let t = stepMs; t <= limitMs; t += stepMs) {
    const now = at(t);
    const decision = evaluateSession('admin', times, now);
    if (!decision.valid) return { refusedAt: t, reason: decision.reason, times };
    expect(decision.expiresAt.getTime()).toBeLessThanOrEqual(adminAbsoluteEnd(times).getTime());
    if (decision.touch) times = { ...times, lastUsedAt: now, expiresAt: decision.expiresAt };
  }
  return { refusedAt: null, reason: null, times };
}

describe('session policy per role', () => {
  it('admins get the admin policy; editors and providers keep the standard one', () => {
    expect(sessionPolicyFor('admin')).toBe('admin');
    expect(sessionPolicyFor('editor')).toBe('standard');
    expect(sessionPolicyFor('provider')).toBe('standard');
  });

  it('fails closed: an unknown role gets the strict admin policy', () => {
    expect(sessionPolicyFor('superuser')).toBe('admin');
    expect(sessionPolicyFor('')).toBe('admin');
  });
});

describe('admin sessions: 15 minutes idle, 8 hours absolute', () => {
  it('starts with a 15-minute expiry and an 8-hour absolute end', () => {
    expect(ADMIN_IDLE_TIMEOUT_MS).toBe(15 * MIN);
    expect(ADMIN_ABSOLUTE_LIFETIME_MS).toBe(8 * HOUR);
    const times = initialSessionTimes('admin', SIGN_IN);
    expect(times.expiresAt).toEqual(at(15 * MIN));
    expect(times.absoluteExpiresAt).toEqual(at(8 * HOUR));
  });

  it('ends after 15 minutes without a request', () => {
    const times = adminSession();
    expect(evaluateSession('admin', times, at(15 * MIN - 1))).toMatchObject({ valid: true });
    expect(evaluateSession('admin', times, at(15 * MIN))).toEqual({
      valid: false,
      reason: 'idle',
    });
  });

  it('also ends on idle when an old row still carries a long expiry (pre-0006)', () => {
    const legacy = adminSession({
      expiresAt: at(14 * 24 * HOUR),
      absoluteExpiresAt: null,
    });
    expect(evaluateSession('admin', legacy, at(16 * MIN))).toEqual({
      valid: false,
      reason: 'idle',
    });
  });

  it('activity moves the expiry forward, but never past the absolute end', () => {
    const times = adminSession({ lastUsedAt: at(7 * HOUR + 50 * MIN), expiresAt: at(8 * HOUR) });
    const decision = evaluateSession('admin', times, at(7 * HOUR + 55 * MIN));
    expect(decision).toMatchObject({ valid: true, touch: true, renewed: false });
    if (decision.valid) expect(decision.expiresAt).toEqual(at(8 * HOUR));
  });

  it('an admin active every minute is still signed out at exactly 8 hours', () => {
    const result = useUntilRefused(MIN);
    expect(result.reason).toBe('absolute');
    expect(result.refusedAt).toBe(8 * HOUR);
  });

  it('an admin who pauses 14 minutes between requests keeps going until the absolute end', () => {
    const result = useUntilRefused(14 * MIN);
    expect(result.reason).toBe('absolute');
    expect(result.refusedAt).toBeGreaterThan(8 * HOUR - 14 * MIN);
    expect(result.refusedAt).toBeLessThanOrEqual(8 * HOUR + 14 * MIN);
  });

  it('an admin who pauses 16 minutes is signed out at the first pause', () => {
    expect(useUntilRefused(16 * MIN)).toMatchObject({ refusedAt: 16 * MIN, reason: 'idle' });
  });

  it('caps a stored absolute end that is later than sign-in + 8 h', () => {
    const tampered = adminSession({ absoluteExpiresAt: at(48 * HOUR), lastUsedAt: at(8 * HOUR) });
    expect(adminAbsoluteEnd(tampered)).toEqual(at(8 * HOUR));
    expect(evaluateSession('admin', tampered, at(8 * HOUR + MIN))).toEqual({
      valid: false,
      reason: 'absolute',
    });
  });

  it('honours an earlier stored absolute end (an inherited one)', () => {
    const inherited = adminSession({ absoluteExpiresAt: at(2 * HOUR), lastUsedAt: at(2 * HOUR) });
    expect(evaluateSession('admin', inherited, at(2 * HOUR + 1))).toEqual({
      valid: false,
      reason: 'absolute',
    });
  });

  it('refuses a row whose own expiry has passed', () => {
    const times = adminSession({ lastUsedAt: at(5 * MIN), expiresAt: at(6 * MIN) });
    expect(evaluateSession('admin', times, at(7 * MIN))).toEqual({
      valid: false,
      reason: 'expired',
    });
  });

  it('writes last use at most once per touch interval', () => {
    const times = adminSession();
    const soon = evaluateSession('admin', times, at(SESSION_TOUCH_INTERVAL_MS - 1));
    expect(soon).toMatchObject({ valid: true, touch: false, expiresAt: times.expiresAt });
    const later = evaluateSession('admin', times, at(SESSION_TOUCH_INTERVAL_MS));
    expect(later).toMatchObject({ valid: true, touch: true });
    if (later.valid) expect(later.expiresAt).toEqual(at(SESSION_TOUCH_INTERVAL_MS + 15 * MIN));
  });

  it('a replacement session keeps the absolute end of the one it replaces', () => {
    const replaced = at(3 * HOUR);
    const now = at(2 * HOUR);
    const times = initialSessionTimes('admin', now, { absoluteExpiresAt: replaced });
    expect(times.absoluteExpiresAt).toEqual(replaced);
    expect(times.expiresAt).toEqual(new Date(now.getTime() + 15 * MIN));
    const nearEnd = initialSessionTimes('admin', at(3 * HOUR - 5 * MIN), {
      absoluteExpiresAt: replaced,
    });
    expect(nearEnd.expiresAt).toEqual(replaced);
    // A replacement never gets more than a brand-new sign-in would.
    expect(
      initialSessionTimes('admin', now, { absoluteExpiresAt: at(30 * HOUR) }).absoluteExpiresAt,
    ).toEqual(new Date(now.getTime() + 8 * HOUR));
  });

  it('the cookie expires at the absolute end, never later', () => {
    const times = adminSession();
    expect(sessionCookieExpiry('admin', times)).toEqual(at(8 * HOUR));
    expect(
      sessionCookieExpiry('admin', { ...times, absoluteExpiresAt: at(30 * HOUR) }).getTime(),
    ).toBe(at(8 * HOUR).getTime());
  });
});

describe('standard sessions (editors, providers): unchanged 14 days, sliding', () => {
  const standard = (overrides: Partial<SessionTimes> = {}): SessionTimes => ({
    createdAt: SIGN_IN,
    lastUsedAt: SIGN_IN,
    ...initialSessionTimes('editor', SIGN_IN),
    ...overrides,
  });

  it('starts at 14 days without an absolute end', () => {
    expect(initialSessionTimes('editor', SIGN_IN)).toEqual({
      expiresAt: at(STANDARD_SESSION_TTL_MS),
      absoluteExpiresAt: null,
    });
  });

  it('survives long idle periods and more than 8 hours', () => {
    const times = standard();
    expect(evaluateSession('editor', times, at(3 * 24 * HOUR))).toMatchObject({
      valid: true,
      renewed: false,
    });
    expect(evaluateSession('provider', times, at(9 * HOUR))).toMatchObject({ valid: true });
  });

  it('slides to a fresh 14 days once past the halfway point, and refreshes the cookie', () => {
    const times = standard();
    const now = at(STANDARD_SESSION_TTL_MS - STANDARD_RENEW_AFTER_MS + MIN);
    const decision = evaluateSession('editor', times, now);
    expect(decision).toMatchObject({ valid: true, renewed: true, touch: true });
    if (decision.valid) {
      expect(decision.expiresAt).toEqual(new Date(now.getTime() + STANDARD_SESSION_TTL_MS));
      expect(sessionCookieExpiry('editor', { ...times, expiresAt: decision.expiresAt })).toEqual(
        decision.expiresAt,
      );
    }
  });

  it('ends at its expiry', () => {
    expect(evaluateSession('editor', standard(), at(STANDARD_SESSION_TTL_MS))).toEqual({
      valid: false,
      reason: 'expired',
    });
  });

  it('a session that becomes an admin one (promotion) is held to the admin limits at once', () => {
    const times = standard({ lastUsedAt: at(20 * MIN) });
    expect(evaluateSession('admin', times, at(40 * MIN))).toEqual({
      valid: false,
      reason: 'idle',
    });
    expect(evaluateSession('admin', standard({ lastUsedAt: at(9 * HOUR) }), at(9 * HOUR))).toEqual({
      valid: false,
      reason: 'absolute',
    });
  });
});
