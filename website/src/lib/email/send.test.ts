import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeSendFailure, type ResolvedEmailSettings } from './config';
import { sendEmail, type SendEmailInput, type SendEmailResult } from './send';
import { loadEmailSettings } from './settings';

/**
 * What `sendEmail()` logs and returns when a mail is skipped or fails
 * (CLAUDE.md §4, "Logging": never PII, tokens or request bodies). Booking
 * subjects carry the customer's name, and Resend's error `message` can echo
 * request content (addresses, names), so neither may reach a log line or the
 * returned `reason` (the admin test mail shows it, the audit maps it to a
 * code). What remains: the recipient count, the HTTP status, Resend's error
 * code (`name`) when it is a plain code, and the name of a thrown error.
 *
 * Pure: `fetch` is stubbed and every call passes its settings, so `./settings`
 * (database, environment) is mocked and must never run.
 */

vi.mock('./settings', () => ({
  loadEmailSettings: vi.fn(async () => {
    throw new Error('loadEmailSettings must not run: every call passes its settings');
  }),
}));

const CANARY_NAME = 'Canary Jansen-Pieters';
const CANARY_EMAIL = 'canary.jansen-pieters@kanarie-mail.test';
const GUARDIAN_EMAIL = 'ouder.kanarie@kanarie-mail.test';
const API_KEY = 're_CanaryUnitKey_0123456789abcdef';
// Shaped like a real provider notification subject (`providerNotificationEmail`).
const SUBJECT = `Nieuwe afspraak: Bikefit volwassenen — ${CANARY_NAME}, za 24 okt 09:00`;

/** None of these may appear in a log line, a reason or the admin message (case-insensitive). */
const FORBIDDEN = [
  CANARY_NAME,
  'jansen-pieters', // the surname, also inside the address
  SUBJECT,
  CANARY_EMAIL,
  GUARDIAN_EMAIL,
  'kanarie-mail.test', // the recipients' domain
  API_KEY,
];

const MAIL: SendEmailInput = {
  to: [CANARY_EMAIL, GUARDIAN_EMAIL],
  subject: SUBJECT,
  html: `<p>Hallo ${CANARY_NAME}, je afspraak staat vast (${CANARY_EMAIL}).</p>`,
  text: `Hallo ${CANARY_NAME}, je afspraak staat vast (${CANARY_EMAIL}).`,
  replyTo: CANARY_EMAIL,
};

