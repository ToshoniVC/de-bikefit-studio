import type { BookingRules } from './settings';
import {
  BOOKING_TIMEZONE,
  diffDaysYmd,
  isExactLocalTime,
  isValidYmd,
  localMinutesToInstant,
  todayYmd,
  weekdayOfYmd,
  instantToLocal,
  type Instant,
} from './time';

/**
 * Slot computation — pure, synchronous, no database, no network. Everything it
 * needs is passed in, which is what makes it testable
 * (`scripts/cms-selftest.mts` § booking availability).
 *
 * For ONE provider and ONE local date, a slot start `t` is offered when:
 *
 *  1. `t` lies on the slot grid: local minute `m` with `m % slotStepMinutes === 0`
 *     (the grid is anchored at local midnight, so 09:00, 09:30, … for a 30 min
 *     step), and `m` exists exactly once on the local clock that day (the
 *     02:00–03:00 hour on DST-switch days is skipped);
 *  2. the fit `[t, t + duration)` lies inside one open range of that date:
 *     the weekday's business hours, minus a whole-day `closed` exception, plus
 *     `open` exceptions, minus partial `closed` exceptions;
 *  3. `[t, t + duration + bufferAfter)` overlaps no blocked interval. Blocked are
 *     Google busy intervals and existing non-cancelled bookings, each booking
 *     extended by its own buffer. Intervals are half-open: inclusive start,
 *     exclusive end, so a slot may start exactly when a busy block ends;
 *  4. `t >= now + minNoticeHours`;
 *  5. the date is not before today and at most `horizonDays` after today
 *     (local dates in `tz`).
 *
 * The buffer may run past closing time: with hours until 18:00 a 90-minute fit
 * can start at 16:30. It only has to be free of busy time and other bookings.
 *
 * "All providers" is the caller's job: run this per provider, concatenate, and
 * use {@link mergeSlots} to de-duplicate by start while keeping every free
 * provider id.
 */

export type BusinessHoursRow = { weekday: number; startMinute: number; endMinute: number };

export type AvailabilityExceptionRow = {
  /** `YYYY-MM-DD`, local. */
  date: string;
  /** `'closed'` or `'open'`. */
  kind: string;
  startMinute: number | null;
  endMinute: number | null;
};

export type BusyInterval = { start: Instant; end: Instant };

export type ExistingBooking = {
  startsAt: Instant;
  endsAt: Instant;
  /** Buffer after that booking; defaults to the rules' default buffer. */
  bufferAfterMinutes?: number | null;
  /** `cancelled` bookings are ignored. */
  status?: string;
};

export type SlotService = {
  durationMinutes: number;
  /** `null`/`undefined` → `rules.defaultBufferAfterMinutes`. */
  bufferAfterMinutes?: number | null;
};

export type SlotRules = Pick<
  BookingRules,
  'slotStepMinutes' | 'minNoticeHours' | 'horizonDays' | 'defaultBufferAfterMinutes'
>;

export type Slot = { startsAt: string; endsAt: string; providerId: string };

export type MergedSlot = { startsAt: string; endsAt: string; providerIds: string[] };

export type ComputeSlotsInput = {
  /** Local date, `YYYY-MM-DD`. */
  date: string;
  hours: BusinessHoursRow[];
  exceptions?: AvailabilityExceptionRow[];
  busy?: BusyInterval[];
  bookings?: ExistingBooking[];
  service: SlotService;
  rules: SlotRules;
  now: Instant;
  tz?: string;
  /** Copied onto every slot. */
  providerId?: string;
};

type Range = [number, number];

const MINUTE = 60_000;

