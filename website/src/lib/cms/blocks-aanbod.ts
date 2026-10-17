import { z } from 'zod';
import { OFFER_CATEGORIES, OFFER_CATEGORY_LABELS, OFFER_INDEX_PATH } from '@/lib/offers/catalogue';
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
 * - `offerCatalogue`  the grouped overview; its cards are READ from the
 *                     offerings in Beheer → Aanbod (`cms_offerings`), so a
 *                     title or price edited there changes every overview
 *                     without a second edit. Since 17 Oct 2026 there is no
 *                     `offer` block any more: an offer has no page of its own,
 *                     `/aanbod/<slug>` is rendered from the offering.
 * - `giftVoucher`     the "Cadeaubon" order form (page `/cadeaubon`)
 * - `team`            team profiles with an initials fallback for portraits
 *
 * Defaults are deliberately neutral: an editor who adds a block sees the
 * structure, not invented copy. The real copy is in `src/lib/offers/defaults.ts`.
 */

const offerCategorySchema = z.enum(OFFER_CATEGORIES);

/**
 * `offerCatalogue` — the grouped overview on `/aanbod`, the home page and
 * `/bikefit`. Each group shows the shown offerings of its category; the
 * group's title and lede are the only copy this block owns. `extraCards` are
 * fixed cards that are not offerings (the gift voucher: "Bedrag naar keuze",
 * linking to its own page), placed after the offerings of their category.
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
  extraCards: z
    .array(
      z.object({
        category: offerCategorySchema,
        title: z.string().min(1),
        summary: z.string().default(''),
        priceLabel: z.string().default(''),
        href: z.string().min(1),
      }),
    )
    .default([]),
  showPrices: z.boolean().default(true),
  cta: optionalLinkSchema,
});

/**
 * `giftVoucher` — the "Cadeaubon" page: a short intro and the order form
 * (amount of the visitor's choice, personal message, contact details, "Bestel
 * nu"). The form and its rules are code (`src/lib/gift-voucher/`); the block
 * owns only the copy around it. Its card on `/aanbod` is an `extraCards`
 * entry of that page's `offerCatalogue` block.
 */
export const giftVoucherSchema = z.object({
  /** Kept for existing content; no longer used (the card is on the catalogue block). */
  sortOrder: z.number().int().min(0).max(999).default(0),
  eyebrow,
  title: z.string().min(1),
  /** Kept for existing content; the card text lives on the catalogue block. */
  summary: z.string().default(''),
  intro: z.string().default(''),
  /** Shown above the form; plain text. */
  formTitle: z.string().default(''),
  /** Shown once the mail provider accepted the request; empty = a neutral default. */
  sentTitle: z.string().default(''),
  sentText: z.string().default(''),
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
  offerCatalogue: {
    label: 'Aanbod (overzicht)',
    description:
      'Overzicht van het aanbod uit Beheer → Aanbod, per categorie. Titels, prijzen en status komen uit het aanbod zelf; extra kaarten (bv. de cadeaubon) vul je hier in.',
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
      extraCards: [],
      showPrices: true,
      cta: { label: 'Bekijk het volledige aanbod', href: OFFER_INDEX_PATH, external: false },
    },
  },

  giftVoucher: {
    label: 'Cadeaubon (bestelformulier)',
    description:
      'Bestelformulier voor een cadeaubon: bedrag naar keuze, persoonlijke boodschap en contactgegevens. “Bestel nu” mailt de aanvraag naar de ontvanger uit Beheer → E-mail; factuur en betaallink maak je zelf op. Hoort op /cadeaubon.',
    editorHint:
      'Zonder werkende e-mailverzending of zonder ontvanger (Beheer → E-mail) meldt het formulier dat de bestelling niet verstuurd is. Vermeld geen geldigheid of voorwaarden die nog niet beslist zijn.',
    schema: giftVoucherSchema,
    defaultData: {
      sortOrder: 0,
      eyebrow: 'Aanbod',
      title: 'Cadeaubon',
      summary: '',
      intro: '',
      formTitle: 'Bestel je cadeaubon',
      sentTitle: 'Je bestelling is verstuurd',
      sentText: '',
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
