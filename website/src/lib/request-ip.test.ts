import { describe, expect, it } from 'vitest';

import { clientIpFromHeaders, normalizeIp } from './request-ip';

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

describe('clientIpFromHeaders', () => {
  it('takes the first x-forwarded-for entry, trimmed', () => {
    expect(
      clientIpFromHeaders(headers({ 'x-forwarded-for': ' 203.0.113.7 , 10.0.0.1, 10.0.0.2' })),
    ).toBe('203.0.113.7');
  });

  it('accepts IPv6', () => {
    expect(clientIpFromHeaders(headers({ 'x-forwarded-for': '2001:db8::1, 10.0.0.1' }))).toBe(
      '2001:db8::1',
    );
    expect(clientIpFromHeaders(headers({ 'x-forwarded-for': '::1' }))).toBe('::1');
  });

  it('strips a port from IPv4 and bracketed IPv6', () => {
    expect(clientIpFromHeaders(headers({ 'x-forwarded-for': '203.0.113.7:51234' }))).toBe(
      '203.0.113.7',
    );
    expect(clientIpFromHeaders(headers({ 'x-forwarded-for': '[2001:db8::1]:443' }))).toBe(
      '2001:db8::1',
    );
  });

  it('falls back to x-real-ip when x-forwarded-for is missing or not an address', () => {
    expect(clientIpFromHeaders(headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
    expect(
      clientIpFromHeaders(headers({ 'x-forwarded-for': 'unknown', 'x-real-ip': '198.51.100.4' })),
    ).toBe('198.51.100.4');
  });

  it('returns null when nothing valid is present', () => {
    expect(clientIpFromHeaders(headers({}))).toBeNull();
    expect(clientIpFromHeaders(headers({ 'x-forwarded-for': '' }))).toBeNull();
    expect(
      clientIpFromHeaders(headers({ 'x-forwarded-for': "'; DROP TABLE cms_bookings; --" })),
    ).toBeNull();
    expect(
      clientIpFromHeaders(headers({ 'x-forwarded-for': '999.1.1.1', 'x-real-ip': 'localhost' })),
    ).toBeNull();
  });

  it('works with any object that has get()', () => {
    const map = new Map([['x-forwarded-for', '203.0.113.9']]);
    expect(clientIpFromHeaders({ get: (name) => map.get(name) ?? null })).toBe('203.0.113.9');
  });
});

describe('normalizeIp', () => {
  it('validates single values', () => {
    expect(normalizeIp(' 192.0.2.1 ')).toBe('192.0.2.1');
    expect(normalizeIp('192.0.2')).toBeNull();
    expect(normalizeIp(null)).toBeNull();
    expect(normalizeIp(undefined)).toBeNull();
  });
});
