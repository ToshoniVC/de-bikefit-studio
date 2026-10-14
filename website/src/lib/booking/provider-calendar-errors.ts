/**
 * The text stored as a Google sync error: `cms_providers.google_sync_error`
 * (shown on the admin's Google card) and `cms_bookings.google_sync_error`.
 *
 * Fixed Dutch text plus validated facts only, never an error's message, stack
 * or cause (CLAUDE.md §4): Google's error text can repeat the event and so the
 * customer's details, and a failed query reads `Failed query: <sql>\nparams:
 * <values>`, which for the token update includes the encrypted access token.
 *
 * Pure: no `server-only`, database or Next imports. That is why a
 * `GoogleApiError` is recognised by its shape rather than with `instanceof`:
 * importing the class from `./google` would also load `server-only`, the env
 * and the token key. The class sets `name = 'GoogleApiError'` and always has
 * `code` and `status`; the tests build the real class, so a change there shows.
 */

/** Google's machine code, e.g. `invalid_client`; anything else is left out. */
const GOOGLE_CODE_RE = /^[a-z_]{1,40}$/;
/** A JavaScript error class name, e.g. `TypeError` or `TimeoutError`. */
const ERROR_NAME_RE = /^[A-Za-z]{1,64}$/;

type GoogleApiErrorShape = Error & { code: unknown; status?: unknown };

function isGoogleApiError(error: unknown): error is GoogleApiErrorShape {
  return error instanceof Error && error.name === 'GoogleApiError' && 'code' in error;
}

/** `HTTP 503` for an HTTP error status; google.ts also uses 0 and 200, which say nothing. */
function httpStatus(status: unknown): string | null {
  if (typeof status !== 'number' || !Number.isInteger(status)) return null;
  return status >= 400 && status <= 599 ? `HTTP ${status}` : null;
}

function googleCode(code: unknown): string | null {
  return typeof code === 'string' && GOOGLE_CODE_RE.test(code) ? code : null;
}

/** The class name only (`TypeError`, `TimeoutError`); a bare `Error` adds nothing. */
function errorName(error: unknown): string | null {
  if (!(error instanceof Error) || error.name === 'Error') return null;
  return typeof error.name === 'string' && ERROR_NAME_RE.test(error.name) ? error.name : null;
}

/** Why a Google sync failed, in Dutch, safe to store and to show in the admin. */
export function describeProviderError(error: unknown): string {
  if (isGoogleApiError(error)) {
    if (error.code === 'invalid_grant') {
      return 'Google-toegang is ingetrokken of verlopen. Verbind Google Agenda opnieuw.';
    }
    const facts = [httpStatus(error.status), googleCode(error.code)].filter(Boolean);
    return facts.length > 0
      ? `Google Agenda gaf een fout (${facts.join(', ')}).`
      : 'Google Agenda gaf een fout.';
  }
  const name = errorName(error);
  return name
    ? `De synchronisatie met Google Agenda is mislukt (${name}).`
    : 'De synchronisatie met Google Agenda is mislukt.';
}
