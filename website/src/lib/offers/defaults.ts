import { editorialImage, type EditorialSlot } from '@/lib/studio/editorial-images';
import { OFFER_DURATION_FALLBACK, OFFER_EXTRAS_NOTE, type OfferCategory } from './catalogue';
import type { OfferingAudience, OfferingBookingMode, OfferingVariantMode } from './offering';
import type { OfferingContent } from './offering-content';

/**
 * The offer as first published on 13 Oct 2026, now as offerings (17 Oct 2026):
 * what `npm run cms:bootstrap` writes to `cms_offerings` when a row with the
 * slug is missing. Plain data, no I/O.
 *
 * COPY PROVENANCE: work block `2026-10-13-aanbod-staging-brief.md` ("Suggested
 * service content", supplied by Toshoni via Winston). Nothing beyond it:
 *  - no prices (none confirmed) → "Prijs op aanvraag" (an empty price);
 *  - no durations (none confirmed) → "Duur in overleg" / "Traject en
 *    opvolging in overleg" for what is asked for; what is booked online shows
 *    the real length of its service (`src/lib/booking/defaults.ts`);
 *  - no device brands, medical claims, guarantees or included products.
 *
 * Booking: *Bikefit – huidige fiets* is booked directly as the existing
 * Volwassenenfit (Volwassene) and Jeugdfit (Jeugd); the six others are asked
 * for through the enquiry form until Toshoni confirms a duration and a
 * provider. The three older services that are not in the offer (Gezinspakket,
 * Fit aan huis, Inspanningstest) are kept as offerings that are NOT shown on
 * the website — and therefore not bookable — until an admin shows them
 * (`docs/content-placeholders.md` K-03, K-04).
 *
 * Every field stays editable in Beheer → Aanbod. Every placeholder is listed in
 * `docs/content-placeholders.md` (P-, D-, E-rows).
 */

export type DefaultOfferingVariant = {
  audience: OfferingAudience;
  /** An existing `cms_services.slug` (from `DEFAULT_SERVICES`), or `null` for an enquiry. */
  serviceSlug: string | null;
};

export type DefaultOffering = {
  content: OfferingContent;
  isListed: boolean;
  bookingMode: OfferingBookingMode;
  variantMode: OfferingVariantMode;
  variants: DefaultOfferingVariant[];
};

/** The three temporary AI images (`docs/editorial-images.md`): one per category, the lactate test apart. */
function offerImage(slug: string, category: Exclude<OfferCategory, 'overige'>) {
  const slot: EditorialSlot =
    slug === 'lactaattest'
      ? 'flemish-cyclists'
      : category === 'bikefit'
        ? 'bikefit-studio'
        : 'junior-coaching';
  return editorialImage(slot);
}

function offer(
  content: Omit<OfferingContent, 'extrasNote' | 'ctaLabel' | 'image' | 'category'> & {
    category: Exclude<OfferCategory, 'overige'>;
  },
  booking: Pick<DefaultOffering, 'bookingMode' | 'variantMode' | 'variants'>,
): DefaultOffering {
  return {
    content: {
      ...content,
      extrasNote: OFFER_EXTRAS_NOTE,
      ctaLabel: '',
      image: offerImage(content.slug, content.category),
    },
    isListed: true,
    ...booking,
  };
}

const enquiry: Pick<DefaultOffering, 'bookingMode' | 'variantMode' | 'variants'> = {
  bookingMode: 'enquiry',
  variantMode: 'single',
  variants: [{ audience: 'all', serviceSlug: null }],
};

/** The seven offers of the brief, in overview order. */
export const DEFAULT_OFFERS: DefaultOffering[] = [
  offer(
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
      metaDescription:
        'Bikefit vóór je een nieuwe fiets koopt: gesprek, blik op je houding en beweeglijkheid, en advies over maat, geometrie en afstelling.',
    },
    enquiry,
  ),
  offer(
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
      metaDescription:
        'Bikefit op je huidige fiets: intake, 3D-bewegingsanalyse, zadel, stuur en schoenplaatjes, en aanpassingen die we samen uittesten.',
    },
    {
      bookingMode: 'direct',
      variantMode: 'audience',
      variants: [
        { audience: 'adult', serviceSlug: 'volwassenenfit' },
        { audience: 'youth', serviceSlug: 'jeugdfit' },
      ],
    },
  ),
  offer(
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
      metaDescription:
        'Voetanalyse voor fietsers: voetstand, ondersteuning, pasvorm van je schoenen en drukpunten, met persoonlijk advies.',
    },
    enquiry,
  ),
  offer(
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
      metaDescription:
        'Zadelanalyse: we bekijken je zadel, houding en ondersteuning en testen samen een positie die beter bij jou past.',
    },
    enquiry,
  ),
  offer(
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
      metaDescription:
        'Schoenplaatjes laten afstellen: we kijken je schoenen en plaatjes na, stellen ze af en controleren het resultaat samen.',
    },
    enquiry,
  ),
  offer(
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
      metaDescription:
        'Lactaattest voor fietsers: stapsgewijze inspanning met lactaatmetingen, en uitleg over wat de resultaten betekenen voor je training.',
    },
    enquiry,
  ),
  offer(
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
      metaDescription:
        'Fietscoaching: kennismaking, je doelen en beschikbare tijd, persoonlijk trainingsadvies en opvolging zoals we samen afspreken.',
    },
    enquiry,
  ),
];

/**
 * Everything the bootstrap writes: the seven offers of the brief. The older
 * services (`RETIRED_SERVICE_SLUGS` in `@/lib/booking/defaults`) are no
 * longer written, not even hidden (17 Oct 2026).
 */
export const DEFAULT_OFFERINGS: DefaultOffering[] = DEFAULT_OFFERS;