/** Sorts, clamps to one day and merges overlapping or touching ranges. */
export function normalizeRanges(ranges: ReadonlyArray<Range>): Range[] {
  const sorted = ranges
    .map(([s, e]) => [Math.max(0, s), Math.min(1440, e)] as Range)
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && s < e)
    .sort((a, b) => a[0] - b[0]);
  const merged: Range[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

/** `ranges` minus `cuts`, both in local minutes. */
export function subtractRanges(ranges: ReadonlyArray<Range>, cuts: ReadonlyArray<Range>): Range[] {
  let result = normalizeRanges(ranges);
  for (const [cs, ce] of normalizeRanges(cuts)) {
    const next: Range[] = [];
    for (const [s, e] of result) {
      if (ce <= s || cs >= e) {
        next.push([s, e]);
        continue;
      }
      if (cs > s) next.push([s, cs]);
      if (ce < e) next.push([ce, e]);
    }
    result = next;
  }
  return result;
}

/**
 * Open ranges (local minutes) for one date: weekday hours, then exceptions.
 * A `closed` exception without minutes closes the whole day; with minutes it
 * cuts only that range. An `open` exception adds a range (also on a closed day).
 */
export function openRangesForDate(
  date: string,
  hours: ReadonlyArray<BusinessHoursRow>,
  exceptions: ReadonlyArray<AvailabilityExceptionRow> = [],
): Range[] {
  const weekday = weekdayOfYmd(date);
  const today = exceptions.filter((e) => e.date === date);
  const closedAllDay = today.some(
    (e) => e.kind === 'closed' && (e.startMinute == null || e.endMinute == null),
  );

  const base: Range[] = closedAllDay
    ? []
    : hours.filter((h) => h.weekday === weekday).map((h) => [h.startMinute, h.endMinute] as Range);
  const extra: Range[] = today
    .filter((e) => e.kind === 'open' && e.startMinute != null && e.endMinute != null)
    .map((e) => [e.startMinute as number, e.endMinute as number]);
  const cuts: Range[] = today
    .filter((e) => e.kind === 'closed' && e.startMinute != null && e.endMinute != null)
    .map((e) => [e.startMinute as number, e.endMinute as number]);

  return subtractRanges([...base, ...extra], cuts);
}

function ms(instant: Instant): number {
  return instant instanceof Date ? instant.getTime() : new Date(instant).getTime();
}

/** Every bookable start for one provider on one local date, sorted. */
export function computeSlots(input: ComputeSlotsInput): Slot[] {
  const tz = input.tz ?? BOOKING_TIMEZONE;
  const { date, rules, service } = input;
  const providerId = input.providerId ?? '';

  if (!isValidYmd(date)) return [];
  const step = Math.max(1, Math.floor(rules.slotStepMinutes));
  const duration = Math.floor(service.durationMinutes);
  if (!(duration > 0)) return [];
  const buffer = Math.max(0, service.bufferAfterMinutes ?? rules.defaultBufferAfterMinutes);

  const nowMs = ms(input.now);
  const today = todayYmd(nowMs, tz);
  const ahead = diffDaysYmd(today, date);
  if (ahead < 0 || ahead > rules.horizonDays) return [];
  const earliestStart = nowMs + rules.minNoticeHours * 60 * MINUTE;

  const blocked: Array<[number, number]> = [];
  for (const b of input.busy ?? []) {
    const s = ms(b.start);
    const e = ms(b.end);
    if (Number.isFinite(s) && Number.isFinite(e) && s < e) blocked.push([s, e]);
  }
  for (const b of input.bookings ?? []) {
    if (b.status === 'cancelled') continue;
    const s = ms(b.startsAt);
    const e =
      ms(b.endsAt) + Math.max(0, b.bufferAfterMinutes ?? rules.defaultBufferAfterMinutes) * MINUTE;
    if (Number.isFinite(s) && Number.isFinite(e) && s < e) blocked.push([s, e]);
  }

  const slots: Slot[] = [];
  for (const [rangeStart, rangeEnd] of openRangesForDate(date, input.hours, input.exceptions)) {
    const rangeEndMs = localMinutesToInstant(date, rangeEnd, tz).getTime();
    for (let m = Math.ceil(rangeStart / step) * step; m < rangeEnd; m += step) {
      if (!isExactLocalTime(date, m, tz)) continue;
      const start = localMinutesToInstant(date, m, tz).getTime();
      const end = start + duration * MINUTE;
      if (end > rangeEndMs) continue;
      if (start < earliestStart) continue;
      const occupiedUntil = end + buffer * MINUTE;
      if (blocked.some(([bs, be]) => start < be && bs < occupiedUntil)) continue;
      slots.push({
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(end).toISOString(),
        providerId,
      });
    }
  }
  return slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/**
 * "Iedereen": collapses slots of several providers that start at the same
 * instant into one entry listing every free provider (sorted by start).
 */
export function mergeSlots(slots: ReadonlyArray<Slot>): MergedSlot[] {
  const byStart = new Map<string, MergedSlot>();
  for (const slot of slots) {
    const existing = byStart.get(slot.startsAt);
    if (existing) {
      if (!existing.providerIds.includes(slot.providerId))
        existing.providerIds.push(slot.providerId);
    } else {
      byStart.set(slot.startsAt, {
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        providerIds: [slot.providerId],
      });
    }
  }
  return [...byStart.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** Groups slots by their local date in `tz` → `{ 'YYYY-MM-DD': Slot[] }`. */
export function groupSlotsByDay<T extends { startsAt: string }>(
  slots: ReadonlyArray<T>,
  tz: string = BOOKING_TIMEZONE,
): Record<string, T[]> {
  const days: Record<string, T[]> = {};
  for (const slot of slots) {
    const day = instantToLocal(slot.startsAt, tz).dateYmd;
    (days[day] ??= []).push(slot);
  }
  return days;
}

/** True when `startsAt` is one of `slots` (same instant, optional provider). */
export function isSlotAvailable(
  slots: ReadonlyArray<Slot>,
  startsAt: Instant,
  providerId?: string,
): boolean {
  const target = ms(startsAt);
  return slots.some(
    (slot) =>
      ms(slot.startsAt) === target && (providerId === undefined || slot.providerId === providerId),
  );
}
