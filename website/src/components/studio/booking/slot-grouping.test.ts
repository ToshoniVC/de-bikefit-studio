import { describe, expect, it } from 'vitest';
import { groupDaySlots, slotLocationIds } from './slot-grouping';
import type { BookingSlot } from './types';

const TZ = 'Europe/Brussels';

function slot(startsAt: string, providerId: string, locationId: string | null = null): BookingSlot {
  return {
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 60 * 60_000).toISOString(),
    providerId,
    locationId,
  };
}

const OPTIONS = {
  timezone: TZ,
  todayYmd: '2026-10-05',
  lastYmd: '2026-11-30',
  providerRank: new Map([
    ['p1', 0],
    ['p2', 1],
  ]),
};

describe('groupDaySlots', () => {
  it('groups by local day, sorts by start then admin order, and drops days outside the window', () => {
    const days = groupDaySlots(
      [
        slot('2026-10-06T08:00:00.000Z', 'p2'),
        slot('2026-10-06T08:00:00.000Z', 'p1'),
        slot('2026-10-06T07:00:00.000Z', 'p2'),
        slot('2026-10-04T07:00:00.000Z', 'p1'), // yesterday
        slot('2026-12-01T07:00:00.000Z', 'p1'), // past the horizon
      ],
      { ...OPTIONS, onePerStart: false },
    );
    expect([...days.keys()]).toEqual(['2026-10-06']);
    expect(days.get('2026-10-06')?.map((item) => `${item.startsAt}|${item.providerId}`)).toEqual([
      '2026-10-06T07:00:00.000Z|p2',
      '2026-10-06T08:00:00.000Z|p1',
      '2026-10-06T08:00:00.000Z|p2',
    ]);
  });

  it('"Iedereen": one entry per start and location, the first provider in admin order', () => {
    const days = groupDaySlots(
      [
        slot('2026-10-06T08:00:00.000Z', 'p2', 'ninove'),
        slot('2026-10-06T08:00:00.000Z', 'p1', 'ninove'),
        slot('2026-10-06T08:00:00.000Z', 'p2', 'aalst'),
        slot('2026-10-06T09:00:00.000Z', 'p2', null),
        slot('2026-10-06T09:00:00.000Z', 'p1', null),
      ],
      { ...OPTIONS, onePerStart: true },
    );
    expect(
      days
        .get('2026-10-06')
        ?.map((item) => `${item.startsAt.slice(11, 16)}|${item.providerId}|${item.locationId}`),
    ).toEqual(['08:00|p1|ninove', '08:00|p2|aalst', '09:00|p1|null']);
  });
});

describe('slotLocationIds', () => {
  it('lists the distinct locations, leaving out slots without one', () => {
    expect(
      [
        ...slotLocationIds([
          slot('2026-10-06T08:00:00.000Z', 'p1', 'ninove'),
          slot('2026-10-06T09:00:00.000Z', 'p1', null),
          slot('2026-10-06T10:00:00.000Z', 'p2', 'ninove'),
          slot('2026-10-06T11:00:00.000Z', 'p2', 'aalst'),
        ]),
      ].sort(),
    ).toEqual(['aalst', 'ninove']);
  });
});
