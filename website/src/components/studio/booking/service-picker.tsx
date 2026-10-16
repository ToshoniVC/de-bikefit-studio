import { useId } from 'react';
import { bookingChoiceLabel } from '@/lib/offers/catalogue';
import { serviceMeta } from './service-choice';
import type { BookingChoice, BookingServiceOption } from './types';

/**
 * Step 1 — which fit. One toggle button per choice (`aria-pressed`), so the
 * choice works with a keyboard, a screen reader and a thumb alike.
 *
 * A choice is a service on its own, or an offer with its services underneath
 * (`groupBookingChoices()`): "Bikefit – huidige fiets" opens a second row,
 * "Voor wie?", with Volwassene and Jeugd. That second row comes right after
 * the offer's button in the DOM, so Tab reaches it next. Only a service is
 * ever selected: its duration, price and (on the next steps) availability and
 * form are the ones shown and booked. An offer with a single bookable service
 * selects that service straight away.
 */
export function ServicePicker({
  services,
  choices,
  selectedId,
  openOffer,
  onSelect,
  onOpenOffer,
}: {
  services: BookingServiceOption[];
  choices: BookingChoice[];
  selectedId: string | null;
  /** The offer whose services are shown (its slug), or `null`. */
  openOffer: string | null;
  onSelect: (serviceId: string) => void;
  onOpenOffer: (offerSlug: string) => void;
}) {
  const baseId = useId();
  const byId = new Map(services.map((service) => [service.id, service]));

  return (
    <div className="studio-booking__options" role="group" aria-label="Kies je fit">
      {choices.map((choice) => {
        if (choice.kind === 'service') {
          const service = byId.get(choice.serviceId);
          if (!service) return null;
          return (
            <button
              key={service.id}
              type="button"
              className="studio-booking__option"
              aria-pressed={selectedId === service.id}
              onClick={() => onSelect(service.id)}
            >
              <span className="studio-booking__option-title">{service.name}</span>
              <span className="studio-booking__option-meta">
                {serviceMeta(service).join(' · ')}
              </span>
              {service.description ? (
                <span className="studio-booking__option-body">{service.description}</span>
              ) : null}
            </button>
          );
        }

        const members = choice.serviceIds
          .map((id) => byId.get(id))
          .filter((service): service is BookingServiceOption => Boolean(service));
        if (members.length === 0) return null;
        const single = members.length === 1 ? members[0] : null;
        const open =
          !single &&
          (openOffer === choice.offer.slug || members.some((service) => service.id === selectedId));
        const pressed = single ? selectedId === single.id : open;
        const subId = `${baseId}-${choice.offer.slug}`;

        return (
          <div key={choice.offer.slug} className="studio-booking__offer">
            <button
              type="button"
              className="studio-booking__option"
              aria-pressed={pressed}
              aria-expanded={single ? undefined : open}
              aria-controls={single ? undefined : subId}
              onClick={() => (single ? onSelect(single.id) : onOpenOffer(choice.offer.slug))}
            >
              <span className="studio-booking__option-title">{choice.offer.title}</span>
              <span className="studio-booking__option-meta">
                {single
                  ? serviceMeta(single, true).join(' · ')
                  : members.map((service) => bookingChoiceLabel(service)).join(' of ')}
              </span>
            </button>
            {single ? null : (
              <div
                id={subId}
                className="studio-booking__suboptions"
                role="group"
                aria-label={`Voor wie? ${choice.offer.title}`}
                hidden={!open}
              >
                <p className="studio-booking__suboptions-title" aria-hidden="true">
                  Voor wie?
                </p>
                {members.map((service) => (
                  <button
                    key={service.id}
                    type="button"
                    className="studio-booking__option studio-booking__option--sub"
                    aria-pressed={selectedId === service.id}
                    onClick={() => onSelect(service.id)}
                  >
                    <span className="studio-booking__option-title">
                      {bookingChoiceLabel(service)}
                    </span>
                    <span className="studio-booking__option-meta">
                      {serviceMeta(service, true).join(' · ')}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
