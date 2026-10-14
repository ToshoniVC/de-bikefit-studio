import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { Ga4ReadError, toGa4ReadError } from './ga4-errors';

const PROPERTY = '123456789';

const NO_ACCESS =
  'Het serviceaccount heeft geen toegang tot property 123456789. Voeg het in GA4 toe als Kijker (Viewer).';
const API_DISABLED =
  'De Google Analytics Data API staat niet aan in het Google Cloud-project van het serviceaccount. Schakel ze in en probeer over enkele minuten opnieuw.';
const UNKNOWN_PROPERTY =
  'Google Analytics kent property 123456789 niet. Controleer de property-ID (een getal, geen G-…-meet-ID).';
const TOKEN_REFUSED =
  'Google weigerde het toegangstoken van het serviceaccount. Maak een nieuwe sleutel aan en werk GA4_SERVICE_ACCOUNT_JSON bij.';
const KEY_REFUSED =
  'De sleutel van het serviceaccount werd geweigerd (verwijderd of verlopen?). Maak een nieuwe JSON-sleutel aan en werk GA4_SERVICE_ACCOUNT_JSON bij.';
const TIMEOUT = 'Google Analytics antwoordde niet op tijd. Probeer het later opnieuw.';
const API_FAILED = 'Google Analytics gaf een fout. Probeer het later opnieuw.';
const GENERIC = 'Google Analytics kon niet worden gelezen. Probeer het later opnieuw.';

/** Dummy values that must never reach the admin panel or the server log. */
const KANARIE = {
  serviceAccount: 'sa-kanarie@lek-test.iam.gserviceaccount.com',
  keyId: 'kanarie-key-id',
  privateKey: 'kanarie-private-key',
};
/** A Data API error body that repeats the service account and the key id. */
const GOOGLE_BODY = `Caller does not have permission for ${KANARIE.serviceAccount}; key id ${KANARIE.keyId}`;
/** Checked in every admin text the tests produce. */
const FORBIDDEN = ['kanarie', 'lek-test', 'gserviceaccount', '@', GOOGLE_BODY];

function expectNoneOf(text: string, values: readonly string[]): void {
  for (const value of values) expect(text).not.toContain(value);
}

/** The shape `runReport()` in `ga4.ts` throws (`class Ga4ApiError`, not exported). */
function ga4ApiError(status: unknown, googleStatus: unknown, message = GOOGLE_BODY): Error {
  return Object.assign(new Error(message), { name: 'Ga4ApiError', status, googleStatus });
}

/** The admin text for `error`, after checking that no dummy fragment got through. */
function adminText(error: unknown, propertyId = PROPERTY): string {
  const text = toGa4ReadError(error, propertyId).description;
  expectNoneOf(text, FORBIDDEN);
  return text;
}

describe('toGa4ReadError: Data API errors (Ga4ApiError)', () => {
  it('keeps the fixed advice for a permission error, without the service account', () => {
    expect(adminText(ga4ApiError(403, 'PERMISSION_DENIED'))).toBe(NO_ACCESS);
    expect(adminText(ga4ApiError(403, ''))).toBe(NO_ACCESS);
  });

  it('recognises a disabled API by its wording without repeating it', () => {
    const disabled =
      'Google Analytics Data API has not been used in project 987650001 before or it is disabled. ' +
      `Enable it by visiting https://console.developers.google.com/apis/api/analyticsdata.googleapis.com/overview?project=987650001 (${KANARIE.serviceAccount})`;
    const text = adminText(ga4ApiError(403, 'PERMISSION_DENIED', disabled));
    expect(text).toBe(API_DISABLED);
    expectNoneOf(text, ['987650001', 'console.developers']);
    expect(adminText(ga4ApiError(403, 'PERMISSION_DENIED', 'SERVICE_DISABLED'))).toBe(API_DISABLED);
  });

  it('names the property for 400 and 404, and asks for a new key on 401', () => {
    expect(adminText(ga4ApiError(400, 'INVALID_ARGUMENT'))).toBe(UNKNOWN_PROPERTY);
    expect(adminText(ga4ApiError(404, 'NOT_FOUND'))).toBe(UNKNOWN_PROPERTY);
    expect(adminText(ga4ApiError(401, 'UNAUTHENTICATED'))).toBe(TOKEN_REFUSED);
  });

  it('names the property only when it is the numeric id', () => {
    expect(adminText(ga4ApiError(403, 'PERMISSION_DENIED'), KANARIE.serviceAccount)).toBe(
      'Het serviceaccount heeft geen toegang tot de property. Voeg het in GA4 toe als Kijker (Viewer).',
    );
    expect(adminText(ga4ApiError(404, 'NOT_FOUND'), `properties/${KANARIE.keyId}`)).toBe(
      'Google Analytics kent de property niet. Controleer de property-ID (een getal, geen G-…-meet-ID).',
    );
  });

  it('falls back to a fixed sentence with at most an integer HTTP error status', () => {
    const unavailable = toGa4ReadError(ga4ApiError(503, 'UNAVAILABLE'), PROPERTY);
    expect(unavailable.description).toBe(
      'Google Analytics gaf een fout (HTTP 503). Probeer het later opnieuw.',
    );
    expect(unavailable.status).toBe(503);
    expectNoneOf(unavailable.description, FORBIDDEN);
    expect(adminText(ga4ApiError(429, 'RESOURCE_EXHAUSTED'))).toBe(
      'Google Analytics gaf een fout (HTTP 429). Probeer het later opnieuw.',
    );

    for (const status of [200, 'x', '503', 503.5, 600, 399, 0, null, undefined, Number.NaN]) {
      const failure = toGa4ReadError(ga4ApiError(status, 'UNKNOWN'), PROPERTY);
      expect(failure.description, String(status)).toBe(API_FAILED);
      expect(failure.status, String(status)).toBeNull();
      expectNoneOf(failure.description, FORBIDDEN);
    }
  });
});

