import { useState } from 'react';
import { choicesFor, offerOfService, startOpenOffer } from './service-choice';
import type { BookingChoice, BookingServiceOption } from './types';

/**
 * Step 1's state, kept out of the (already long) widget: the chosen service —
 * the only thing ever booked — and which offer's "Voor wie?" row is open.
 * `onChange` runs whenever the chosen service changes, so the widget can clear
 * the later steps (provider, day, time).
 */
export function useServiceChoice({
  services,
  choices: given,
  initialServiceId,
  onChange,
}: {
  services: BookingServiceOption[];
  choices: BookingChoice[] | undefined;
  initialServiceId: string | null;
  onChange: () => void;
}) {
  const startServiceId =
    initialServiceId && services.some((item) => item.id === initialServiceId)
      ? initialServiceId
      : services.length === 1
        ? services[0].id
        : null;
  const choices = choicesFor(services, given);
  const startOffer = startOpenOffer(choices, startServiceId);
  const [serviceId, setServiceId] = useState<string | null>(startServiceId);
  const [openOffer, setOpenOffer] = useState<string | null>(startOffer);
  const slugOf = (id: string | null) => offerOfService(choices, id)?.offer.slug ?? null;

  return {
    choices,
    serviceId,
    openOffer,
    offer: offerOfService(choices, serviceId),
    choose(id: string) {
      setServiceId(id);
      setOpenOffer(slugOf(id));
      onChange();
    },
    /** Shows an offer's services; a service chosen under another offer is let go. */
    open(slug: string) {
      setOpenOffer(slug);
      if (serviceId && slugOf(serviceId) !== slug) {
        setServiceId(null);
        onChange();
      }
    },
    /** Back to step 1 with the offer still open, so Volwassene ↔ Jeugd is one tap. */
    clear() {
      setOpenOffer(slugOf(serviceId));
      setServiceId(null);
      onChange();
    },
    /** "Opnieuw": the preselection the page arrived with. */
    reset() {
      setServiceId(startServiceId);
      setOpenOffer(startOffer);
    },
  };
}
