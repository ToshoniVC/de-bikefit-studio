import { instantToTime } from './dates';
import type { BookingSlot } from './types';

export function slotKey(slot: BookingSlot): string {
  return `${slot.providerId}|${slot.startsAt}|${slot.locationId ?? ''}`;
}

/**
 * Step 3b — the free start times on the chosen day, in the booking time zone.
 * When the provider works from more than one place that month, each time
 * also names where it is, so 10:00 in Ninove and 10:00 in Aalst are two
 * distinct choices. Who does the fit is never shown here: with "Iedereen" the
 * beheerder assigns it afterwards.
 */
export function SlotList({
  slots,
  timezone,
  locationLabels,
  showLocation,
  selectedKey,
  onSelect,
}: {
  slots: BookingSlot[];
  timezone: string;
  /** Location id → label ("De Bikefit Studio, Ninove", "Bij jou thuis"). */
  locationLabels: Record<string, string>;
  showLocation: boolean;
  selectedKey: string | null;
  onSelect: (slot: BookingSlot) => void;
}) {
  return (
    <ul className="studio-booking__slots" aria-label="Vrije uren">
      {slots.map((slot) => {
        const key = slotKey(slot);
        const time = instantToTime(slot.startsAt, timezone);
        const where = slot.locationId ? (locationLabels[slot.locationId] ?? '') : '';
        return (
          <li key={key}>
            <button
              type="button"
              className="studio-booking__slot"
              aria-pressed={selectedKey === key}
              aria-label={showLocation && where ? `${time}, ${where}` : time}
              onClick={() => onSelect(slot)}
            >
              <span className="studio-booking__slot-time">{time}</span>
              {showLocation && where ? (
                <span className="studio-booking__slot-provider">{where}</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
