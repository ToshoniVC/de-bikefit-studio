import { describe, expect, it } from 'vitest';
import {
  MFA_DAILY_WINDOW_MS,
  MFA_MAX_DAILY_FAILURES_PER_USER,
  MFA_MAX_FAILURES_PER_IP,
  MFA_MAX_FAILURES_PER_USER_IP,
  MFA_WINDOW_MS,
  mfaRateLimitScopes,
} from './rate-limit-policy';

const USER = '5b0c1f8e-2d3a-4c6b-9e7f-0a1b2c3d4e5f';

describe('mfaRateLimitScopes', () => {
  it('a known IP: user + IP, then the IP, then the user per day, in that order', () => {
    expect(mfaRateLimitScopes(USER, '203.0.113.7')).toEqual([
      {
        key: `user:${USER}|ip:203.0.113.7`,
        userId: USER,
        limit: MFA_MAX_FAILURES_PER_USER_IP,
        windowMs: MFA_WINDOW_MS,
      },
      {
        key: 'ip:203.0.113.7',
        userId: null,
        limit: MFA_MAX_FAILURES_PER_IP,
        windowMs: MFA_WINDOW_MS,
      },
      {
        key: `user:${USER}|day`,
        userId: USER,
        limit: MFA_MAX_DAILY_FAILURES_PER_USER,
        windowMs: MFA_DAILY_WINDOW_MS,
      },
    ]);
  });

  it('keeps the limits of the design: 5 and 10 per 15 minutes, 50 per day', () => {
    expect([MFA_MAX_FAILURES_PER_USER_IP, MFA_MAX_FAILURES_PER_IP]).toEqual([5, 10]);
    expect(MFA_MAX_DAILY_FAILURES_PER_USER).toBe(50);
    expect(MFA_WINDOW_MS).toBe(15 * 60 * 1000);
    expect(MFA_DAILY_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('an unknown IP is no shared bucket: no IP scope, one `ip:unknown` user scope', () => {
    for (const ip of ['unknown', '', null, undefined]) {
      const keys = mfaRateLimitScopes(USER, ip).map((scope) => scope.key);
      expect(keys, String(ip)).toEqual([`user:${USER}|ip:unknown`, `user:${USER}|day`]);
    }
  });

  it('text that is not an IP address never reaches a key', () => {
    for (const ip of ['ip:1.2.3.4', 'evil|day', '1.2.3', '::1|x', ' 10.0.0.1 x']) {
      const scopes = mfaRateLimitScopes(USER, ip);
      expect(
        scopes.map((scope) => scope.key),
        ip,
      ).toEqual([`user:${USER}|ip:unknown`, `user:${USER}|day`]);
    }
  });

  it('IPv6 and an address with a port are keyed on the bare address', () => {
    expect(mfaRateLimitScopes(USER, '2001:db8::1')[1].key).toBe('ip:2001:db8::1');
    expect(mfaRateLimitScopes(USER, '[2001:db8::1]:443')[1].key).toBe('ip:2001:db8::1');
    expect(mfaRateLimitScopes(USER, '203.0.113.7:8080')[0].key).toBe(`user:${USER}|ip:203.0.113.7`);
  });

  it('the scopes of two users never share a user-owned row, only the IP one', () => {
    const other = '00000000-0000-4000-8000-000000000000';
    const mine = mfaRateLimitScopes(USER, '198.51.100.2');
    const theirs = mfaRateLimitScopes(other, '198.51.100.2');
    const shared = mine.filter((scope) => theirs.some((t) => t.key === scope.key));
    expect(shared.map((scope) => scope.key)).toEqual(['ip:198.51.100.2']);
    expect(shared[0].userId).toBeNull();
  });
});
