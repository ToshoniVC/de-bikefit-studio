import {
  OFFER_CTA_LABEL,
  OFFER_DURATION_FALLBACK,
  OFFER_EXTRAS_NOTE,
  type OfferCategory,
} from './catalogue';

/**
 * The seven offers as first published on 13 Oct 2026 — the seed for the offer
 * pages (`/aanbod/<slug>`). Plain data, no I/O.
 *
 * COPY PROVENANCE: work block `2026-10-13-aanbod-staging-brief.md` ("Suggested
 * service content", supplied by Toshoni via Winston). Nothing beyond it:
 *  - no prices (none confirmed) → "Prijs op aanvraag" on every overview;
 *  - no durations (none confirmed) → "Duur in overleg" / "Traject en
 *    opvolging in overleg"; the scheduling length of a bookable service lives
 *    on its `cms_services` row and is never copied here;
 *  - no device brands, medical claims, guarantees or included products.
 *
 * Every field stays editable in the CMS after the seed.
 */

export type DefaultOffer = {
  slug: string;
  category: OfferCategory;
  sortOrder: number;
  title: string;
  summary: string;
  intro: string;
  goal: string;
  contents: string[];
  duration: string;
  extras: string[];
  /** Existing `cms_services.slug`s this offer may be booked as; see {@link BOOKING_RECONCILIATION}. */
  bookingServiceSlugs: string[];
  metaDescription: string;
};

