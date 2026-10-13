/**
 * Building blocks shared by the page seeds (`scripts/cms-seed.mts`) and the
 * offer rollout (`scripts/cms-rollout-aanbod.mts`). Plain data, no I/O.
 *
 * Provenance of the reused copy: `prototype/index.html`,
 * `prototype/bikefit.html` (see the header of `scripts/cms-seed.mts`).
 */

export type SeedBlock = { type: string; data: Record<string, unknown> };

export type SeedPage = {
  slug: string;
  title: string;
  translationGroup: string;
  /** Where every string on this page comes from. */
  source: string;
  metaTitle: string;
  metaDescription: string;
  structuredDataType: string;
  blocks: SeedBlock[];
};

export type SeedNavigationItem = {
  label: string;
  href: string;
  external: boolean;
  group: string;
  children: { label: string; href: string; external: boolean }[];
};

export const PHONE_LABEL = '0473 95 26 33';
export const PHONE_HREF = 'tel:+32473952633';
/** Public e-mail address, confirmed by Toshoni on 13 Oct 2026 (register G-01). */
export const CONTACT_EMAIL = 'info@debikefitstudio.be';
export const BOOKING_PATH = '/afspraak';

/** "Vier dingen, één positie" — prototype/index.html + bikefit.html. */
export const INSPECTION_CARDS = [
  {
    label: '01 / Houding',
    title: 'Je houding',
    body: 'Hoe je op de fiets zit bepaalt veel: comfort, kracht, en hoe lang je het volhoudt zonder klachten.',
  },
  {
    label: '02 / Trapbeweging',
    title: 'Je trapbeweging',
    body: 'Hoe je rondtrapt: heupen, knieën, voeten — en waar er iets vastloopt in die beweging.',
  },
  {
    label: '03 / Zadel',
    title: 'Zadelpositie',
    body: 'Hoogte, hoek en horizontale plaats van je zadel, met feedback na elke aanpassing.',
  },
  {
    label: '04 / Patronen',
    title: 'Bewegingspatronen',
    body: 'Gewoontes die je lichaam heeft aangeleerd. We brengen ze in kaart en leggen uit wat ze je kosten.',
  },
];

/** "Hoe verloopt een bikefit?" — prototype/index.html #werkwijze. */
export const PROCESS_STEPS = [
  {
    number: '01',
    title: 'Gesprek',
    body: 'We beginnen met een gesprek over jouw lichaam, je doelen en je klachten.',
  },
  {
    number: '02',
    title: 'Kijken',
    body: 'Daarna kijken we naar jou op de fiets — houding, trapbeweging, zadelpositie, bewegingspatronen.',
  },
  {
    number: '03',
    title: 'Aanpassen',
    body: 'We passen stap voor stap aan, met feedback na elke aanpassing, tot alles klopt.',
  },
  {
    number: '04',
    title: 'Begrijpen',
    body: 'Je vertrekt met begrip waarom jouw fiets staat zoals ze staat.',
  },
];

export const CONTACT_BLOCK: SeedBlock = {
  type: 'contact',
  data: {
    variant: 'default',
    eyebrow: 'Contact',
    title: 'Boek je bikefit',
    lede: '',
    phoneLabel: PHONE_LABEL,
    phoneHref: PHONE_HREF,
    email: '',
    addressLines: [],
    city: 'Ninove',
    hours: 'Op afspraak',
    mapEmbedUrl: '',
    cta: null,
  },
};

/** Closing band on the FAQ; books like the header's "Afspraak maken". */
export const CALLOUT_BLOCK: SeedBlock = {
  type: 'cta',
  data: {
    variant: 'accent',
    title: 'Comfort is een keuze. Maak ze.',
    body: '',
    primaryCta: { label: 'Boek je bikefit →', href: BOOKING_PATH, external: false },
    secondaryCta: null,
  },
};
