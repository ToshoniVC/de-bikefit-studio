import { durationLabel } from './dates';
import type { BookingServiceOption } from './types';

/**
 * Step 1 — which fit. One toggle button per service (`aria-pressed`), so the
 * choice works with a keyboard, a screen reader and a thumb alike.
 */
export function ServicePicker({
  services,
  selectedId,
  onSelect,
}: {
  services: BookingServiceOption[];
  selectedId: string | null;
  onSelect: (serviceId: string) => void;
}) {
  return (
    <div className="studio-booking__options" role="group" aria-label="Kies je fit">
      {services.map((service) => {
        const meta = [
          durationLabel(service.durationMinutes),
          service.location?.kind === 'customer' ? 'bij jou thuis' : '',
          service.priceLabel,
        ].filter(Boolean);

        return (
          <button
            key={service.id}
            type="button"
            className="studio-booking__option"
            aria-pressed={selectedId === service.id}
            onClick={() => onSelect(service.id)}
          >
            <span className="studio-booking__option-title">{service.name}</span>
            <span className="studio-booking__option-meta">{meta.join(' · ')}</span>
            {service.description ? (
              <span className="studio-booking__option-body">{service.description}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