export const DEFAULT_OFFERS: DefaultOffer[] = [
  {
    slug: 'bikefit-nieuwe-fiets',
    category: 'bikefit',
    sortOrder: 10,
    title: 'Bikefit – aankoop nieuwe fiets',
    summary: 'Kies een fiets die bij jou past, nog vóór je koopt.',
    intro: 'Een nieuwe fiets begint bij jou: je lichaam, je ritten en je plannen.',
    goal: 'Kies een fiets die bij jou past, nog vóór je koopt.',
    contents: [
      'Een gesprek over hoe en waarvoor je fietst, en wat je doelen zijn.',
      'We bekijken je houding en hoe beweeglijk je bent.',
      'Je krijgt advies over een passende maat, geometrie en afstelling voor je nieuwe fiets.',
    ],
    duration: OFFER_DURATION_FALLBACK,
    extras: [
      'Afstelling van je nieuwe fiets na de aankoop.',
      'Een aanvullende voet- of zadelanalyse.',
    ],
    bookingServiceSlugs: [],
    metaDescription:
      'Bikefit vóór je een nieuwe fiets koopt: gesprek, blik op je houding en beweeglijkheid, en advies over maat, geometrie en afstelling.',
  },
  {
    slug: 'bikefit-huidige-fiets',
    category: 'bikefit',
    sortOrder: 20,
    title: 'Bikefit – huidige fiets',
    summary: 'Comfortabeler fietsen op de fiets die je al hebt.',
    intro: 'We bekijken hoe jij beweegt en stemmen je fiets stap voor stap op je af.',
    goal: 'Comfortabeler fietsen op de fiets die je al hebt.',
    contents: [
      'Een intakegesprek over je fietsgebruik, je doelen en wat je voelt op de fiets.',
      'We bekijken je positie en beweging met 3D-bewegingsanalyse.',
      'We kijken je zadel, stuur en schoenplaatjes na.',
      'Aanpassingen testen we samen uit, met uitleg bij elke stap.',
    ],
    duration: OFFER_DURATION_FALLBACK,
    extras: [
      'Een vervolgafspraak.',
      'Een gerichte voet- of zadelanalyse.',
      'Nieuwe onderdelen, altijd apart en vooraf besproken.',
    ],
    bookingServiceSlugs: ['volwassenenfit', 'jeugdfit'],
    metaDescription:
      'Bikefit op je huidige fiets: intake, 3D-bewegingsanalyse, zadel, stuur en schoenplaatjes, en aanpassingen die we samen uittesten.',
  },
  {
    slug: 'voetanalyse',
    category: 'bikefit',
    sortOrder: 30,
    title: 'Voetanalyse',
    summary: 'Meer inzicht in de steun en het comfort van je voeten.',
    intro:
      'Je voeten brengen elke trapbeweging over. We bekijken hoe ze samenwerken met je schoenen en pedalen.',
    goal: 'Meer inzicht in de steun en het comfort van je voeten.',
    contents: [
      'We bespreken je klachten en wensen.',
      'We bekijken je voetstand en hoe je voeten ondersteund worden.',
      'We kijken naar de pasvorm van je schoenen en mogelijke drukpunten.',
      'Je krijgt persoonlijk advies. Dat is geen medische diagnose.',
    ],
    duration: OFFER_DURATION_FALLBACK,
    extras: ['Je schoenplaatjes laten afstellen.', 'Een volledige bikefit.'],
    bookingServiceSlugs: [],
    metaDescription:
      'Voetanalyse voor fietsers: voetstand, ondersteuning, pasvorm van je schoenen en drukpunten, met persoonlijk advies.',
  },
  {
    slug: 'zadelanalyse',
    category: 'bikefit',
    sortOrder: 40,
    title: 'Zadelanalyse',
    summary: 'Een zadelpositie die beter bij jou past.',
    intro: 'Zit je niet prettig? We bekijken je zadel, houding en ondersteuning samen.',
    goal: 'Een zadelpositie die beter bij jou past.',
    contents: [
      'We bespreken je ervaringen op het zadel.',
      'We kijken naar je houding en hoe je op het zadel steunt.',
      'We bekijken de positie en afstelling van je zadel.',
      'Mogelijke aanpassingen testen we samen uit.',
    ],
    duration: OFFER_DURATION_FALLBACK,
    extras: [
      'Een ruimer bikefittraject.',
      'Een ander zadel of andere onderdelen, als dat nodig blijkt.',
    ],
    bookingServiceSlugs: [],
    metaDescription:
      'Zadelanalyse: we bekijken je zadel, houding en ondersteuning en testen samen een positie die beter bij jou past.',
  },
  {
    slug: 'afstellen-schoenplaatjes',
    category: 'bikefit',
    sortOrder: 50,
    title: 'Afstellen schoenplaatjes',
    summary: 'Een goede basis voor je trapbeweging.',
    intro:
      'Kleine aanpassingen aan je schoenplaatjes kunnen veel betekenen voor hoe je op de fiets zit.',
    goal: 'Een goede basis voor je trapbeweging.',
    contents: [
      'We kijken je schoenen en schoenplaatjes na.',
      'We bekijken de stand en positie van je plaatjes.',
      'We stellen ze af en controleren het resultaat samen.',
    ],
    duration: OFFER_DURATION_FALLBACK,
    extras: [
      'Een voetanalyse.',
      'Een volledige bikefit.',
      'Nieuwe schoenplaatjes, als dat nodig is.',
    ],
    bookingServiceSlugs: [],
    metaDescription:
      'Schoenplaatjes laten afstellen: we kijken je schoenen en plaatjes na, stellen ze af en controleren het resultaat samen.',
  },
  {
    slug: 'lactaattest',
    category: 'begeleiding',
    sortOrder: 10,
    title: 'Lactaattest',
    summary: 'Gerichter trainen met inzicht in je inspanningsniveau.',
    intro:
      'Ontdek hoe je lichaam reageert op oplopende inspanning en wat dat betekent voor je training.',
    goal: 'Gerichter trainen met inzicht in je inspanningsniveau.',
    contents: [
      'We bespreken je doelen.',
      'Je fietst een stapsgewijs oplopende inspanning, met lactaatmetingen onderweg.',
      'We bespreken de resultaten en duiden je trainingszones.',
      'Het is een sportieve meting, geen medisch onderzoek.',
    ],
    duration: OFFER_DURATION_FALLBACK,
    extras: ['Coaching.', 'Een vervolgmeting, in overleg.'],
    bookingServiceSlugs: [],
    metaDescription:
      'Lactaattest voor fietsers: stapsgewijze inspanning met lactaatmetingen, en uitleg over wat de resultaten betekenen voor je training.',
  },
  {
    slug: 'coaching',
    category: 'begeleiding',
    sortOrder: 20,
    title: 'Coaching',
    summary: 'Werk aan jouw fietsdoelen, op een manier die in je leven past.',
    intro:
      'Een eerste uitdaging of een gericht wedstrijdplan: we bouwen samen aan haalbare vooruitgang.',
    goal: 'Werk aan jouw fietsdoelen, op een manier die in je leven past.',
    contents: [
      'Een kennismaking.',
      'We bespreken je doelen en de tijd die je hebt.',
      'Je krijgt persoonlijk trainingsadvies.',
      'Opvolging en bijsturing, zoals we samen afspreken.',
    ],
    duration: 'Traject en opvolging in overleg',
    extras: ['Een lactaattest.', 'Een bikefit.', 'Aanvullende opvolging, in overleg.'],
    bookingServiceSlugs: [],
    metaDescription:
      'Fietscoaching: kennismaking, je doelen en beschikbare tijd, persoonlijk trainingsadvies en opvolging zoals we samen afspreken.',
  },
];

