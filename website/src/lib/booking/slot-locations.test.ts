import { describe, expect, it } from 'vitest';
import { slotLocations, type HoursRowWithLocation } from './slot-locations';

const KINDS: Record<string, 'studio' | 'customer'> = {
  ninove: 'studio',
  aalst: 'studio',
  home: 'customer',
};
const kindOf = (id: string) => KINDS[id] ?? null;

const row = (weekday: number, locationId: string | null): HoursRowWithLocation => ({
  weekday,
  startMinute: 540,
  endMinute: 1080,
  locationId,
});
const HOURS = [row(1, null), row(2, 'ninove'), row(4, 'aalst'), row(5, 'home')];

describe('slotLocations', () => {
  it('without a pinned location: each row at its own place, the rest at the provider default, else the studio default', () => {
    expect(
      slotLocations({
        pinnedId: null,
        pinnedKind: null,
        providerDefaultId: 'ninove',
        studioDefaultId: 'aalst',
        hours: HOURS,
        kindOf,
      }),
    ).toEqual({ hours: HOURS, defaultLocationId: 'ninove' });
    expect(
      slotLocations({
        pinnedId: null,
        pinnedKind: null,
        providerDefaultId: null,
        studioDefaultId: 'aalst',
        hours: HOURS,
        kindOf,
      }).defaultLocationId,
    ).toBe('aalst');
  });

  it('a service pinned to a studio: only rows there or without a place, all at that studio', () => {
    expect(
      slotLocations({
        pinnedId: 'ninove',
        pinnedKind: null,
        providerDefaultId: 'aalst',
        studioDefaultId: 'aalst',
        hours: HOURS,
        kindOf,
      }),
    ).toEqual({
      hours: [row(1, 'ninove'), row(2, 'ninove')],
      defaultLocationId: 'ninove',
    });
  });

  it('a service pinned to "bij de klant": every row, all at the customer', () => {
    expect(
      slotLocations({
        pinnedId: 'home',
        pinnedKind: 'customer',
        providerDefaultId: 'ninove',
        studioDefaultId: 'ninove',
        hours: HOURS,
        kindOf: () => null,
      }),
    ).toEqual({
      hours: HOURS.map((item) => ({ ...item, locationId: 'home' })),
      defaultLocationId: 'home',
    });
  });
});
