import { describe, expect, it } from 'vitest';
import {
  computeSlots,
  groupSlotsByDay,
  isSlotAvailable,
  mergeSlots,
  openRangesForDate,
  type BusinessHoursRow,
  type ComputeSlotsInput,
  type Slot,
} from './availability';
import { formatTime } from './time';

// Weekdays as stored in `cms_business_hours`: 0 = Sunday … 6 = Saturday.
const SUNDAY = 0;
const MONDAY = 1;

/** `'09:30'` → 570 (local minutes). */
function min(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

function open(weekday: number, from: string, to: string): BusinessHoursRow {
  return { weekday, startMinute: min(from), endMinute: min(to) };
}

const RULES = {
  slotStepMinutes: 30,
  minNoticeHours: 0,
  horizonDays: 56,
  defaultBufferAfterMinutes: 15,
};

/** Thursday 1 October 2026, 08:00 in Brussels (CEST, UTC+2). */
const NOW = new Date('2026-10-01T06:00:00Z');
/** Monday 5 October 2026 (CEST, UTC+2). */
const DATE = '2026-10-05';

function slotsFor(overrides: Partial<ComputeSlotsInput> = {}): Slot[] {
  return computeSlots({
    date: DATE,
    hours: [open(MONDAY, '09:00', '12:00')],
    service: { durationMinutes: 60, bufferAfterMinutes: 0 },
    rules: RULES,
    now: NOW,
    providerId: 'p1',
    ...overrides,
  });
}

/** Local start times (`HH:mm`, Europe/Brussels). */
function starts(slots: Slot[]): string[] {
  return slots.map((slot) => formatTime(slot.startsAt));
}

function durationsInMinutes(slots: Slot[]): number[] {
  return slots.map((slot) => (Date.parse(slot.endsAt) - Date.parse(slot.startsAt)) / 60_000);
}

describe('openRangesForDate', () => {
  it("returns the weekday's business hours, sorted and merged", () => {
    const hours = [
      open(MONDAY, '13:00', '17:00'),
      open(MONDAY, '09:00', '12:00'),
      open(MONDAY, '11:30', '12:30'),
      open(2, '08:00', '20:00'),
    ];
    expect(openRangesForDate(DATE, hours)).toEqual([
      [min('09:00'), min('12:30')],
      [min('13:00'), min('17:00')],
    ]);
  });

  it('closes the whole day for a closed exception without minutes, but still adds open exceptions', () => {
    const ranges = openRangesForDate(
      DATE,
      [open(MONDAY, '09:00', '17:00')],
      [
        { date: DATE, kind: 'closed', startMinute: null, endMinute: null },
        { date: DATE, kind: 'open', startMinute: min('10:00'), endMinute: min('11:00') },
      ],
    );
    expect(ranges).toEqual([[min('10:00'), min('11:00')]]);
  });

  it('cuts a partial closed exception out and ignores exceptions for other dates', () => {
    const ranges = openRangesForDate(
      DATE,
      [open(MONDAY, '09:00', '17:00')],
      [
        { date: DATE, kind: 'closed', startMinute: min('12:00'), endMinute: min('13:00') },
        { date: '2026-10-06', kind: 'closed', startMinute: null, endMinute: null },
      ],
    );
    expect(ranges).toEqual([
      [min('09:00'), min('12:00')],
      [min('13:00'), min('17:00')],
    ]);
  });

  it('opens a day without business hours through an open exception', () => {
    const sunday = '2026-10-04';
    const exception = {
      date: sunday,
      kind: 'open',
      startMinute: min('10:00'),
      endMinute: min('12:00'),
    };
    expect(openRangesForDate(sunday, [open(MONDAY, '09:00', '17:00')])).toEqual([]);
    expect(openRangesForDate(sunday, [open(MONDAY, '09:00', '17:00')], [exception])).toEqual([
      [min('10:00'), min('12:00')],
    ]);
  });
});

describe('computeSlots', () => {
  it('offers every grid start whose fit ends by closing time', () => {
    const slots = slotsFor();
    expect(starts(slots)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00']);
    expect(slots[0]).toEqual({
      startsAt: '2026-10-05T07:00:00.000Z',
      endsAt: '2026-10-05T08:00:00.000Z',
      providerId: 'p1',
    });
  });

  it('offers slots in every range of a split day and none across the gap', () => {
    const slots = slotsFor({
      hours: [open(MONDAY, '09:00', '12:00'), open(MONDAY, '13:00', '15:00')],
    });
    expect(starts(slots)).toEqual([
      '09:00',
      '09:30',
      '10:00',
      '10:30',
      '11:00',
      '13:00',
      '13:30',
      '14:00',
    ]);
  });

  it('anchors the grid at local midnight, so a 09:15 opening starts at 09:30', () => {
    const slots = slotsFor({
      hours: [open(MONDAY, '09:15', '11:00')],
      service: { durationMinutes: 30, bufferAfterMinutes: 0 },
    });
    expect(starts(slots)).toEqual(['09:30', '10:00', '10:30']);
  });

  it('lets the buffer run past closing time', () => {
    const slots = slotsFor({
      hours: [open(MONDAY, '09:00', '18:00')],
      service: { durationMinutes: 90, bufferAfterMinutes: 15 },
    });
    expect(starts(slots).at(-1)).toBe('16:30');
  });

  it('treats busy intervals as half-open: a fit may end when busy time starts or start when it ends', () => {
    const slots = slotsFor({
      hours: [open(MONDAY, '09:00', '13:00')],
      busy: [{ start: '2026-10-05T08:00:00Z', end: '2026-10-05T09:00:00Z' }], // 10:00–11:00 local
    });
    expect(starts(slots)).toEqual(['09:00', '11:00', '11:30', '12:00']);
  });

  it('keeps the buffer after a fit free of busy time, falling back to the default buffer', () => {
    const busy = [
      { start: new Date('2026-10-05T08:00:00Z'), end: new Date('2026-10-05T09:00:00Z') },
    ];
    const hours = [open(MONDAY, '09:00', '13:00')];
    const withOwnBuffer = slotsFor({
      hours,
      busy,
      service: { durationMinutes: 60, bufferAfterMinutes: 15 },
    });
    const withDefault = slotsFor({
      hours,
      busy,
      service: { durationMinutes: 60, bufferAfterMinutes: null },
    });
    expect(starts(withOwnBuffer)).toEqual(['11:00', '11:30', '12:00']);
    expect(starts(withDefault)).toEqual(['11:00', '11:30', '12:00']);
  });

  it('blocks existing bookings plus their own buffer and ignores cancelled ones', () => {
    const slots = slotsFor({
      hours: [open(MONDAY, '09:00', '14:00')],
      bookings: [
        // 10:00–11:00 local, 30 min buffer → blocked until 11:30.
        {
          startsAt: '2026-10-05T08:00:00Z',
          endsAt: '2026-10-05T09:00:00Z',
          bufferAfterMinutes: 30,
        },
        { startsAt: '2026-10-05T10:00:00Z', endsAt: '2026-10-05T11:00:00Z', status: 'cancelled' },
      ],
    });
    expect(starts(slots)).toEqual(['09:00', '11:30', '12:00', '12:30', '13:00']);
  });

  it('extends a booking without its own buffer by the default buffer', () => {
    const slots = slotsFor({
      hours: [open(MONDAY, '09:00', '13:00')],
      bookings: [
        {
          startsAt: '2026-10-05T08:00:00Z',
          endsAt: '2026-10-05T09:00:00Z',
          bufferAfterMinutes: null,
        },
      ],
    });
    expect(starts(slots)).toEqual(['09:00', '11:30', '12:00']);
  });

  it('enforces the minimum notice, inclusive at the boundary', () => {
    const rules = { ...RULES, minNoticeHours: 2 };
    const hours = [open(MONDAY, '09:00', '17:00')];
    // 09:00 local + 2 h → 11:00 is the first start.
    expect(starts(slotsFor({ hours, rules, now: '2026-10-05T07:00:00Z' }))[0]).toBe('11:00');
    // 09:10 local + 2 h → 11:10, so 11:00 is too early.
    expect(starts(slotsFor({ hours, rules, now: '2026-10-05T07:10:00Z' }))[0]).toBe('11:30');
  });

  it('offers nothing outside the booking window or for invalid input', () => {
    const everyDay = [0, 1, 2, 3, 4, 5, 6].map((weekday) => open(weekday, '09:00', '12:00'));
    // NOW is 2026-10-01; the horizon is 56 days → 2026-11-26 is the last bookable date.
    expect(slotsFor({ hours: everyDay, date: '2026-10-01' }).length).toBeGreaterThan(0);
    expect(slotsFor({ hours: everyDay, date: '2026-11-26' }).length).toBeGreaterThan(0);
    expect(slotsFor({ hours: everyDay, date: '2026-11-27' })).toEqual([]);
    expect(slotsFor({ hours: everyDay, date: '2026-09-30' })).toEqual([]);
    expect(slotsFor({ hours: everyDay, date: '2026-02-30' })).toEqual([]);
    expect(slotsFor({ service: { durationMinutes: 0 } })).toEqual([]);
  });

  it('skips the ambiguous 02:00–03:00 hour on the fall-back day (2026-10-25)', () => {
    const slots = slotsFor({
      date: '2026-10-25',
      hours: [open(SUNDAY, '01:00', '05:00')],
      service: { durationMinutes: 30, bufferAfterMinutes: 0 },
    });
    expect(slots.map((slot) => slot.startsAt)).toEqual([
      '2026-10-24T23:00:00.000Z', // 01:00 CEST
      '2026-10-24T23:30:00.000Z', // 01:30 CEST
      '2026-10-25T02:00:00.000Z', // 03:00 CET
      '2026-10-25T02:30:00.000Z',
      '2026-10-25T03:00:00.000Z',
      '2026-10-25T03:30:00.000Z', // 04:30 CET, ends at closing (05:00 CET)
    ]);
    expect(new Set(durationsInMinutes(slots))).toEqual(new Set([30]));
  });

  it('uses winter time for daytime slots from 2026-10-25 on', () => {
    const saturday = slotsFor({ date: '2026-10-24', hours: [open(6, '09:00', '10:00')] });
    const sunday = slotsFor({ date: '2026-10-25', hours: [open(SUNDAY, '09:00', '10:00')] });
    expect(saturday.map((slot) => slot.startsAt)).toEqual(['2026-10-24T07:00:00.000Z']);
    expect(sunday.map((slot) => slot.startsAt)).toEqual(['2026-10-25T08:00:00.000Z']);
  });

  it('skips the missing 02:00–03:00 hour on the spring-forward day (2027-03-28)', () => {
    const base = {
      date: '2027-03-28',
      now: '2027-03-01T08:00:00Z',
      hours: [open(SUNDAY, '01:00', '05:00')],
    };
    const halfHour = slotsFor({ ...base, service: { durationMinutes: 30, bufferAfterMinutes: 0 } });
    expect(halfHour.map((slot) => slot.startsAt)).toEqual([
      '2027-03-28T00:00:00.000Z', // 01:00 CET
      '2027-03-28T00:30:00.000Z', // 01:30 CET
      '2027-03-28T01:00:00.000Z', // 03:00 CEST
      '2027-03-28T01:30:00.000Z',
      '2027-03-28T02:00:00.000Z',
      '2027-03-28T02:30:00.000Z', // 04:30 CEST, ends at closing (05:00 CEST)
    ]);

    // A 60-minute fit from 01:30 CET spans the gap and still lasts 60 real minutes.
    const hour = slotsFor({ ...base, service: { durationMinutes: 60, bufferAfterMinutes: 0 } });
    expect(hour[1]).toMatchObject({
      startsAt: '2027-03-28T00:30:00.000Z',
      endsAt: '2027-03-28T01:30:00.000Z',
    });
    expect(new Set(durationsInMinutes(hour))).toEqual(new Set([60]));
  });
});

describe('isSlotAvailable', () => {
  it('matches a slot by instant, optionally for one provider', () => {
    const slots = slotsFor();
    expect(isSlotAvailable(slots, new Date('2026-10-05T07:00:00Z'))).toBe(true);
    expect(isSlotAvailable(slots, '2026-10-05T07:00:00.000Z', 'p1')).toBe(true);
    expect(isSlotAvailable(slots, '2026-10-05T07:00:00.000Z', 'p2')).toBe(false);
    expect(isSlotAvailable(slots, '2026-10-05T07:15:00.000Z')).toBe(false);
  });
});

describe('mergeSlots', () => {
  it('collapses providers that share a start into one entry, sorted by start', () => {
    const seven = { startsAt: '2026-10-05T07:00:00.000Z', endsAt: '2026-10-05T08:00:00.000Z' };
    const eight = { startsAt: '2026-10-05T08:00:00.000Z', endsAt: '2026-10-05T09:00:00.000Z' };
    const merged = mergeSlots([
      { ...eight, providerId: 'p2' },
      { ...seven, providerId: 'p1' },
      { ...eight, providerId: 'p1' },
      { ...eight, providerId: 'p2' },
    ]);
    expect(merged).toEqual([
      {
        startsAt: '2026-10-05T07:00:00.000Z',
        endsAt: '2026-10-05T08:00:00.000Z',
        providerIds: ['p1'],
      },
      {
        startsAt: '2026-10-05T08:00:00.000Z',
        endsAt: '2026-10-05T09:00:00.000Z',
        providerIds: ['p2', 'p1'],
      },
    ]);
  });
});

describe('groupSlotsByDay', () => {
  it('groups by local date in Brussels, not by UTC date', () => {
    const late = { startsAt: '2026-10-24T21:30:00.000Z' }; // 23:30 on the 24th
    const afterMidnight = { startsAt: '2026-10-24T22:30:00.000Z' }; // 00:30 on the 25th
    const morning = { startsAt: '2026-10-25T08:00:00.000Z' };
    expect(groupSlotsByDay([late, afterMidnight, morning])).toEqual({
      '2026-10-24': [late],
      '2026-10-25': [afterMidnight, morning],
    });
    expect(groupSlotsByDay([late, afterMidnight, morning], 'UTC')).toEqual({
      '2026-10-24': [late, afterMidnight],
      '2026-10-25': [morning],
    });
  });
});
