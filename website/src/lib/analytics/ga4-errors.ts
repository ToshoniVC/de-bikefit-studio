/**
 * What the admin's analytics panel and the server log get to see when the GA4
 * reader (`ga4.ts`) cannot read Google Analytics.
 *
 * Fixed Dutch text plus validated facts only, never an error's message, stack
 * or cause (CLAUDE.md §4): the Data API's error text and the token endpoint's
 * `error_description` are Google's words, and a `google-auth-library` error
 * can carry the service-account e-mail, the key id or an HTTP body. A message
 * is only tested, to pick one of the fixed sentences; it is never copied. The
 * facts: the property id when it is digits only (what `normalizePropertyId()`
 * returns) and the Data API's HTTP error status (an integer, 400–599).
 *
 * Pure: no `server-only`, env, Next or `google-auth-library` imports. That is
 * why the `Ga4ApiError` thrown by `runReport()` in `ga4.ts` is recognised by
 * its shape: the class sets `name = 'Ga4ApiError'` and carries the HTTP
 * `status` and Google's `googleStatus` (`PERMISSION_DENIED`, …).
 */

/** What `normalizePropertyId()` in `ga4.ts` returns; anything else is left out. */
const PROPERTY_ID_RE = /^\d{4,20}$/;
/** Google's wording when the Data API is switched off in the Cloud project. */
const API_DISABLED_RE = /has not been used|disabled|service_disabled/i;
/** The token endpoint refused the key (`invalid_grant: …`), or there is none. */
const KEY_REFUSED_RE = /invalid_grant|invalid_client|account not found|no key/i;
/** `AbortSignal.timeout()`: "The operation was aborted due to timeout". */
const TIMEOUT_RE = /timeout|aborted/i;

const GENERIC = 'Google Analytics kon niet worden gelezen. Probeer het later opnieuw.';

type Ga4ApiErrorShape = Error & { status?: unknown; googleStatus?: unknown };

function isGa4ApiError(error: unknown): error is Ga4ApiErrorShape {
  return error instanceof Error && error.name === 'Ga4ApiError';
}

/** An integer HTTP error status (400–599); anything else (0, 200, `'503'`, 503.5) → null. */
function httpErrorStatus(status: unknown): number | null {
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : null;
}

/** `property 123456789`, or `de property` when the id is not the numeric one. */
function propertyLabel(propertyId: string): string {
  return PROPERTY_ID_RE.test(propertyId) ? `property ${propertyId}` : 'de property';
}

function describeApiError(error: Ga4ApiErrorShape, propertyId: string): string {
  if (error.googleStatus === 'PERMISSION_DENIED' || error.status === 403) {
    if (API_DISABLED_RE.test(error.message)) {
      return 'De Google Analytics Data API staat niet aan in het Google Cloud-project van het serviceaccount. Schakel ze in en probeer over enkele minuten opnieuw.';
    }
    return `Het serviceaccount heeft geen toegang tot ${propertyLabel(propertyId)}. Voeg het in GA4 toe als Kijker (Viewer).`;
  }
  if (error.status === 400 || error.status === 404) {
    return `Google Analytics kent ${propertyLabel(propertyId)} niet. Controleer de property-ID (een getal, geen G-…-meet-ID).`;
  }
  if (error.status === 401) {
    return 'Google weigerde het toegangstoken van het serviceaccount. Maak een nieuwe sleutel aan en werk GA4_SERVICE_ACCOUNT_JSON bij.';
  }
  const status = httpErrorStatus(error.status);
  return status === null
    ? 'Google Analytics gaf een fout. Probeer het later opnieuw.'
    : `Google Analytics gaf een fout (HTTP ${status}). Probeer het later opnieuw.`;
}

/** Errors from `google-auth-library` (signing, token endpoint) and the network. */
function describeOtherError(error: unknown): string {
  if (!(error instanceof Error)) return GENERIC;
  if (KEY_REFUSED_RE.test(error.message)) {
    return 'De sleutel van het serviceaccount werd geweigerd (verwijderd of verlopen?). Maak een nieuwe JSON-sleutel aan en werk GA4_SERVICE_ACCOUNT_JSON bij.';
  }
  if (
    error.name === 'TimeoutError' ||
    error.name === 'AbortError' ||
    TIMEOUT_RE.test(error.message)
  ) {
    return 'Google Analytics antwoordde niet op tijd. Probeer het later opnieuw.';
  }
  return GENERIC;
}

/**
 * The error the GA4 loader in `ga4.ts` throws and catches instead of Google's:
 * the admin text and the Data API's HTTP status, decided while the original
 * error is still at hand. Its message is the fixed log code and it has no
 * `cause`, because Next logs a failed background refresh of a stale
 * `unstable_cache` entry with the thrown error in full.
 */
export class Ga4ReadError extends Error {
  /** Dutch, safe to show to an admin. */
  readonly description: string;
  /** The Data API's HTTP error status (400–599), or null. */
  readonly status: number | null;

  constructor(description: string, status: number | null) {
    super('ga4_request_failed');
    this.name = 'Ga4ReadError';
    this.description = description;
    this.status = status;
  }
}

/**
 * Why GA4 could not be read, as a {@link Ga4ReadError} (`error` itself when it
 * already is one). Never throws: a getter or proxy that does gives the
 * generic sentence.
 */
export function toGa4ReadError(error: unknown, propertyId: string): Ga4ReadError {
  try {
    if (error instanceof Ga4ReadError) return error;
    if (isGa4ApiError(error)) {
      return new Ga4ReadError(describeApiError(error, propertyId), httpErrorStatus(error.status));
    }
    return new Ga4ReadError(describeOtherError(error), null);
  } catch {
    return new Ga4ReadError(GENERIC, null);
  }
}
