import { describe, expect, it } from 'vitest';
import { GoogleApiError } from './google';
import { describeProviderError } from './provider-calendar-errors';

// `./google` is imported only to build the exact errors it throws. That is safe:
// `server-only` is stubbed in vitest.config.ts and nothing in it runs at import.
// The module under test does not import it.

const GENERIC = 'De synchronisatie met Google Agenda is mislukt.';

/** Distinctive dummy values that must never end up in a stored sync error. */
const DUMMY = {
  accessToken: 'ya29.DUMMY-access-token-q7w8e9',
  encryptedToken: 'v1.DUMMYiv.DUMMYtag.DUMMYencryptedAccessToken',
  providerId: '0d0d0d0d-dummy-provider-id-0d0d0d0d',
  eventId: 'dummyeventidqwerty',
  customerName: 'Jana Dummyvoorbeeld',
  email: 'jana.dummy@example.test',
  phone: '+32 470 00 00 01',
  address: 'Dummystraat 42, 9400 Ninove',
  notes: 'Dummy-opmerking over knieklachten',
};

function expectNoneOf(text: string, values: readonly string[]): void {
  for (const value of values) expect(text).not.toContain(value);
}

function describeGoogle(status: number, code: string | null = null): string {
  return describeProviderError(new GoogleApiError('Tekst van Google', status, code));
}

describe('describeProviderError', () => {
  it('keeps the specific message for a revoked or expired Google grant', () => {
    const error = new GoogleApiError('Token has been expired or revoked.', 400, 'invalid_grant');
    expect(describeProviderError(error)).toBe(
      'Google-toegang is ingetrokken of verlopen. Verbind Google Agenda opnieuw.',
    );
  });

  it("never repeats Google's text, only the HTTP status and a short code", () => {
    // The event description createProviderEvent() sends, echoed back by Google.
    const description = [
      `Klant: ${DUMMY.customerName}`,
      `E-mail: ${DUMMY.email}`,
      `Telefoon: ${DUMMY.phone}`,
      `Opmerkingen: ${DUMMY.notes}`,
    ].join('\n');
    const message = [
      `Invalid event ${DUMMY.eventId} (Bearer ${DUMMY.accessToken}):`,
      description,
      `location: ${DUMMY.address}`,
    ].join('\n');
    const body = { error: { code: 400, message, errors: [{ reason: 'invalid', message }] } };
    const error = Object.assign(new GoogleApiError(message, 400, 'invalid'), { body });

    const text = describeProviderError(error);
    expect(text).toBe('Google Agenda gaf een fout (HTTP 400, invalid).');
    expectNoneOf(text, Object.values(DUMMY));
  });

  it('keeps only an HTTP error status and a lowercase machine code', () => {
    expect(describeGoogle(401, 'invalid_client')).toBe(
      'Google Agenda gaf een fout (HTTP 401, invalid_client).',
    );
    expect(describeGoogle(503)).toBe('Google Agenda gaf een fout (HTTP 503).');
    expect(describeGoogle(404, 'NOT_FOUND')).toBe('Google Agenda gaf een fout (HTTP 404).');
    expect(describeGoogle(400, `Bearer ${DUMMY.accessToken}`)).toBe(
      'Google Agenda gaf een fout (HTTP 400).',
    );
    expect(describeGoogle(400, 'a'.repeat(41))).toBe('Google Agenda gaf een fout (HTTP 400).');
    // google.ts also throws with status 0 (not configured) and 200 (calendar unreadable).
    expect(describeGoogle(0, 'not_configured')).toBe(
      'Google Agenda gaf een fout (not_configured).',
    );
    expect(describeGoogle(200, 'notFound')).toBe('Google Agenda gaf een fout.');
  });

  it('never repeats SQL, bound parameters or the driver error of a failed query', () => {
    // The shape drizzle-orm throws (`DrizzleQueryError`) when the token update fails.
    const query =
      'update "cms_providers" set "google_access_token" = $1, "google_access_expires_at" = $2, ' +
      '"google_sync_error" = $3, "updated_at" = $4 where "cms_providers"."id" = $5';
    const params = [
      DUMMY.encryptedToken,
      '2026-10-14T10:00:00.000Z',
      null,
      '2026-10-14T09:00:00.000Z',
      DUMMY.providerId,
    ];
    const cause = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      detail: `Key (id)=(${DUMMY.providerId}) already exists.`,
      constraint: 'cms_providers_pkey',
    });
    const message = `Failed query: ${query}\nparams: ${params.join(',')}`;
    const error = Object.assign(new Error(message), { query, params, cause });

    const text = describeProviderError(error);
    expect(text).toBe(GENERIC);
    expectNoneOf(text, [DUMMY.encryptedToken, DUMMY.providerId]);
    expectNoneOf(text, ['Failed query', 'cms_providers', '23505', 'already exists']);

    error.name = 'DrizzleQueryError';
    expect(describeProviderError(error)).toBe(
      'De synchronisatie met Google Agenda is mislukt (DrizzleQueryError).',
    );
  });

  it('adds at most a plain error class name, never the message', () => {
    expect(describeProviderError(new TypeError(`fetch failed for ${DUMMY.email}`))).toBe(
      'De synchronisatie met Google Agenda is mislukt (TypeError).',
    );
    const timeout = new Error(DUMMY.accessToken);
    timeout.name = 'TimeoutError';
    expect(describeProviderError(timeout)).toBe(
      'De synchronisatie met Google Agenda is mislukt (TimeoutError).',
    );
    const odd = new Error('x');
    odd.name = `Error: ${DUMMY.accessToken}`;
    expect(describeProviderError(odd)).toBe(GENERIC);
    const long = new Error('x');
    long.name = 'A'.repeat(65);
    expect(describeProviderError(long)).toBe(GENERIC);
  });

  it('falls back to the generic message for anything that is not an Error', () => {
    const values: unknown[] = [
      `Failed query: select 1\nparams: ${DUMMY.email}`,
      { name: 'Leaky', message: DUMMY.accessToken, code: 'invalid' },
      { name: 'GoogleApiError', message: DUMMY.accessToken, code: 'invalid', status: 400 },
      null,
      undefined,
      42,
    ];
    for (const value of values) expect(describeProviderError(value)).toBe(GENERIC);
  });
});