function settings(overrides: Partial<ResolvedEmailSettings> = {}): ResolvedEmailSettings {
  return {
    apiKey: API_KEY,
    apiKeySource: 'setting',
    from: 'De Bikefit Studio <afspraken@studio.test>',
    fromSource: 'setting',
    replyTo: '',
    replyToSource: 'none',
    recipient: { address: '', source: 'none', invalid: false },
    ...overrides,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stubFetch(reply: () => Promise<Response>) {
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    void url;
    void init;
    return reply();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Every console call of the test, one entry per call, `level: text`. */
let output: string[] = [];

function render(arg: unknown): string {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack ?? ''}`;
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

beforeEach(() => {
  output = [];
  for (const level of ['debug', 'info', 'log', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      output.push(`${level}: ${args.map(render).join(' ')}`);
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function expectNoLeak(text: string, where: string) {
  for (const needle of FORBIDDEN) {
    expect(text.toLowerCase(), `${where} must not contain “${needle}”`).not.toContain(
      needle.toLowerCase(),
    );
  }
}

/** Nothing personal or secret in the logs, the reason or what the admin would see. */
function expectSafe(result: SendEmailResult) {
  const logs = output.join('\n');
  expectNoLeak(logs, 'console output');
  // No address of any kind (recipient, sender, reply-to), masked or not.
  expect(logs, 'console output must not contain an address').not.toContain('@');
  if (!result.sent) {
    expectNoLeak(result.reason, 'reason');
    expect(result.reason, 'reason must not contain an address').not.toContain('@');
    expectNoLeak(describeSendFailure(result.reason), 'admin message');
  }
  expect(loadEmailSettings).not.toHaveBeenCalled();
}

describe('sendEmail: no personal data in logs or reasons', () => {
  it('no API key: not sent, one line with the recipient count only', async () => {
    const fetchMock = stubFetch(async () => json(200, { id: 'em_never' }));
    const result = await sendEmail(MAIL, settings({ apiKey: null, apiKeySource: 'none' }));
    expectSafe(result);
    expect(result).toEqual({ sent: false, reason: 'not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(output).toHaveLength(1);
    expect(output[0]).toMatch(/^info: \[email\] /);
    expect(output[0]).toContain('2 ontvangers');
  });

  it('Resend refuses (422) with a message echoing the request: status and error code only', async () => {
    stubFetch(async () =>
      json(422, {
        statusCode: 422,
        name: 'validation_error',
        message: `Invalid \`to\` field: ${CANARY_EMAIL} (${CANARY_NAME}), subject “${SUBJECT}”, key ${API_KEY}`,
      }),
    );
    const result = await sendEmail(MAIL, settings());
    expectSafe(result);
    expect(result).toEqual({ sent: false, reason: 'HTTP 422: validation_error' });
    expect(output).toHaveLength(1);
    expect(output[0]).toMatch(/^error: \[email\] /);
    expect(output[0]).toContain('HTTP 422: validation_error');
    expect(output[0]).toContain('2 ontvangers');
  });

  it('fetch throws an error whose message holds personal data: only the error name', async () => {
    stubFetch(async () => {
      throw new Error(`request for ${CANARY_NAME} <${CANARY_EMAIL}> failed: “${SUBJECT}”`);
    });
    const result = await sendEmail(MAIL, settings());
    expectSafe(result);
    expect(result).toEqual({ sent: false, reason: 'request_failed: Error' });
    expect(output).toHaveLength(1);
    expect(output[0]).toMatch(/^error: \[email\] /);
    expect(output[0]).toContain('request_failed: Error');
  });

  it.each<[string, unknown]>([
    ['free text with personal data', `${CANARY_NAME} <${CANARY_EMAIL}>`],
    ['not lower-case snake case', 'Validation Error'],
    ['longer than 64 characters', 'x'.repeat(65)],
    ['not a string', 42],
    ['missing', undefined],
  ])('a Resend error name that is %s is dropped: the status remains', async (_label, name) => {
    stubFetch(async () => json(403, { name, message: `Refused for ${CANARY_EMAIL}` }));
    const result = await sendEmail(MAIL, settings());
    expectSafe(result);
    expect(result).toEqual({ sent: false, reason: 'HTTP 403' });
  });

  it('a refusal without a JSON body keeps the status line', async () => {
    stubFetch(
      async () => new Response(`<h1>Bad gateway for ${CANARY_EMAIL}</h1>`, { status: 502 }),
    );
    const result = await sendEmail(MAIL, settings());
    expectSafe(result);
    expect(result).toEqual({ sent: false, reason: 'HTTP 502' });
  });

  it('still redacts a key-shaped value that passes the code pattern (defence in depth)', async () => {
    const lowerCaseKey = 're_only_lower_case_letters';
    stubFetch(async () => json(401, { name: lowerCaseKey, message: 'API key is invalid' }));
    const result = await sendEmail(MAIL, settings({ apiKey: lowerCaseKey }));
    expectSafe(result);
    expect(result.sent).toBe(false);
    expect(JSON.stringify({ result, output })).not.toContain(lowerCaseKey);
  });

  it.each<[string, unknown, string]>([
    [
      'a timeout',
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
      'request_failed: TimeoutError',
    ],
    [
      'a network error',
      new TypeError(`fetch failed for ${CANARY_EMAIL}`),
      'request_failed: TypeError',
    ],
    ['a thrown string', `${CANARY_NAME} <${CANARY_EMAIL}>`, 'request_failed: unknown'],
    [
      'an error with a free-text name',
      Object.assign(new Error('boom'), { name: CANARY_NAME }),
      'request_failed: unknown',
    ],
  ])('%s is reported by name only', async (_label, thrown, reason) => {
    stubFetch(async () => {
      throw thrown;
    });
    const result = await sendEmail(MAIL, settings());
    expectSafe(result);
    expect(result).toEqual({ sent: false, reason });
    expect(output).toHaveLength(1);
    expect(output[0]).toContain(reason);
  });

  it('no sender: not sent, nothing personal logged, no provider call', async () => {
    const fetchMock = stubFetch(async () => json(200, { id: 'em_never' }));
    const result = await sendEmail(MAIL, settings({ from: '', fromSource: 'none' }));
    expectSafe(result);
    expect(result).toEqual({ sent: false, reason: 'missing_from' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no recipient: not sent, without reading the settings', async () => {
    const fetchMock = stubFetch(async () => json(200, { id: 'em_never' }));
    const result = await sendEmail({ ...MAIL, to: ['  '] });
    expectSafe(result);
    expect(result).toEqual({ sent: false, reason: 'no_recipient' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a successful send gives Resend the full message and logs nothing', async () => {
    const fetchMock = stubFetch(async () => json(200, { id: 'em_canary' }));
    const result = await sendEmail(MAIL, settings());
    expectSafe(result);
    expect(result).toEqual({ sent: true, id: 'em_canary' });
    expect(output).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.resend.com/emails');
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${API_KEY}`);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      from: 'De Bikefit Studio <afspraken@studio.test>',
      to: [CANARY_EMAIL, GUARDIAN_EMAIL],
      subject: SUBJECT,
      reply_to: CANARY_EMAIL,
    });
  });
});
