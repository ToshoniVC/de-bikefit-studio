import { bookingChoiceLabel, OFFER_PRICE_FALLBACK } from '@/lib/offers/catalogue';
import { durationLabel } from './dates';
import type { BookingChoice, BookingServiceOption } from './types';

/**
 * The widget's first step as plain data: which offer a service sits under,
 * which offer starts open, and the lines shown for a service. Pure, so the
 * client component stays small and this is unit-tested
 * (`service-choice.test.ts`). Only a service is ever booked; an offer only
 * groups services.
 */

export type OfferChoice = Extract<BookingChoice, { kind: 'offer' }>;

/** `choices` as given, else one per service (the widget before offers). */
export function choicesFor(
  services: readonly BookingServiceOption[],
  choices: readonly BookingChoice[] | undefined,
): BookingChoice[] {
  return choices
    ? [...choices]
    : services.map((service) => ({ kind: 'service', serviceId: service.id }));
}

/**
 * The choices a chosen provider can offer: services they do not offer are
 * dropped, an offer keeps only the services they offer and goes when none
 * is left. Order is kept. For "Iedereen" (every provider) pass every id.
 */
export function narrowChoices(
  choices: readonly BookingChoice[],
  allowed: ReadonlySet<string>,
): BookingChoice[] {
  return choices.flatMap((choice): BookingChoice[] => {
    if (choice.kind === 'service') return allowed.has(choice.serviceId) ? [choice] : [];
    const serviceIds = choice.serviceIds.filter((id) => allowed.has(id));
    return serviceIds.length ? [{ ...choice, serviceIds }] : [];
  });
}

/** The offer a service is chosen under, or `null` when it stands on its own. */
export function offerOfService(
  choices: readonly BookingChoice[],
  serviceId: string | null,
): OfferChoice | null {
  if (!serviceId) return null;
  return (
    choices.find(
      (choice): choice is OfferChoice =>
        choice.kind === 'offer' && choice.serviceIds.includes(serviceId),
    ) ?? null
  );
}

/**
 * The offer open on arrival: the preselected service's, or the only choice
 * when that is an offer (`?dienst=<offer>` with Volwassene and Jeugd).
 */
export function startOpenOffer(
  choices: readonly BookingChoice[],
  startServiceId: string | null,
): string | null {
  const own = offerOfService(choices, startServiceId);
  if (own) return own.offer.slug;
  return choices.length === 1 && choices[0].kind === 'offer' ? choices[0].offer.slug : null;
}

/**
 * Duration, "bij jou thuis", price. Under an offer the price line always shows
 * something: the service's own price, else "Prijs op aanvraag", the same words
 * the offer page uses while no amount is confirmed (never an invented one).
 */
export function serviceMeta(service: BookingServiceOption, underOffer = false): string[] {
  return [
    durationLabel(service.durationMinutes),
    service.location?.kind === 'customer' ? 'bij jou thuis' : '',
    service.requiresGuardian && underOffer ? 'met ouder of voogd' : '',
    service.priceLabel || (underOffer ? OFFER_PRICE_FALLBACK : ''),
  ].filter(Boolean);
}

/** The done-state line of step 1: "Bikefit – huidige fiets · Jeugd · 1 uur · …". */
export function serviceSummary(
  service: BookingServiceOption | null,
  offer: OfferChoice | null,
): string {
  if (!service) return '';
  if (!offer) return `${service.name} · ${durationLabel(service.durationMinutes)}`;
  return [offer.offer.title, bookingChoiceLabel(service), ...serviceMeta(service, true)].join(
    ' · ',
  );
}
