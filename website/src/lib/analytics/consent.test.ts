import { describe, expect, it } from 'vitest';
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  openConsent,
  parseConsent,
  readConsent,
  readCookie,
  resolveMeasurementId,
  subscribeConsent,
  writeConsent,
} from './consent';

describe('parseConsent', () => {
  it('accepts exactly "granted" and "denied"', () => {
    expect(parseConsent('granted')).toBe('granted');
    expect(parseConsent('denied')).toBe('denied');
  });

  it('treats anything else as no choice', () => {
    for (const value of [null, undefined, '', 'GRANTED', ' granted', 'yes', 'true']) {
      expect(parseConsent(value), String(value)).toBeNull();
    }
  });
});

describe('readCookie', () => {
  it('finds a cookie among others, ignoring the spaces around it', () => {
    expect(readCookie('a=1; cms_consent=granted ;b=2', CONSENT_COOKIE)).toBe('granted');
  });

  it('matches the whole cookie name only', () => {
    expect(readCookie('xcms_consent=denied; cms_consent_old=granted', CONSENT_COOKIE)).toBeNull();
  });

  it('decodes the value and keeps "=" signs inside it', () => {
    expect(readCookie('k=a%20b%3Dc=d', 'k')).toBe('a b=c=d');
  });

  it('returns the first of duplicate cookies', () => {
    expect(readCookie('cms_consent=denied; cms_consent=granted', CONSENT_COOKIE)).toBe('denied');
  });

  it('returns null for a missing cookie, an empty header or broken encoding', () => {
    expect(readCookie('', CONSENT_COOKIE)).toBeNull();
    expect(readCookie('cms_consent', CONSENT_COOKIE)).toBeNull();
    expect(readCookie('other=1', CONSENT_COOKIE)).toBeNull();
    expect(readCookie('cms_consent=%E0%A4%A', CONSENT_COOKIE)).toBeNull();
  });
});

describe('resolveMeasurementId', () => {
  it('returns the trimmed id when analytics is enabled', () => {
    expect(resolveMeasurementId(' G-ABC123XYZ ', true)).toBe('G-ABC123XYZ');
    expect(resolveMeasurementId(`G-${'A'.repeat(30)}`, true)).toBe(`G-${'A'.repeat(30)}`);
  });

  it('returns null while analytics is switched off or no id is configured', () => {
    expect(resolveMeasurementId('G-ABC123XYZ', false)).toBeNull();
    expect(resolveMeasurementId(undefined, true)).toBeNull();
    expect(resolveMeasurementId('   ', true)).toBeNull();
  });

  it('rejects ids that could break out of the gtag snippet', () => {
    for (const id of [
      'G-ABC 123',
      'G-"><script>',
      "G-ABC';alert(1)//",
      'G-ABC/123',
      'X'.repeat(33),
    ]) {
      expect(resolveMeasurementId(id, true), id).toBeNull();
    }
  });
});

describe('browser helpers on the server', () => {
  it('are harmless without a document or window', () => {
    expect(readConsent()).toBeNull();
    expect(() => writeConsent('granted')).not.toThrow();
    expect(() => openConsent()).not.toThrow();
    const unsubscribe = subscribeConsent(() => {});
    expect(() => unsubscribe()).not.toThrow();
    expect(CONSENT_MAX_AGE_SECONDS).toBe(365 * 24 * 60 * 60);
  });
});
