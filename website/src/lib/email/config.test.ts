import { describe, expect, it } from 'vitest';

import {
  apiKeyHint,
  apiKeyProblem,
  describeSendFailure,
  emailServiceStatus,
  NO_STORED_EMAIL_SETTINGS,
  parseEmailServiceConfig,
  parseSender,
  redactSecrets,
  replyToProblem,
  resolveEmailSettings,
  senderProblem,
  sendFailureCode,
  testRecipientProblem,
  type StoredEmailSettings,
} from './config';

const KEY = 're_AdminStored_9f8e7d6c5b4a';
const ENV_KEY = 're_FromTheEnvironment_1234';

const stored = (overrides: Partial<StoredEmailSettings> = {}): StoredEmailSettings => ({
  available: true,
  config: {
    from: 'De Bikefit Studio <afspraken@studio.test>',
    replyTo: 'info@studio.test',
    giftVoucherRecipient: 'bestellingen@studio.test',
  },
  apiKey: KEY,
  apiKeyStored: true,
  apiKeyHint: '5b4a',
  apiKeyUpdatedAt: new Date('2026-10-13T14:00:00Z'),
  ...overrides,
});

describe('resolveEmailSettings', () => {
  it('uses the admin values when the environment has none', () => {
    const resolved = resolveEmailSettings({}, stored());
    expect(resolved).toMatchObject({
      apiKey: KEY,
      apiKeySource: 'setting',
      from: 'De Bikefit Studio <afspraken@studio.test>',
      fromSource: 'setting',
      replyTo: 'info@studio.test',
      replyToSource: 'setting',
      recipient: { address: 'bestellingen@studio.test', source: 'setting', invalid: false },
    });
  });

  it('lets each environment variable win over the admin, field by field', () => {
    const resolved = resolveEmailSettings(
      { apiKey: ENV_KEY, from: 'Ops <ops@env.test>' },
      stored(),
    );
    expect(resolved.apiKey).toBe(ENV_KEY);
    expect(resolved.apiKeySource).toBe('env');
    expect(resolved.from).toBe('Ops <ops@env.test>');
    expect(resolved.fromSource).toBe('env');
    // Not set in env: still the admin's.
    expect(resolved.replyToSource).toBe('setting');
    expect(resolved.recipient.source).toBe('setting');
  });

  it('keeps env-only deployments exactly as before (nothing stored, table missing)', () => {
    const resolved = resolveEmailSettings(
      { apiKey: ENV_KEY, from: 'x <a@b.test>', replyTo: 'r@b.test' },
      NO_STORED_EMAIL_SETTINGS,
    );
    expect(resolved).toMatchObject({
      apiKey: ENV_KEY,
      from: 'x <a@b.test>',
      replyTo: 'r@b.test',
      recipient: { address: '', source: 'none' },
    });
  });

  it('has no key and no sender when nothing is configured anywhere', () => {
    const resolved = resolveEmailSettings({}, { ...NO_STORED_EMAIL_SETTINGS, available: true });
    expect(resolved.apiKey).toBeNull();
    expect(resolved.apiKeySource).toBe('none');
    expect(resolved.from).toBe('');
    expect(resolved.recipient.address).toBe('');
  });

  it('treats an undecryptable stored key as no key', () => {
    const resolved = resolveEmailSettings({}, stored({ apiKey: null }));
    expect(resolved.apiKey).toBeNull();
    expect(resolved.apiKeySource).toBe('none');
  });

  it('ignores an invalid stored sender or reply-to instead of sending with it', () => {
    const resolved = resolveEmailSettings(
      {},
      stored({ config: { from: 'geen adres', replyTo: 'a@b', giftVoucherRecipient: '' } }),
    );
    expect(resolved.from).toBe('');
    expect(resolved.fromSource).toBe('none');
    expect(resolved.replyTo).toBe('');
  });
});

describe('emailServiceStatus (what the admin page receives)', () => {
  it('never contains the key, only its source and last four characters', () => {
    for (const env of [{}, { apiKey: ENV_KEY }]) {
      const s = stored();
      const status = emailServiceStatus(resolveEmailSettings(env, s), s);
      const json = JSON.stringify(status);
      expect(json).not.toContain(KEY);
      expect(json).not.toContain(ENV_KEY);
      expect(json).not.toContain('re_');
    }
    const s = stored();
    const status = emailServiceStatus(resolveEmailSettings({}, s), s);
    expect(status.apiKey).toMatchObject({ source: 'setting', stored: true, hint: '5b4a' });
  });

  it('shows no hint for an env key and flags a stored key it overrides', () => {
    const s = stored();
    const status = emailServiceStatus(resolveEmailSettings({ apiKey: ENV_KEY }, s), s);
    expect(status.apiKey).toMatchObject({
      source: 'env',
      hint: null,
      storedButOverridden: true,
    });
  });

  it('reports an unreadable stored key and not ready', () => {
    const s = stored({ apiKey: null });
    const status = emailServiceStatus(resolveEmailSettings({}, s), s);
    expect(status.apiKey.unreadable).toBe(true);
    expect(status.ready).toBe(false);
    expect(status.voucherReady).toBe(false);
  });

  it('is ready for bookings with key + sender, and for vouchers only with an inbox too', () => {
    const noInbox = stored({
      config: { from: 'a@studio.test', replyTo: '', giftVoucherRecipient: '' },
    });
    const partial = emailServiceStatus(resolveEmailSettings({}, noInbox), noInbox);
    expect(partial.ready).toBe(true);
    expect(partial.voucherReady).toBe(false);
    const full = emailServiceStatus(resolveEmailSettings({}, stored()), stored());
    expect(full.voucherReady).toBe(true);
  });

  it('is never ready with nothing configured, and says when the table is missing', () => {
    const status = emailServiceStatus(
      resolveEmailSettings({}, NO_STORED_EMAIL_SETTINGS),
      NO_STORED_EMAIL_SETTINGS,
    );
    expect(status.ready).toBe(false);
    expect(status.voucherReady).toBe(false);
    expect(status.storeAvailable).toBe(false);
  });
});

