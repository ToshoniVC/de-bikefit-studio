import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BOOKING_RATE_LIMIT_MAX,
  BOOKING_RATE_LIMIT_WINDOW_MS,
  bookingEmailKey,
  bookingIpKey,
  bookingRateLimitScopes,
} from './rate-limit-policy';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const keysOf = (attempt: Parameters<typeof bookingRateLimitScopes>[0]) =>
  bookingRateLimitScopes(attempt).map((scope) => scope.key);

const ANNA = `booking:email:${sha256('anna@example.com')}`;
const VOOGD = `booking:email:${sha256('voogd@example.com')}`;

describe('bookingRateLimitScopes', () => {
  it('a known IP: the IP, then the e-mail, each 5 per 15 minutes', () => {
    expect(bookingRateLimitScopes({ email: 'anna@example.com', ip: '203.0.113.7' })).toEqual([
      { key: 'booking:ip:203.0.113.7', limit: 5, windowMs: 15 * 60 * 1000 },
      { key: ANNA, limit: 5, windowMs: 15 * 60 * 1000 },
    ]);
  });

  it('keeps the limits of the policy: 5 attempts per 15 minutes', () => {
    expect(BOOKING_RATE_LIMIT_MAX).toBe(5);
    expect(BOOKING_RATE_LIMIT_WINDOW_MS).toBe(15 * 60 * 1000);
    for (const scope of bookingRateLimitScopes({
      email: 'anna@example.com',
      guardianEmail: 'voogd@example.com',
      ip: '203.0.113.7',
    })) {
      expect(scope.limit).toBe(BOOKING_RATE_LIMIT_MAX);
      expect(scope.windowMs).toBe(BOOKING_RATE_LIMIT_WINDOW_MS);
    }
  });

  it('an unknown IP is no shared key: the e-mail rule alone', () => {
    for (const ip of [null, undefined, '', 'unknown', '   ']) {
      expect(keysOf({ email: 'anna@example.com', ip }), String(ip)).toEqual([ANNA]);
    }
  });

  it('text that is not an IP address never reaches a key', () => {
    for (const ip of ['ip:1.2.3.4', '1.2.3', '999.1.1.1', 'evil|x', ' 10.0.0.1 x', 'a@b.c']) {
      expect(keysOf({ email: 'anna@example.com', ip }), ip).toEqual([ANNA]);
    }
  });

  it('IPv6, a port and surrounding spaces: the address as normalizeIp() gives it', () => {
    expect(keysOf({ email: 'anna@example.com', ip: '2001:db8::1' })[0]).toBe(
      'booking:ip:2001:db8::1',
    );
    expect(keysOf({ email: 'anna@example.com', ip: '[2001:db8::1]:443' })[0]).toBe(
      'booking:ip:2001:db8::1',
    );
    expect(keysOf({ email: 'anna@example.com', ip: '203.0.113.7:8080' })[0]).toBe(
      'booking:ip:203.0.113.7',
    );
    expect(keysOf({ email: 'anna@example.com', ip: ' 203.0.113.7 ' })[0]).toBe(
      'booking:ip:203.0.113.7',
    );
    expect(bookingIpKey('::1')).toBe('booking:ip:::1');
    expect(bookingIpKey('geen-ip')).toBeNull();
  });

  it('the e-mail key is the SHA-256 hex of the trimmed, lower-cased address', () => {
    expect(bookingEmailKey('anna@example.com')).toBe(ANNA);
    expect(bookingEmailKey('Anna@Example.COM')).toBe(ANNA);
    expect(bookingEmailKey('  anna@example.com ')).toBe(ANNA);
    expect(bookingEmailKey('anna@example.be')).not.toBe(ANNA);
    expect(ANNA).toMatch(/^booking:email:[0-9a-f]{64}$/);
  });

  it('no key holds the address', () => {
    const keys = keysOf({
      email: 'Anna.Peeters@Example.com',
      guardianEmail: 'voogd@example.com',
      ip: '203.0.113.7',
    });
    for (const key of keys) {
      expect(key).not.toMatch(/@|anna|peeters|voogd|example/i);
    }
  });

  it('a different guardian e-mail is a third scope, after the customer', () => {
    expect(
      keysOf({ email: 'anna@example.com', guardianEmail: 'voogd@example.com', ip: '203.0.113.7' }),
    ).toEqual(['booking:ip:203.0.113.7', ANNA, VOOGD]);
    expect(
      keysOf({ email: 'anna@example.com', guardianEmail: 'voogd@example.com', ip: null }),
    ).toEqual([ANNA, VOOGD]);
  });

  it('a guardian e-mail that is empty or the customer’s own adds nothing', () => {
    for (const guardianEmail of [
      '',
      '   ',
      null,
      undefined,
      'ANNA@example.com',
      ' anna@example.com',
    ]) {
      expect(
        keysOf({ email: 'anna@example.com', guardianEmail, ip: '203.0.113.7' }),
        String(guardianEmail),
      ).toEqual(['booking:ip:203.0.113.7', ANNA]);
    }
  });

  it('the keys of one attempt are unique and namespaced', () => {
    const keys = keysOf({
      email: 'anna@example.com',
      guardianEmail: 'voogd@example.com',
      ip: '2001:db8::7',
    });
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^booking:(ip|email):/);
  });
});