describe('toGa4ReadError: other errors', () => {
  it('recognises a refused key by its wording without repeating it', () => {
    expect(adminText(new Error(`invalid_grant: ${KANARIE.privateKey}`))).toBe(KEY_REFUSED);
    expect(adminText(new Error('No key or keyFile set.'))).toBe(KEY_REFUSED);
    // A token endpoint error from google-auth-library (gaxios), with its response.
    const gaxios = Object.assign(new Error(`invalid_client: unknown ${KANARIE.serviceAccount}`), {
      name: 'GaxiosError',
      status: 401,
      response: { data: { error: 'invalid_client', error_description: KANARIE.keyId } },
    });
    const failure = toGa4ReadError(gaxios, PROPERTY);
    expect(failure.description).toBe(KEY_REFUSED);
    // Only the Data API's status is reported; a token endpoint status says something else.
    expect(failure.status).toBeNull();
  });

  it('recognises a timeout by its name or wording without repeating it', () => {
    expect(
      adminText(new DOMException('The operation was aborted due to timeout', 'TimeoutError')),
    ).toBe(TIMEOUT);
    expect(adminText(Object.assign(new Error(KANARIE.privateKey), { name: 'TimeoutError' }))).toBe(
      TIMEOUT,
    );
    expect(adminText(new Error(`network timeout at ${KANARIE.serviceAccount}`))).toBe(TIMEOUT);
  });

  it('gives the generic sentence for any other error, never its message', () => {
    const errors: unknown[] = [
      new Error(`Unexpected token '<', "<html>${KANARIE.serviceAccount}" is not valid JSON`),
      new TypeError(`fetch failed for ${KANARIE.keyId}`),
      new Error('Geen toegangstoken ontvangen van Google.'),
    ];
    for (const error of errors) {
      const failure = toGa4ReadError(error, PROPERTY);
      expect(failure.description).toBe(GENERIC);
      expect(failure.status).toBeNull();
    }
  });

  it('gives the generic sentence for anything that is not an Error', () => {
    const values: unknown[] = [
      `invalid_grant: ${KANARIE.privateKey}`,
      { name: 'Ga4ApiError', status: 503, googleStatus: 'UNAVAILABLE', message: GOOGLE_BODY },
      null,
      undefined,
      42,
    ];
    for (const value of values) {
      const failure = toGa4ReadError(value, PROPERTY);
      expect(failure.description).toBe(GENERIC);
      expect(failure.status).toBeNull();
    }
  });

  it('never throws, even for an error whose properties throw', () => {
    const hostile = new Error(GOOGLE_BODY);
    Object.defineProperty(hostile, 'name', {
      get() {
        throw new Error(KANARIE.privateKey);
      },
    });
    const proxy = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error(KANARIE.privateKey);
        },
      },
    );
    for (const value of [hostile, proxy]) {
      const failure = toGa4ReadError(value, PROPERTY);
      expect(failure.description).toBe(GENERIC);
      expect(failure.status).toBeNull();
    }
  });
});

describe('Ga4ReadError', () => {
  it('carries only the fixed code, the Dutch text and the status, no cause', () => {
    const failure = toGa4ReadError(ga4ApiError(503, 'UNAVAILABLE'), PROPERTY);
    expect(failure).toBeInstanceOf(Ga4ReadError);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.name).toBe('Ga4ReadError');
    expect(failure.message).toBe('ga4_request_failed');
    expect(failure.cause).toBeUndefined();
    expect(Object.keys(failure).sort()).toEqual(['description', 'name', 'status']);
  });

  it('prints nothing of the original error (what Next logs for a failed refresh)', () => {
    const gaxios = Object.assign(new Error(`invalid_grant: ${KANARIE.privateKey}`), {
      name: 'GaxiosError',
      response: { data: { error_description: GOOGLE_BODY } },
    });
    for (const error of [ga4ApiError(403, 'PERMISSION_DENIED'), gaxios]) {
      // The stack shows file paths (`node_modules/@vitest/…`), so no check on '@' here.
      const printed = inspect(toGa4ReadError(error, PROPERTY), { depth: 10 });
      expectNoneOf(printed, ['kanarie', 'lek-test', 'gserviceaccount', GOOGLE_BODY]);
    }
  });

  it('passes an existing Ga4ReadError through unchanged', () => {
    const first = toGa4ReadError(ga4ApiError(403, 'PERMISSION_DENIED'), PROPERTY);
    expect(toGa4ReadError(first, 'iets anders')).toBe(first);
    expect(first.description).toBe(NO_ACCESS);
  });
});
