import { describe, expect, it, vi } from 'vitest';
import { EMAIL_RE } from '@/lib/gift-voucher/order';
import { OFFER_ENQUIRY_LIMITS, OFFER_ENQUIRY_RAW_LIMITS, validateOfferEnquiry } from './input';
import {
  enquiryEmailKey,
  enquiryIpKey,
  enquirySentScope,
  offerEnquiryRateLimitScopes,
} from './rate-limit-policy';

const VALID = {
  offerSlug: 'lactaattest',
  name: 'An Peeters',
  email: 'an@example.com',
  phone: '',
  message: 'Kan ik in november een lactaattest doen?',
  requestId: '0b8f3c2e-1d4a-4c7e-9b1a-2f6e8d9c0a11',
};

describe('validateOfferEnquiry', () => {
  it('accepts a normal enquiry and keeps only what is needed', () => {
    expect(validateOfferEnquiry(VALID)).toEqual({
      ok: true,
      honeypot: false,
      enquiry: {
        offerSlug: 'lactaattest',
        audience: '',
        name: 'An Peeters',
        email: 'an@example.com',
        phone: '',
        message: 'Kan ik in november een lactaattest doen?',
        requestId: VALID.requestId,
      },
    });
  });

  it('normalises a Belgian phone number to one +32, and a lone prefix counts as empty', () => {
    const typed = validateOfferEnquiry({ ...VALID, phone: '0470 12 34 56' });
    expect(typed.ok && typed.enquiry.phone).toBe('+32 470 12 34 56');
    const twice = validateOfferEnquiry({ ...VALID, phone: '+32 0470/12.34.56' });
    expect(twice.ok && twice.enquiry.phone).toBe('+32 470 12 34 56');
    const prefix = validateOfferEnquiry({ ...VALID, phone: '+32 ' });
    expect(prefix.ok && prefix.enquiry.phone).toBe('');
    expect(validateOfferEnquiry({ ...VALID, phone: '06 12345678' })).toEqual({
      ok: false,
      fieldErrors: { phone: 'Vul een geldig telefoonnummer in.' },
    });
  });

  it('asks who it is for only when the offering has Volwassene and Jeugd', () => {
    expect(validateOfferEnquiry({ ...VALID, audience: 'youth' }, [])).toMatchObject({
      ok: true,
      enquiry: { audience: '' },
    });
    expect(validateOfferEnquiry(VALID, ['adult', 'youth'])).toEqual({
      ok: false,
      fieldErrors: { audience: 'Kies voor wie de aanvraag is.' },
    });
    expect(validateOfferEnquiry({ ...VALID, audience: 'youth' }, ['adult', 'youth'])).toMatchObject(
      { ok: true, enquiry: { audience: 'youth' } },
    );
    expect(validateOfferEnquiry({ ...VALID, audience: 'all' }, ['adult', 'youth']).ok).toBe(false);
  });

  it('gives every field its message at once', () => {
    expect(validateOfferEnquiry({ offerSlug: 'lactaattest', email: 'nope' })).toEqual({
      ok: false,
      fieldErrors: {
        name: 'Vul je naam in.',
        email: 'Vul een geldig e-mailadres in.',
        message: 'Vertel kort wat je wil vragen.',
      },
    });
  });

  it('refuses a malformed offer slug or body without reading further', () => {
    expect(validateOfferEnquiry({ ...VALID, offerSlug: '../admin' })).toEqual({
      ok: false,
      fieldErrors: { name: 'Controleer je aanvraag.' },
    });
    expect(validateOfferEnquiry({ ...VALID, name: 42 }).ok).toBe(false);
    expect(validateOfferEnquiry('x').ok).toBe(false);
  });

  it('caps raw fields first, and the e-mail pattern never sees more than its limit', () => {
    expect(
      validateOfferEnquiry({
        ...VALID,
        message: 'x'.repeat(OFFER_ENQUIRY_RAW_LIMITS.message + 1),
      }),
    ).toEqual({
      ok: false,
      fieldErrors: { message: `Maximaal ${OFFER_ENQUIRY_LIMITS.message} tekens.` },
    });

    const exec = vi.spyOn(RegExp.prototype, 'exec');
    expect(validateOfferEnquiry({ ...VALID, email: `${'a@.'.repeat(100)}x.be` })).toEqual({
      ok: false,
      fieldErrors: { email: 'Vul een geldig e-mailadres in.' },
    });
    const emailRuns = exec.mock.calls.filter((_, index) => exec.mock.contexts[index] === EMAIL_RE);
    expect(emailRuns).toHaveLength(0);
    // The spy does see the pattern for an address within the limit.
    validateOfferEnquiry(VALID);
    expect(exec.mock.contexts.filter((context) => context === EMAIL_RE)).toHaveLength(1);
    exec.mockRestore();
  });

  it('reduces the honeypot to "filled in?" and drops a malformed request id', () => {
    expect(validateOfferEnquiry({ ...VALID, website: 'spam' })).toMatchObject({ honeypot: true });
    expect(validateOfferEnquiry({ ...VALID, website: '   ' })).toMatchObject({ honeypot: false });
    expect(validateOfferEnquiry({ ...VALID, requestId: 'x' })).toMatchObject({
      enquiry: { requestId: null },
    });
  });
});

describe('enquiry rate-limit keys', () => {
  it('a valid IP and the hashed, lower-cased e-mail; never the address itself', () => {
    const scopes = offerEnquiryRateLimitScopes({ email: ' An@Example.com ', ip: '203.0.113.7' });
    expect(scopes.map((scope) => scope.key)).toEqual([
      'aanvraag:ip:203.0.113.7',
      enquiryEmailKey('an@example.com'),
    ]);
    expect(scopes.every((scope) => scope.limit === 5 && scope.windowMs === 15 * 60 * 1000)).toBe(
      true,
    );
    expect(JSON.stringify(scopes)).not.toContain('example.com');
  });

  it('an unknown or malformed IP is never a shared key', () => {
    expect(enquiryIpKey(null)).toBeNull();
    expect(enquiryIpKey('unknown')).toBeNull();
    expect(offerEnquiryRateLimitScopes({ email: 'a@b.be', ip: 'unknown' })).toHaveLength(1);
  });

  it('the duplicate marker is one hit per request id for a day', () => {
    expect(enquirySentScope('abc')).toEqual({
      key: 'aanvraag-sent:abc',
      limit: 1,
      windowMs: 24 * 60 * 60 * 1000,
    });
  });
});
