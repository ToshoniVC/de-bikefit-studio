import { instantToTime } from './dates';
import type { BookingSlot } from './types';

export function slotKey(slot: BookingSlot): string {
  return `${slot.providerId}|${slot.startsAt}`;
}

/**
 * Step 3b — the free start times on the chosen day, in the booking time zone.
 * With "Iedereen" and more than one provider, each time also names who it is
 * with, so two providers free at 10:00 are two distinct choices.
 */
export function SlotList({
  slots,
  timezone,
  providerNames,
  showProvider,
  selectedKey,
  onSelect,
}: {
  slots: BookingSlot[];
  timezone: string;
  providerNames: Record<string, string>;
  showProvider: boolean;
  selectedKey: string | null;
  onSelect: (slot: BookingSlot) => void;
}) {
  return (
    <ul className="studio-booking__slots" aria-label="Vrije uren">
      {slots.map((slot) => {
        const key = slotKey(slot);
        const time = instantToTime(slot.startsAt, timezone);
        const provider = providerNames[slot.providerId] ?? '';
        return (
          <li key={key}>
            <button
              type="button"
              className="studio-booking__slot"
              aria-pressed={selectedKey === key}
              aria-label={showProvider && provider ? `${time} bij ${provider}` : time}
              onClick={() => onSelect(slot)}
            >
              <span className="studio-booking__slot-time">{time}</span>
              {showProvider && provider ? (
                <span className="studio-booking__slot-provider">{provider}</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
