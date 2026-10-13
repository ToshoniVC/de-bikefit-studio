import { z } from 'zod';
import {
  OFFER_CATEGORIES,
  OFFER_CATEGORY_LABELS,
  OFFER_CTA_LABEL,
  OFFER_DURATION_FALLBACK,
  OFFER_EXTRAS_NOTE,
  OFFER_INDEX_PATH,
  OFFER_PRICE_FALLBACK,
} from '@/lib/offers/catalogue';
import {
  emptyImage,
  eyebrow,
  imageRefSchema,
  lede,
  optionalLinkSchema,
  sectionVariantSchema,
} from './block-primitives';

/**
 * Block types for the offer ("Aanbod") and team pages, added on 13 Oct 2026.
 * Registered in `blockRegistry` (`blocks.ts`) through {@link aanbodBlockRegistry};
 * kept in their own module because `blocks.ts` is already past the size limit.
 *
 * - `offer`           one service, the same template on every offer page
 * - `offerCatalogue`  the grouped overview; its cards are DERIVED from the
 *                     published offer pages, so a title or price edited on an
 *                     offer page changes every overview without a second edit
 * - `team`            team profiles with an initials fallback for portraits
 *
 * Defaults are deliberately neutral: an editor who adds a block sees the
 * structure, not invented copy. The real copy is in `src/lib/offers/defaults.ts`.
 */

const offerCategorySchema = z.enum(OFFER_CATEGORIES);

/**
 * `offer` — one service. The page's `/aanbod/<slug>` path is the offer's
 * identity (booking links use that slug), so the block stores no slug of its
 * own. Price: a free-text `priceLabel` wins, then `priceCents`; with neither
 * the site shows "Prijs op aanvraag". The label "Prijs op aanvraag" itself
 * (the seeded placeholder) never hides a confirmed `priceCents`. `bookingServiceSlugs` points at
 * `cms_services.slug`; empty = not online bookable (contact prompt).
 */
export const offerSchema = z.object({
  category: offerCategorySchema.default('bikefit'),
  /** Position inside its category on every overview (lower first). */
  sortOrder: z.number().int().min(0).max(999).default(0),
  eyebrow,
  title: z.string().min(1),
  /** One or two sentences for the overview card; empty = the intro. */
  summary: z.string().default(''),
  intro: z.string().default(''),
  ctaLabel: z.string().min(1).default(OFFER_CTA_LABEL),
  /** Doel */
  goal: z.string().default(''),
  /** Inhoud — one item per line. */
  contents: z.array(z.string()).default([]),
  /** Duur — free text; scheduling length lives on the booking service. */
  duration: z.string().default(OFFER_DURATION_FALLBACK),
  /** Kostprijs in euro cents, once confirmed. */
  priceCents: z.number().int().nonnegative().nullable().default(null),
  /** Free-text price, e.g. "vanaf € 120"; empty or "Prijs op aanvraag" + no cents = "Prijs op aanvraag". */
  priceLabel: z.string().default(''),
  /** Mogelijke extra's — one item per line. */
  extras: z.array(z.string()).default([]),
  extrasNote: z.string().default(OFFER_EXTRAS_NOTE),
  /** `cms_services.slug` values, in order. Empty = not online bookable yet. */
  bookingServiceSlugs: z.array(z.string()).default([]),
  image: imageRefSchema.default(emptyImage),
});

/**
 * `offerCatalogue` — the grouped overview on `/aanbod`, the home page and
 * `/bikefit`. Each group shows the published offers of its category; the
 * group's title and lede are the only copy this block owns.
 */
export const offerCatalogueSchema = z.object({
  variant: sectionVariantSchema,
  eyebrow,
  title: z.string().default(''),
  lede,
  groups: z
    .array(
      z.object({
        category: offerCategorySchema,
        title: z.string().default(''),
        lede: z.string().default(''),
      }),
    )
    .default([]),
  showPrices: z.boolean().default(true),
  cta: optionalLinkSchema,
});

/**
 * `team` — one profile per person. `bio` holds only verified text; with no
 * portrait the site draws the person's initials. `internalNote` is for editors
 * (e.g. "bio nog op te vragen") and is never rendered.
 */
export const teamSchema = z.object({
  variant: sectionVariantSchema,
  eyebrow,
  title: z.string().default(''),
  lede,
  members: z
    .array(
      z.object({
        name: z.string().min(1),
        role: z.string().default(''),
        bio: z.array(z.string()).default([]),
        image: imageRefSchema.default(emptyImage),
        internalNote: z.string().default(''),
      }),
    )
    .default([]),
});

export const aanbodBlockRegistry = {
  offer: {
    label: 'Dienst (aanbod)',
    description:
      'Eén dienst uit het aanbod: inleiding, boekknop, doel, inhoud, duur, kostprijs en mogelijke extra’s. Hoort op een pagina onder /aanbod/.',
    editorHint:
      'Tijdelijke inhoud: laat “Prijs op aanvraag” en “Duur in overleg” staan tot ze bevestigd zijn. Een bevestigde prijs vul je in als bedrag in eurocent (12000 = € 120) of als prijslabel (bv. “vanaf € 120”). Open punten per dienst: register docs/content-placeholders.md (P-, D- en E-nummers).',
    schema: offerSchema,
    defaultData: {
      category: 'bikefit',
      sortOrder: 0,
      eyebrow: 'Aanbod',
      title: 'Nieuwe dienst',
      summary: '',
      intro: '',
      ctaLabel: OFFER_CTA_LABEL,
      goal: '',
      contents: [],
      duration: OFFER_DURATION_FALLBACK,
      priceCents: null,
      priceLabel: OFFER_PRICE_FALLBACK,
      extras: [],
      extrasNote: OFFER_EXTRAS_NOTE,
      bookingServiceSlugs: [],
      image: emptyImage,
    },
  },

  offerCatalogue: {
    label: 'Aanbod (overzicht)',
    description:
      'Overzicht van de gepubliceerde diensten onder /aanbod/, per categorie. Titels en prijzen komen uit de dienstpagina’s zelf.',
    schema: offerCatalogueSchema,
    defaultData: {
      variant: 'default',
      eyebrow: 'Aanbod',
      title: 'Ons aanbod',
      lede: '',
      groups: OFFER_CATEGORIES.map((category) => ({
        category,
        title: OFFER_CATEGORY_LABELS[category],
        lede: '',
      })),
      showPrices: true,
      cta: { label: 'Bekijk het volledige aanbod', href: OFFER_INDEX_PATH, external: false },
    },
  },

  team: {
    label: 'Team',
    description:
      'Teamleden met naam, rol en een korte, gecontroleerde bio. Zonder foto tonen we de initialen.',
    editorHint:
      'Vul rol, bio en foto enkel in met tekst of beeld van de persoon zelf; geen gegenereerd portret. Zonder foto tonen we de initialen. Open punten per persoon: register docs/content-placeholders.md (T-nummers) en de interne notitie.',
    schema: teamSchema,
    defaultData: {
      variant: 'default',
      eyebrow: 'Ons team',
      title: 'Ons team',
      lede: '',
      members: [],
    },
  },
} as const;
