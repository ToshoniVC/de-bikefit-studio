/**
 * Booking failures in the server log, without personal data or secrets
 * (CLAUDE.md §4, "Logging"), and the unique-violation check for the insert.
 *
 * No part of a caught error reaches the log. Drizzle throws every failed query
 * as a `DrizzleQueryError` whose message is `Failed query: <sql>\nparams:
 * <every bound value>` and whose `query`, `params` and `cause` are enumerable;
 * the driver error behind it repeats the SQL and params, or adds the failing
 * row or a raw HTTP body. For a booking that is names, e-mail addresses, phone
 * numbers, the notes, the address and the cancel-token hash. Even an error's
 * `name` or `code` is left out: the thrower decides what is in it, and a shape
 * check does not prove it holds nothing else.
 *
 * So `logBookingFailure()` takes no error. It writes `[booking] <event>` and
 * `{ event, bookingId? }`: a fixed code for the step that failed, and the
 * booking id only when it is a UUID.
 *
 * Pure (no database, no Next): tested in `booking-log.test.ts`.
 */

/** The step that failed. Fixed codes only; never build one from an error or the input. */
export type BookingLogEvent =
  // Public flows (`public-booking.ts`).
  | 'create_failed'
  | 'cancel_failed'
  | 'google_event_failed'
  | 'google_delete_failed'
  | 'confirmation_mail_failed'
  | 'cancellation_mail_failed'
  // The widget's server actions (`public-actions.ts`).
  | 'availability_action_failed'
  | 'book_action_failed'
  | 'cancel_action_failed'
  | 'confirmation_ref_unsigned'
  // Cancelling from the admin (`cancelBooking()` in `repo.ts`).
  | 'admin_google_delete_failed'
  | 'admin_cancellation_mail_failed'
  // Assigning an "Iedereen" booking to a provider (`assignBooking()` in `repo-assignment.ts`).
  | 'assign_google_failed'
  | 'assign_mail_failed';

/** Booking ids come from `crypto.randomUUID()` (`cms-schema.ts`); anything else is left out. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Errors `isUniqueViolation()` looks at; real chains are two to four long. */
const MAX_LINKS = 8;
/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

/** A property, or `undefined` when reading it throws (a getter, a revoked proxy). */
function read(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/**
 * Logs a booking failure as `[booking] <event>` and `{ event, bookingId? }`.
 * Takes no error, so the catch block that calls it binds none (`catch {`).
 * Never throws: the id is only tested when it is a string.
 */
export function logBookingFailure(event: BookingLogEvent, bookingId?: string | null): void {
  const id = typeof bookingId === 'string' && UUID_RE.test(bookingId) ? { bookingId } : {};
  console.error(`[booking] ${event}`, { event, ...id });
}

/**
 * Whether a failed insert hit a unique index (two visitors, one slot): SQLSTATE
 * `23505` on the error or on one of its causes. Behind Drizzle's
 * `DrizzleQueryError`, both drivers put it in `code` (Neon's `NeonDbError`,
 * PGlite's `DatabaseError`).
 *
 * Deliberately no fallback on the message text. A `DrizzleQueryError`'s
 * message holds every bound value and PGlite's error carries the params too,
 * so a visitor who writes "duplicate key" in the notes could turn any failed
 * insert into `slot_taken`; Postgres messages can also quote input values.
 * The code is set by the server, never by the visitor.
 */
export function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;
  for (let depth = 0; depth < MAX_LINKS; depth += 1) {
    if (typeof current !== 'object' || current === null || seen.has(current)) return false;
    seen.add(current);
    if (read(current, 'code') === UNIQUE_VIOLATION) return true;
    current = read(current, 'cause');
  }
  return false;
}
