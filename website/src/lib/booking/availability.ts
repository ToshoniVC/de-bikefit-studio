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
 * Where (17 Oct 2026): a business-hours row may name the location the
 * provider is at during that range; a row without one is at
 * `defaultLocationId` (the caller resolves it: the service's pinned location,
 * else the provider's default, else the studio default). Ranges are kept
 * apart per location, so every slot carries the `locationId` the fit would
 * be at. An `open` exception adds a range at the default location; a
 * `closed` one closes every location.
 *
 * "All providers" is the caller's job: run this per provider, concatenate, and
 * use {@link mergeSlots} to de-duplicate by start and location while keeping
 * every free provider id.
 */

export type BusinessHoursRow = {
  weekday: number;
  startMinute: number;
  endMinute: number;
  /** Where the provider is during this range; `null`/absent = the default location. */
  locationId?: string | null;
};

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

export type Slot = {
  startsAt: string;
  endsAt: string;
  providerId: string;
  /** Where the fit would be; `null` when no location is known at all. */
  locationId: string | null;
};

export type MergedSlot = {
  startsAt: string;
  endsAt: string;
  locationId: string | null;
  providerIds: string[];
};

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
  /** Location of hours rows without one and of `open` exceptions; `null` = unknown. */
  defaultLocationId?: string | null;
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
 * Open ranges (local minutes) for one date, per location: weekday hours, then
 * exceptions. A `closed` exception without minutes closes the whole day (every
 * location); with minutes it cuts that range out of every location. An `open`
 * exception adds a range at `defaultLocationId` (also on a closed day). Hours
 * rows without a location are at `defaultLocationId` too. Insertion order is
 * the order of the hours rows, so the caller's sort carries through.
 */
export function openRangesByLocation(
  date: string,
  hours: ReadonlyArray<BusinessHoursRow>,
  exceptions: ReadonlyArray<AvailabilityExceptionRow> = [],
  defaultLocationId: string | null = null,
): Map<string | null, Range[]> {
  const weekday = weekdayOfYmd(date);
  const today = exceptions.filter((e) => e.date === date);
  const closedAllDay = today.some(
    (e) => e.kind === 'closed' && (e.startMinute == null || e.endMinute == null),
  );

  const base = new Map<string | null, Range[]>();
  const add = (locationId: string | null, range: Range) => {
    const list = base.get(locationId) ?? [];
    list.push(range);
    base.set(locationId, list);
  };
  if (!closedAllDay) {
    for (const h of hours) {
      if (h.weekday === weekday) {
        add(h.locationId ?? defaultLocationId, [h.startMinute, h.endMinute]);
      }
    }
  }
  for (const e of today) {
    if (e.kind === 'open' && e.startMinute != null && e.endMinute != null) {
      add(defaultLocationId, [e.startMinute, e.endMinute]);
    }
  }
  const cuts: Range[] = today
    .filter((e) => e.kind === 'closed' && e.startMinute != null && e.endMinute != null)
    .map((e) => [e.startMinute as number, e.endMinute as number]);

  const result = new Map<string | null, Range[]>();
  for (const [locationId, ranges] of base) {
    const open = subtractRanges(ranges, cuts);
    if (open.length) result.set(locationId, open);
  }
  return result;
}

/** The open ranges of {@link openRangesByLocation} merged across locations. */
export function openRangesForDate(
  date: string,
  hours: ReadonlyArray<BusinessHoursRow>,
  exceptions: ReadonlyArray<AvailabilityExceptionRow> = [],
): Range[] {
  return normalizeRanges([...openRangesByLocation(date, hours, exceptions).values()].flat());
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
  const byLocation = openRangesByLocation(
    date,
    input.hours,
    input.exceptions,
    input.defaultLocationId ?? null,
  );
  const locationRank = [...byLocation.keys()];
  for (const [locationId, ranges] of byLocation) {
    for (const [rangeStart, rangeEnd] of ranges) {
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
          locationId,
        });
      }
    }
  }
  // By start; two locations at one start keep the order of the hours rows.
  return slots.sort(
    (a, b) =>
      a.startsAt.localeCompare(b.startsAt) ||
      locationRank.indexOf(a.locationId) - locationRank.indexOf(b.locationId),
  );
}

/**
 * "Iedereen": collapses slots of several providers that start at the same
 * instant at the same location into one entry listing every free provider
 * (sorted by start; between locations the first slot's order is kept).
 */
export function mergeSlots(slots: ReadonlyArray<Slot>): MergedSlot[] {
  const byStart = new Map<string, MergedSlot>();
  for (const slot of slots) {
    const key = `${slot.startsAt}|${slot.locationId ?? ''}`;
    const existing = byStart.get(key);
    if (existing) {
      if (!existing.providerIds.includes(slot.providerId))
        existing.providerIds.push(slot.providerId);
    } else {
      byStart.set(key, {
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        locationId: slot.locationId,
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

/** True when `startsAt` is one of `slots` (same instant; optionally one provider and one location). */
export function isSlotAvailable(
  slots: ReadonlyArray<Slot>,
  startsAt: Instant,
  providerId?: string,
  locationId?: string | null,
): boolean {
  const target = ms(startsAt);
  return slots.some(
    (slot) =>
      ms(slot.startsAt) === target &&
      (providerId === undefined || slot.providerId === providerId) &&
      (locationId === undefined || slot.locationId === locationId),
  );
}
