import { describe, expect, it, vi } from 'vitest';
import {
  deliverGiftVoucherOrder,
  GIFT_VOUCHER_RATE_LIMIT_MAX,
  type GiftVoucherDeps,
  type GiftVoucherSendResult,
  type GiftVoucherStore,
} from './delivery';
import { GIFT_VOUCHER_MESSAGES } from './order';

const order = {
  amount: '50',
  message: 'Voor <b>jou</b>',
  name: 'An Peeters',
  email: 'an@example.com',
  phone: '0473 00 00 00',
  website: '',
  requestId: '3f1c2a9e-7b4d-4c1e-9a8f-0d2b6e5c4a31',
};

/** In-memory stand-in for the `cms_booking_rate_limit` rows. */
function memoryStore() {
  const attempts: { email: string; ip: string | null }[] = [];
  const sent = new Set<string>();
  const store: GiftVoucherStore = {
    wasSent: async (requestId) => sent.has(requestId),
    countAttempts: async (email, ip) =>
      attempts.filter((row) => row.email === email || (ip !== null && row.ip === ip)).length,
    recordAttempt: async (email, ip) => {
      attempts.push({ email, ip });
    },
    markSent: async (requestId) => {
      sent.add(requestId);
    },
  };
  return { store, attempts, sent };
}

function setup(
  sendResult: GiftVoucherSendResult | Error,
  overrides: Partial<GiftVoucherDeps> = {},
) {
  const memory = memoryStore();
  const send = vi.fn(async (mail: Parameters<GiftVoucherDeps['send']>[0]) => {
    void mail;
    if (sendResult instanceof Error) throw sendResult;
    return sendResult;
  });
  const log = vi.fn();
  const deps: GiftVoucherDeps = {
    store: memory.store,
    send,
    recipient: 'info@debikefitstudio.be',
    siteName: 'De Bikefit Studio',
    ipAddress: '203.0.113.7',
    now: new Date('2026-10-13T13:40:00Z'),
    log,
    ...overrides,
  };
  return { deps, send, log, ...memory };
}

const SENT: GiftVoucherSendResult = { sent: true, id: 'em_123' };

describe('deliverGiftVoucherOrder', () => {
  it('reports success only when the provider accepted the mail, to the studio, reply-to the visitor', async () => {
    const { deps, send, sent } = setup(SENT);
    expect(await deliverGiftVoucherOrder(order, deps)).toEqual({ ok: true, duplicate: false });
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0][0];
    expect(mail.to).toBe('info@debikefitstudio.be');
    expect(mail.replyTo).toBe('an@example.com');
    expect(mail).not.toHaveProperty('from');
    expect(mail.subject).toContain('50,00');
    expect(mail.subject).not.toContain('An');
    expect(mail.html).toContain('Voor &lt;b&gt;jou&lt;/b&gt;');
    expect(sent.has(order.requestId)).toBe(true);
  });

  it.each([
    'not_configured',
    'missing_from',
    'HTTP 403',
    'The operation was aborted due to timeout',
  ])('a skipped or failed send (%s) is "not sent", never success', async (reason) => {
    const { deps, sent, log } = setup({ sent: false, reason });
    const result = await deliverGiftVoucherOrder(order, deps);
    expect(result).toEqual({
      ok: false,
      code: 'not_sent',
      message: GIFT_VOUCHER_MESSAGES.notSent,
      fieldErrors: {},
    });
    expect(sent.size).toBe(0);
    // The log says why in a fixed vocabulary, without addresses or the provider's text.
    const line = String(log.mock.calls[0][0]);
    expect(line).toMatch(/\((not_configured|missing_from|provider)\)$/);
    expect(line).not.toContain('@');
  });

  it('a send that throws is "not sent"', async () => {
    const { deps } = setup(new Error('socket hang up'));
    expect(await deliverGiftVoucherOrder(order, deps)).toMatchObject({
      ok: false,
      code: 'not_sent',
    });
  });

  it('without a recipient nothing is sent and the visitor hears so', async () => {
    const { deps, send } = setup(SENT, { recipient: '  ' });
    expect(await deliverGiftVoucherOrder(order, deps)).toMatchObject({
      ok: false,
      code: 'not_sent',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('a retry after a failure can still succeed (the failed attempt left no sent marker)', async () => {
    const failing = setup({ sent: false, reason: 'not_configured' });
    await deliverGiftVoucherOrder(order, failing.deps);
    failing.deps.send = vi.fn(async () => SENT);
    expect(await deliverGiftVoucherOrder(order, failing.deps)).toEqual({
      ok: true,
      duplicate: false,
    });
  });

  it('a repeated submit of a sent form is confirmed without a second e-mail', async () => {
    const { deps, send } = setup(SENT);
    await deliverGiftVoucherOrder(order, deps);
    expect(await deliverGiftVoucherOrder(order, deps)).toEqual({ ok: true, duplicate: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('rate limits per e-mail address and per IP', async () => {
    const { deps, send } = setup(SENT);
    for (let index = 0; index < GIFT_VOUCHER_RATE_LIMIT_MAX; index += 1) {
      await deliverGiftVoucherOrder({ ...order, requestId: `request-id-000000${index}` }, deps);
    }
    const blocked = await deliverGiftVoucherOrder(
      { ...order, requestId: 'request-id-0000009' },
      deps,
    );
    expect(blocked).toMatchObject({ ok: false, code: 'rate_limited' });
    expect(send).toHaveBeenCalledTimes(GIFT_VOUCHER_RATE_LIMIT_MAX);

    const otherVisitorSameIp = await deliverGiftVoucherOrder(
      { ...order, email: 'bob@example.com', requestId: 'request-id-0000010' },
      deps,
    );
    expect(otherVisitorSameIp).toMatchObject({ code: 'rate_limited' });
  });

  it('never keys the rate limit on an unknown IP', async () => {
    const { deps, attempts } = setup(SENT, { ipAddress: null });
    await deliverGiftVoucherOrder(order, deps);
    expect(attempts).toEqual([{ email: 'an@example.com', ip: null }]);
  });

  it('invalid input and the honeypot send nothing and record nothing', async () => {
    const { deps, send, attempts } = setup(SENT);
    const invalid = await deliverGiftVoucherOrder({ ...order, amount: 'veel', email: 'x' }, deps);
    expect(invalid).toMatchObject({ ok: false, code: 'invalid' });
    if (!invalid.ok) expect(Object.keys(invalid.fieldErrors).sort()).toEqual(['amount', 'email']);
    const bot = await deliverGiftVoucherOrder({ ...order, website: 'https://spam.example' }, deps);
    expect(bot).toMatchObject({ ok: false, code: 'invalid', fieldErrors: {} });
    expect(send).not.toHaveBeenCalled();
    expect(attempts).toHaveLength(0);
  });

  it('a lost sent marker does not turn a sent order into a failure', async () => {
    const { deps, store } = setup(SENT);
    store.markSent = async () => {
      throw new Error('db down');
    };
    expect(await deliverGiftVoucherOrder(order, deps)).toEqual({ ok: true, duplicate: false });
  });
});
