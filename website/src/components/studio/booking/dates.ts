/**
 * Calendar helpers for the booking widget. Pure functions, safe on the server
 * and in the browser.
 *
 * Two kinds of value, never mixed:
 *  - `Ymd` (`YYYY-MM-DD`) and `Ym` (`YYYY-MM`) are *local calendar* dates in
 *    the booking time zone. Calendar arithmetic on them runs on UTC-midnight
 *    `Date`s, so a DST switch can never shift a day.
 *  - instants (`startsAt`) are ISO strings in UTC; they are only ever turned
 *    into local dates and times through `Intl` with an explicit `timeZone`.
 *
 * Dutch names are spelled out here rather than taken from `Intl`, so the
 * calendar reads the same regardless of the ICU data a browser ships.
 */

export type Ymd = string;
export type Ym = string;

export const MONTHS_NL = [
  'januari',
  'februari',
  'maart',
  'april',
  'mei',
  'juni',
  'juli',
  'augustus',
  'september',
  'oktober',
  'november',
  'december',
] as const;

/** Monday first, as a Belgian calendar reads. */
export const WEEKDAYS_NL = [
  'maandag',
  'dinsdag',
  'woensdag',
  'donderdag',
  'vrijdag',
  'zaterdag',
  'zondag',
] as const;

export const WEEKDAYS_SHORT_NL = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'] as const;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function split(ymd: Ymd): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split('-').map(Number);
  return { y, m, d: d || 1 };
}

function toUtc(ymd: Ymd): Date {
  const { y, m, d } = split(ymd);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(date: Date): Ymd {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(toUtc(value).getTime());
}

export function addDays(ymd: Ymd, days: number): Ymd {
  const date = toUtc(ymd);
  date.setUTCDate(date.getUTCDate() + days);
  return fromUtc(date);
}

export function monthOf(ymd: Ymd): Ym {
  return ymd.slice(0, 7);
}

export function addMonths(ym: Ym, months: number): Ym {
  const { y, m } = split(`${ym}-01`);
  const date = new Date(Date.UTC(y, m - 1 + months, 1));
  return fromUtc(date).slice(0, 7);
}

export function firstDayOfMonth(ym: Ym): Ymd {
  return `${ym}-01`;
}

export function lastDayOfMonth(ym: Ym): Ymd {
  return addDays(firstDayOfMonth(addMonths(ym, 1)), -1);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(ymd: Ymd): number {
  return (toUtc(ymd).getUTCDay() + 6) % 7;
}

/**
 * The month as full Monday-to-Sunday weeks. Days outside the month are
 * `null`, so the grid always has 7 columns and 4–6 rows.
 */
export function monthWeeks(ym: Ym): (Ymd | null)[][] {
  const first = firstDayOfMonth(ym);
  const last = lastDayOfMonth(ym);
  const cells: (Ymd | null)[] = Array.from({ length: weekdayIndex(first) }, () => null);
  for (let day = first; day <= last; day = addDays(day, 1)) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (Ymd | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function minYmd(a: Ymd, b: Ymd): Ymd {
  return a <= b ? a : b;
}

export function maxYmd(a: Ymd, b: Ymd): Ymd {
  return a >= b ? a : b;
}

// --- Dutch labels ------------------------------------------------------------

/** "september 2026" */
export function monthTitle(ym: Ym): string {
  const { y, m } = split(`${ym}-01`);
  return `${MONTHS_NL[m - 1]} ${y}`;
}

/** "dinsdag 29 september 2026" */
export function longDate(ymd: Ymd): string {
  const { y, m, d } = split(ymd);
  return `${WEEKDAYS_NL[weekdayIndex(ymd)]} ${d} ${MONTHS_NL[m - 1]} ${y}`;
}

/** "di 29 sep" — compact, for summaries on small screens. */
export function shortDate(ymd: Ymd): string {
  const { m, d } = split(ymd);
  return `${WEEKDAYS_SHORT_NL[weekdayIndex(ymd)]} ${d} ${MONTHS_NL[m - 1].slice(0, 3)}`;
}

// --- instants in the booking time zone ----------------------------------------

const ymdFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function ymdFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = ymdFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    ymdFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function timeFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = timeFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('nl-BE', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    timeFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The local calendar date of an instant in `timeZone`. */
export function instantToYmd(instant: string | Date, timeZone: string): Ymd {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  const parts = ymdFormatter(timeZone).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** "09:30" in `timeZone`. */
export function instantToTime(instant: string | Date, timeZone: string): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  return timeFormatter(timeZone).format(date);
}

/** "dinsdag 29 september 2026, 09:30–11:00" */
export function slotLabel(startsAt: string, endsAt: string, timeZone: string): string {
  return `${longDate(instantToYmd(startsAt, timeZone))}, ${instantToTime(startsAt, timeZone)}–${instantToTime(endsAt, timeZone)}`;
}

/** "90 minuten", the way the copy deck writes durations. */
export function durationLabel(minutes: number): string {
  return `${minutes} minuten`;
}
