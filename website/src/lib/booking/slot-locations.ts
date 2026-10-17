import type { CmsLocationKind } from '@/db/cms-schema';

/**
 * Which hours rows count, and where, for one (provider, service) — the pure
 * part of `getAvailability()` (`./content.ts`), tested in
 * `slot-locations.test.ts`. See `booking-architecture.md` §16.
 */

export type HoursRowWithLocation = {
  weekday: number;
  startMinute: number;
  endMinute: number;
  locationId: string | null;
};

/**
 * The hours rows to compute slots from for one (provider, service) and the
 * location a row without one resolves to (pure; `availability-locations.test.ts`):
 *
 *  - a service pinned to a studio (override → service location): every row at
 *    that studio or without a location counts and is at the studio; a row at
 *    another studio (or at "bij de klant") is skipped, the provider is elsewhere;
 *  - a service pinned to "bij de klant": every row counts and is at the
 *    customer's, whatever the row says;
 *  - no pinned location: each row is at its own location, else the provider's
 *    default, else the studio default.
 */
export function slotLocations(input: {
  pinnedId: string | null;
  /** Unused when `kindOf` is given; kept so the call reads naturally. */
  pinnedKind: CmsLocationKind | null;
  providerDefaultId: string | null;
  studioDefaultId: string | null;
  hours: ReadonlyArray<HoursRowWithLocation>;
  kindOf: (locationId: string) => CmsLocationKind | null;
}): { hours: HoursRowWithLocation[]; defaultLocationId: string | null } {
  const pinnedKind = input.pinnedId ? (input.pinnedKind ?? input.kindOf(input.pinnedId)) : null;
  if (input.pinnedId && pinnedKind === 'customer') {
    return {
      hours: input.hours.map((row) => ({ ...row, locationId: input.pinnedId })),
      defaultLocationId: input.pinnedId,
    };
  }
  if (input.pinnedId) {
    return {
      hours: input.hours
        .filter((row) => row.locationId === null || row.locationId === input.pinnedId)
        .map((row) => ({ ...row, locationId: input.pinnedId })),
      defaultLocationId: input.pinnedId,
    };
  }
  return {
    hours: [...input.hours],
    defaultLocationId: input.providerDefaultId ?? input.studioDefaultId ?? null,
  };
}
