import { format } from 'date-fns';
import { nl } from 'date-fns/locale';
import { TZDate, tzOffset } from '@date-fns/tz';

/**
 * Time-zone helpers for booking. Plain module (no `server-only`, no database)
 * so scripts, server code and client components can all use it.
 *
 * Conventions used across `src/lib/booking/**`:
 *  - an **instant** is a UTC moment: a `Date` or an ISO 8601 string ending in `Z`;
 *  - a **local date** is `YYYY-MM-DD` in the booking time zone;
 *  - a **local minute** is minutes since local midnight (0–1440), the unit of
 *    `cms_business_hours` and `cms_availability_exceptions`.
 *
 * Local wall-clock → instant goes through `tzOffset` (two-pass, DST-safe);
 * instant → wall clock goes through `TZDate`. Both come from `@date-fns/tz`.
 */

export const BOOKING_TIMEZONE = 'Europe/Brussels';

export type Instant = Date | string | number;

export type LocalParts = {
  /** `YYYY-MM-DD` in the given zone. */
  dateYmd: string;
  /** Minutes since local midnight. */
  minute: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
};

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function toDate(instant: Instant): Date {
  return instant instanceof Date ? instant : new Date(instant);
}

/**
 * `true` for an IANA time zone the runtime knows (`Europe/Brussels`, `UTC`);
 * `false` for anything else, the empty string included. The one time-zone
 * check for forms, actions and repo schemas (CLAUDE.md §3).
 */
export function isValidTimeZone(tz: string): boolean {
  if (typeof tz !== 'string' || tz.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidYmd(value: string): boolean {
  const match = YMD_RE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

function parseYmd(dateYmd: string): [number, number, number] {
  const match = YMD_RE.exec(dateYmd);
  if (!match) throw new Error(`Ongeldige datum: ${dateYmd}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** An instant viewed in `tz` — a `TZDate`, usable with every date-fns function. */
export function zoned(dateIso: Instant, tz: string = BOOKING_TIMEZONE): TZDate {
  return new TZDate(+toDate(dateIso), tz);
}

/**
 * The UTC instant of `minute` minutes after local midnight on `dateYmd` in
 * `tz`. `minute` may be 1440 (next midnight). Times inside a spring-forward
 * gap resolve to the instant one hour later; ambiguous fall-back times resolve
 * to the later (winter-time) occurrence. `computeSlots` skips both cases via
 * {@link isExactLocalTime}.
 */
export function localMinutesToInstant(
  dateYmd: string,
  minute: number,
  tz: string = BOOKING_TIMEZONE,
): Date {
  const [y, m, d] = parseYmd(dateYmd);
  const wallAsUtc = Date.UTC(y, m - 1, d, 0, minute);
  // Two passes: the offset at the first guess can differ from the offset at
  // the answer when a DST switch lies in between.
  let guess = wallAsUtc - tzOffset(tz, new Date(wallAsUtc)) * 60_000;
  guess = wallAsUtc - tzOffset(tz, new Date(guess)) * 60_000;
  return new Date(guess);
}

/** Local date, minute and weekday of an instant in `tz`. */
export function instantToLocal(instant: Instant, tz: string = BOOKING_TIMEZONE): LocalParts {
  const z = zoned(instant, tz);
  return {
    dateYmd: format(z, 'yyyy-MM-dd'),
    minute: z.getHours() * 60 + z.getMinutes(),
    weekday: z.getDay(),
  };
}

/** True when `minute` on `dateYmd` exists exactly once on the local clock. */
export function isExactLocalTime(
  dateYmd: string,
  minute: number,
  tz: string = BOOKING_TIMEZONE,
): boolean {
  const instant = localMinutesToInstant(dateYmd, minute, tz);
  const back = instantToLocal(instant, tz);
  if (back.dateYmd !== dateYmd || back.minute !== minute) return false; // DST gap
  // Ambiguous (fall-back) when the same wall time also exists one hour earlier.
  const earlier = instantToLocal(new Date(instant.getTime() - 60 * 60_000), tz);
  return !(earlier.dateYmd === dateYmd && earlier.minute === minute);
}

/** Today's local date in `tz`. */
export function todayYmd(now: Instant = new Date(), tz: string = BOOKING_TIMEZONE): string {
  return instantToLocal(now, tz).dateYmd;
}

/** Calendar arithmetic on `YYYY-MM-DD` strings (time-zone free). */
export function addDaysYmd(dateYmd: string, days: number): string {
  const [y, m, d] = parseYmd(dateYmd);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, for a local date. */
export function weekdayOfYmd(dateYmd: string): number {
  const [y, m, d] = parseYmd(dateYmd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function diffDaysYmd(a: string, b: string): number {
  const [ay, am, ad] = parseYmd(a);
  const [by, bm, bd] = parseYmd(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Every local date from `fromYmd` to `toYmd`, both inclusive. */
export function eachDayYmd(fromYmd: string, toYmd: string): string[] {
  const days: string[] = [];
  for (let day = fromYmd; day <= toYmd; day = addDaysYmd(day, 1)) days.push(day);
  return days;
}

/** `540` → `'09:00'`. */
export function minutesToHhmm(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** `'09:30'` → `570`; `'24:00'` → `1440`; null when malformed. */
export function hhmmToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (m > 59 || h > 24 || (h === 24 && m !== 0)) return null;
  return h * 60 + m;
}

/** `'09:30'` in `tz`. */
export function formatTime(instant: Instant, tz: string = BOOKING_TIMEZONE): string {
  return format(zoned(instant, tz), 'HH:mm');
}

/** `'zaterdag 24 oktober 2026'` in `tz`. */
export function formatDateLong(instant: Instant, tz: string = BOOKING_TIMEZONE): string {
  return format(zoned(instant, tz), 'EEEE d MMMM yyyy', { locale: nl });
}

/** `'za 24 okt'` in `tz`. */
export function formatDateShort(instant: Instant, tz: string = BOOKING_TIMEZONE): string {
  return format(zoned(instant, tz), 'EEEEEE d MMM', { locale: nl });
}

/** `'zaterdag 24 oktober 2026 om 09:30'` in `tz` — the label used in e-mails. */
export function formatSlot(instant: Instant, tz: string = BOOKING_TIMEZONE): string {
  return format(zoned(instant, tz), "EEEE d MMMM yyyy 'om' HH:mm", { locale: nl });
}

/** `'09:30 – 11:00'` in `tz`. */
export function formatTimeRange(
  start: Instant,
  end: Instant,
  tz: string = BOOKING_TIMEZONE,
): string {
  return `${formatTime(start, tz)} – ${formatTime(end, tz)}`;
}

/** ISO string of an instant (normalises Date | string | number). */
export function toIso(instant: Instant): string {
  return toDate(instant).toISOString();
}