describe('validation', () => {
  it('accepts a plain or named sender', () => {
    expect(parseSender('afspraken@studio.test')).toEqual({
      name: null,
      address: 'afspraken@studio.test',
    });
    expect(parseSender('De Bikefit Studio <afspraken@studio.test>')).toEqual({
      name: 'De Bikefit Studio',
      address: 'afspraken@studio.test',
    });
    expect(senderProblem('')).toBeNull();
  });

  it('refuses header injection, quotes, lists and junk in the sender', () => {
    for (const bad of [
      'a@studio.test\r\nBcc: x@evil.test',
      'Naam <a@studio.test>\nBcc: x@evil.test',
      '"Naam" <a@studio.test>',
      '<a@studio.test>',
      'a@studio.test, b@studio.test',
      'Naam <a@studio>',
      'geen adres',
    ]) {
      expect(senderProblem(bad), bad).toMatch(/Afzender/);
    }
  });

  it('validates reply-to as one address or empty', () => {
    expect(replyToProblem('')).toBeNull();
    expect(replyToProblem(' info@studio.test ')).toBeNull();
    expect(replyToProblem('Naam <info@studio.test>')).toMatch(/Antwoordadres/);
  });

  it('accepts only something shaped like a Resend key', () => {
    expect(apiKeyProblem(KEY)).toBeNull();
    expect(apiKeyProblem('  ')).toMatch(/Vul de API-sleutel in/);
    expect(apiKeyProblem('sk_live_123456789')).toMatch(/re_/);
    expect(apiKeyProblem('re_abc def ghi jkl')).toMatch(/re_/);
    expect(apiKeyProblem('re_short')).toMatch(/re_/);
    expect(apiKeyHint(` ${KEY} `)).toBe('5b4a');
  });

  it('needs one valid address for a test mail', () => {
    expect(testRecipientProblem('a@studio.test')).toBeNull();
    expect(testRecipientProblem('')).toMatch(/Testbericht/);
    expect(testRecipientProblem('a@studio.test; b@studio.test')).toMatch(/Testbericht/);
  });

  it('reads a malformed stored blob as empty', () => {
    expect(parseEmailServiceConfig({ from: 42 })).toEqual({
      from: '',
      replyTo: '',
      giftVoucherRecipient: '',
    });
    expect(parseEmailServiceConfig(null).from).toBe('');
  });
});

describe('logs, audit and messages', () => {
  it('redacts anything shaped like a key', () => {
    expect(redactSecrets(`API key ${KEY} is invalid`)).toBe('API key re_… is invalid');
  });

  it('maps failures to fixed audit codes', () => {
    expect(sendFailureCode('not_configured')).toBe('not_configured');
    expect(sendFailureCode('missing_from')).toBe('missing_from');
    expect(sendFailureCode(`The ${KEY} is invalid`)).toBe('provider_error');
  });

  it('explains failures in Dutch without leaking a key', () => {
    expect(describeSendFailure('not_configured')).toMatch(/geen API-sleutel/);
    expect(describeSendFailure('missing_from')).toMatch(/geen afzender/);
    const provider = describeSendFailure(`API key ${KEY} is invalid`);
    expect(provider).toMatch(/^Niet verstuurd: de e-maildienst weigerde/);
    expect(provider).not.toContain(KEY);
  });

  it('maps the reasons sendEmail() returns to the same codes and messages as before', () => {
    expect(sendFailureCode('no_recipient')).toBe('no_recipient');
    expect(describeSendFailure('no_recipient')).toMatch(/geen ontvanger/);
    // Refusals and requests without a response: one provider code, one Dutch
    // message that names the status, Resend's error code or the error name.
    for (const reason of [
      'HTTP 422: validation_error',
      'HTTP 403',
      'HTTP 500',
      'request_failed: TimeoutError',
      'request_failed: TypeError',
      'request_failed: unknown',
    ]) {
      expect(sendFailureCode(reason), reason).toBe('provider_error');
      expect(describeSendFailure(reason), reason).toBe(
        `Niet verstuurd: de e-maildienst weigerde het bericht of was niet bereikbaar (${reason}).`,
      );
    }
  });
});