/** The `offer` block data for a default offer (what the seed writes). */
export function offerBlockData(offer: DefaultOffer): Record<string, unknown> {
  return {
    category: offer.category,
    sortOrder: offer.sortOrder,
    eyebrow: offer.category === 'bikefit' ? 'Aanbod · Bikefit' : 'Aanbod · Begeleiding',
    title: offer.title,
    summary: offer.summary,
    intro: offer.intro,
    ctaLabel: OFFER_CTA_LABEL,
    goal: offer.goal,
    contents: offer.contents,
    duration: offer.duration,
    priceCents: null,
    priceLabel: '',
    extras: offer.extras,
    extrasNote: OFFER_EXTRAS_NOTE,
    bookingServiceSlugs: offer.bookingServiceSlugs,
  };
}

/**
 * Offer ↔ booking-catalogue reconciliation, one row per EXISTING booking
 * service (`DEFAULT_SERVICES` in `src/lib/booking/defaults.ts`). Nothing in
 * `cms_services`, `cms_provider_services` or `cms_bookings` is changed by the
 * offer rollout; this table only records which offer links to which service.
 *
 *  - `linked`: the offer's booking button lands in the widget with this
 *    service; the service keeps its name, id and real duration, so every
 *    existing booking keeps its meaning.
 *  - `kept`: not part of the new offer; still active and still bookable from
 *    `/afspraak` without a preselected service, until Toshoni decides otherwise
 *    in Admin → Diensten (deactivating is a soft change, bookings stay).
 *
 * Tested in `catalogue.test.ts`. Open decisions are listed in the work-block report.
 */
export const BOOKING_RECONCILIATION: ReadonlyArray<{
  serviceSlug: string;
  decision: 'linked' | 'kept';
  offerSlugs: string[];
  reason: string;
}> = [
  {
    serviceSlug: 'volwassenenfit',
    decision: 'linked',
    offerSlugs: ['bikefit-huidige-fiets'],
    reason:
      'De standaard bikefit op je eigen fiets: dezelfde dienst, dezelfde 90 minuten planning.',
  },
  {
    serviceSlug: 'jeugdfit',
    decision: 'linked',
    offerSlugs: ['bikefit-huidige-fiets'],
    reason:
      'Bikefit op de huidige fiets voor een jonge fietser, met ouder of voogd; 60 minuten planning blijft.',
  },
  {
    serviceSlug: 'gezinspakket',
    decision: 'kept',
    offerSlugs: [],
    reason:
      'Komt niet terug in het nieuwe aanbod; beslissing over behouden of uitzetten ligt open.',
  },
  {
    serviceSlug: 'fit-aan-huis',
    decision: 'kept',
    offerSlugs: [],
    reason:
      'Geen aparte dienst in het nieuwe aanbod (“bij jou thuis” is een plaats, geen dienst); beslissing ligt open.',
  },
  {
    serviceSlug: 'inspanningstest',
    decision: 'kept',
    offerSlugs: [],
    reason:
      'Niet gelijkgesteld aan Lactaattest: niet bevestigd dat het dezelfde meting en duur is.',
  },
];
