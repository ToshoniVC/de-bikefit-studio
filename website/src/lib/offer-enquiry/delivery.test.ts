import { describe, expect, it, vi } from 'vitest';
import {
  deliverOfferEnquiry,
  type EnquiryOffer,
  type OfferEnquiryDeps,
  type OfferEnquiryStore,
} from './delivery';
import { OFFER_ENQUIRY_MESSAGES } from './input';

/**
 * Every outcome of the enquiry form with the I/O injected: no database, no
 * mail provider, nothing sent anywhere. The real wiring (`service.ts`) uses
 * the configured order inbox and `sendEmail()`; it is never called here.
 */

const LACTAAT: EnquiryOffer = {
  title: 'Lactaattest',
  url: 'https://studio.test/aanbod/lactaattest',
  audiences: [],
};
const BIKEFIT_ENQUIRY: EnquiryOffer = {
  title: 'Bikefit – nieuwe fiets',
  url: 'https://studio.test/aanbod/bikefit-nieuwe-fiets',
  audiences: ['adult', 'youth'],
};

const INPUT = {
  offerSlug: 'lactaattest',
  name: 'An <b>Peeters</b>',
  email: 'an@example.com',
  phone: '0470 12 34 56',
  message: 'Graag een test\n<script>alert(1)</script>',
  requestId: '0b8f3c2e-1d4a-4c7e-9b1a-2f6e8d9c0a11',
};

type SetupOverrides = Partial<Omit<OfferEnquiryDeps, 'store'>> & {
  store?: Partial<OfferEnquiryStore>;
};

function setup({ store: storeOverrides, ...overrides }: SetupOverrides = {}) {
  const store: OfferEnquiryStore = {
    wasSent: vi.fn(async () => false),
    reserve: vi.fn(async () => true),
    markSent: vi.fn(async () => {}),
    ...storeOverrides,
  };
  const send = vi.fn<OfferEnquiryDeps['send']>(async () => ({ sent: true, id: 'msg-1' }));
  const log = vi.fn();
  const findOffer = vi.fn(async (slug: string) =>
    slug === 'lactaattest' ? LACTAAT : slug === 'bikefit-nieuwe-fiets' ? BIKEFIT_ENQUIRY : null,
  );
  const deps: OfferEnquiryDeps = {
    findOffer,
    send,
    recipient: 'orders@studio.test',
    siteName: 'De Bikefit Studio',
    ipAddress: '203.0.113.7',
    now: new Date('2026-10-16T10:00:00Z'),
    log,
    ...overrides,
    store,
  };
  return { deps, store, send: deps.send as typeof send, log, findOffer };
}

describe('deliverOfferEnquiry', () => {
  it('mails the studio inbox with the visitor as Reply-To, escaped, no personal data in the subject', async () => {
    const { deps, send, store } = setup();
    expect(await deliverOfferEnquiry(INPUT, deps)).toEqual({ ok: true, duplicate: false });
    expect(store.reserve).toHaveBeenCalledWith('an@example.com', '203.0.113.7');
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0][0] as unknown as Record<string, string>;
    expect(mail.to).toBe('orders@studio.test');
    expect(mail.replyTo).toBe('an@example.com');
    expect(mail.subject).toMatch(/^Aanvraag: Lactaattest \(AV-[0-9A-F]{8}\)$/);
    expect(mail.subject).not.toContain('Peeters');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.text).toContain('+32 470 12 34 56');
    expect(store.markSent).toHaveBeenCalledWith(INPUT.requestId);
  });

  it('names Volwassene or Jeugd when the offering has both, and requires the choice', async () => {
    const { deps, send } = setup();
    const missing = await deliverOfferEnquiry(
      { ...INPUT, offerSlug: 'bikefit-nieuwe-fiets' },
      deps,
    );
    expect(missing).toMatchObject({
      ok: false,
      code: 'invalid',
      fieldErrors: { audience: 'Kies voor wie de aanvraag is.' },
    });
    const ok = await deliverOfferEnquiry(
      { ...INPUT, offerSlug: 'bikefit-nieuwe-fiets', audience: 'youth' },
      deps,
    );
    expect(ok).toEqual({ ok: true, duplicate: false });
    expect((send.mock.calls[0][0] as unknown as { text: string }).text).toContain('Voor: Jeugd');
  });

  it('refuses an offer that is unknown, hidden or booked online (the server decides)', async () => {
    const { deps, send, store } = setup();
    expect(
      await deliverOfferEnquiry({ ...INPUT, offerSlug: 'bikefit-huidige-fiets' }, deps),
    ).toEqual({
      ok: false,
      code: 'unavailable',
      message: OFFER_ENQUIRY_MESSAGES.unavailable,
      fieldErrors: {},
    });
    expect(store.reserve).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('invalid fields cost no query and no rate-limit hit', async () => {
    const { deps, findOffer, store } = setup();
    const result = await deliverOfferEnquiry({ ...INPUT, email: 'nope' }, deps);
    expect(result).toMatchObject({ ok: false, code: 'invalid' });
    expect(findOffer).not.toHaveBeenCalled();
    expect(store.reserve).not.toHaveBeenCalled();
  });

  it('a filled-in honeypot is refused quietly, nothing sent or reserved', async () => {
    const { deps, send, store } = setup();
    expect(await deliverOfferEnquiry({ ...INPUT, website: 'http://spam' }, deps)).toEqual({
      ok: false,
      code: 'invalid',
      message: OFFER_ENQUIRY_MESSAGES.rejected,
      fieldErrors: {},
    });
    expect(store.reserve).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('rate limited: refused before anything is sent', async () => {
    const { deps, send } = setup({ store: { reserve: vi.fn(async () => false) } });
    expect(await deliverOfferEnquiry(INPUT, deps)).toMatchObject({
      ok: false,
      code: 'rate_limited',
      message: OFFER_ENQUIRY_MESSAGES.rateLimited,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('a repeat of a sent form is confirmed without a second mail', async () => {
    const { deps, send, store } = setup({ store: { wasSent: vi.fn(async () => true) } });
    expect(await deliverOfferEnquiry(INPUT, deps)).toEqual({ ok: true, duplicate: true });
    expect(store.reserve).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('no recipient configured: "not sent", logged without personal data', async () => {
    const { deps, send, log } = setup({ recipient: '  ' });
    expect(await deliverOfferEnquiry(INPUT, deps)).toMatchObject({ ok: false, code: 'not_sent' });
    expect(send).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('[aanvraag] niet verstuurd (no_recipient)');
  });

  it('a refused, failed or throwing send is "not sent" and only a code is logged', async () => {
    for (const send of [
      vi.fn(async () => ({ sent: false as const, reason: 'not_configured' })),
      vi.fn(async () => ({ sent: false as const, reason: 'HTTP 422: an@example.com is invalid' })),
      vi.fn(async () => {
        throw new Error('an@example.com');
      }),
    ]) {
      const { deps, log, store } = setup({ send });
      expect(await deliverOfferEnquiry(INPUT, deps)).toMatchObject({
        ok: false,
        code: 'not_sent',
      });
      expect(store.markSent).not.toHaveBeenCalled();
      expect(JSON.stringify(log.mock.calls)).not.toContain('example.com');
    }
  });
});
