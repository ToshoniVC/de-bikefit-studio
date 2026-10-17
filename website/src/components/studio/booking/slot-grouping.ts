import { instantToYmd, type Ymd } from './dates';
import type { BookingSlot } from './types';

/**
 * The month's slots as the "Kies een dag en uur" step shows them: per local
 * day, sorted by start (ties in the admin's provider order), and for
 * "Iedereen" one entry per start AND location — the visitor never picks a
 * provider there (the beheerder assigns), but two locations at one time are
 * two different choices. Pure; tested in `slot-grouping.test.ts`.
 */
export function groupDaySlots(
  slots: readonly BookingSlot[],
  options: {
    timezone: string;
    todayYmd: Ymd;
    lastYmd: Ymd;
    /** Provider id → rank (admin order); unknown ids sort last. */
    providerRank: ReadonlyMap<string, number>;
    /** "Iedereen": collapse providers sharing a start and location. */
    onePerStart: boolean;
  },
): Map<Ymd, BookingSlot[]> {
  const byDay = new Map<Ymd, BookingSlot[]>();
  for (const slot of slots) {
    const ymd = instantToYmd(slot.startsAt, options.timezone);
    if (ymd < options.todayYmd || ymd > options.lastYmd) continue;
    const list = byDay.get(ymd) ?? [];
    list.push(slot);
    byDay.set(ymd, list);
  }
  const rank = (id: string) => options.providerRank.get(id) ?? Number.MAX_SAFE_INTEGER;
  for (const [ymd, list] of byDay) {
    list.sort(
      (a, b) => a.startsAt.localeCompare(b.startsAt) || rank(a.providerId) - rank(b.providerId),
    );
    if (options.onePerStart) {
      const seen = new Set<string>();
      byDay.set(
        ymd,
        list.filter((slot) => {
          const key = `${slot.startsAt}|${slot.locationId ?? ''}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      );
    }
  }
  return byDay;
}

/** The distinct location ids the slots name (`null` left out). */
export function slotLocationIds(slots: Iterable<BookingSlot>): Set<string> {
  const ids = new Set<string>();
  for (const slot of slots) if (slot.locationId) ids.add(slot.locationId);
  return ids;
}
