import { z } from 'zod';
import { formatPrice } from '@/lib/booking/format';
import { emptyImage, type CmsImageRef } from '@/lib/cms/block-primitives';

/**
 * The public offer ("Aanbod") and how it meets the booking catalogue.
 *
 * Plain module: no I/O, no Next, no `server-only` — unit-tested in
 * `catalogue.test.ts` and shared by the block renderers, the booking block,
 * the seed and the staging rollout.
 *
 * Two vocabularies exist on purpose and are kept apart:
 *
 *  - an **offer** is what a visitor reads: one CMS page per offer at
 *    `/aanbod/<slug>` carrying one `offer` block (title, intro, Doel, Inhoud,
 *    Duur, Kostprijs, Mogelijke extra's). Its slug is the last URL segment.
 *  - a **booking service** is a `cms_services` row: a bookable slot length with
 *    providers behind it. Its id and slug are what existing bookings reference.
 *
 * An offer points at zero or more booking services through
 * `bookingServiceSlugs` (editable in the CMS). Zero means "not online
 * bookable yet": the booking page then shows a contact prompt that names the
 * offer instead of a widget with an unrelated default fit. Nothing here ever
 * renames, creates or re-subscribes a booking service.
 */

/** Overview order; `overige` (13 Oct 2026) holds the gift voucher, after the services. */
export const OFFER_CATEGORIES = ['bikefit', 'begeleiding', 'overige'] as const;
export type OfferCategory = (typeof OFFER_CATEGORIES)[number];

export const OFFER_CATEGORY_LABELS: Record<OfferCategory, string> = {
  bikefit: 'Bikefit',
  begeleiding: 'Begeleiding',
  overige: 'Overige',
};

/** Card price line of the gift voucher: the visitor chooses the amount. */
export const GIFT_VOUCHER_PRICE_LABEL = 'Bedrag naar keuze';

/** Offer pages live at `cms_pages.slug = 'aanbod/<offer slug>'`. */
export const OFFER_PAGE_PREFIX = 'aanbod';
export const OFFER_INDEX_PATH = `/${OFFER_PAGE_PREFIX}`;

/** The exact label of the booking button on every offer page (work block 2026-10-13). */
export const OFFER_CTA_LABEL = 'Boek een afspraak voor deze dienst';
/** Shown while no confirmed price exists. Never € 0, never an invented amount. */
export const OFFER_PRICE_FALLBACK = 'Prijs op aanvraag';
/** Shown while no confirmed duration exists for the offer. */
export const OFFER_DURATION_FALLBACK = 'Duur in overleg';
export const OFFER_EXTRAS_NOTE =
  'Wat er precies bij komt en wat het kost, spreken we altijd vooraf samen met je af.';

export const BOOKING_PAGE_PATH = '/afspraak';
/** Query parameter that carries the chosen offer (or booking service) slug. */
export const SERVICE_PARAM = 'dienst';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isOfferCategory(value: string): value is OfferCategory {
  return (OFFER_CATEGORIES as readonly string[]).includes(value);
}

export function offerPageSlug(offerSlug: string): string {
  return `${OFFER_PAGE_PREFIX}/${offerSlug}`;
}

export function offerPagePath(offerSlug: string): string {
  return `/${offerPageSlug(offerSlug)}`;
}

/** `'aanbod/voetanalyse'` → `'voetanalyse'`; anything else → `null`. */
export function offerSlugFromPageSlug(pageSlug: string): string | null {
  const normalized = pageSlug.replace(/^\/+/, '').replace(/\/+$/, '');
  const prefix = `${OFFER_PAGE_PREFIX}/`;
  if (!normalized.startsWith(prefix)) return null;
  const rest = normalized.slice(prefix.length);
  return SLUG_PATTERN.test(rest) ? rest : null;
}

/**
 * Offer prices are shown only on `/aanbod` and on the offer pages under it
 * (Toshoni, 13 Oct 2026): never on the home page or other marketing pages, even
 * when an overview block there has "Prijzen tonen" switched on. Booking,
 * checkout and the admin keep their own price display; this rule is about the
 * offer overviews only.
 */
export function showsOfferPrices(pageSlug: string): boolean {
  const normalized = pageSlug.replace(/^\/+/, '').replace(/\/+$/, '');
  return normalized === OFFER_PAGE_PREFIX || offerSlugFromPageSlug(normalized) !== null;
}

/** `/afspraak?dienst=<slug>#boeken` — the booking block's section anchor. */
export function offerBookingHref(offerSlug: string): string {
  return `${BOOKING_PAGE_PATH}?${SERVICE_PARAM}=${encodeURIComponent(offerSlug)}#boeken`;
}

/**
 * Free-text label wins, then a confirmed amount in cents, else "Prijs op
 * aanvraag". The seed writes "Prijs op aanvraag" into the label so editors see
 * the placeholder in the CMS; that placeholder never hides a confirmed amount,
 * so filling in only the cents is enough.
 */
export function offerPriceLabel(input: { priceCents: number | null; priceLabel: string }): string {
  const label = input.priceLabel.trim();
  const isPlaceholder = label.toLowerCase() === OFFER_PRICE_FALLBACK.toLowerCase();
  if (label && !(isPlaceholder && input.priceCents != null)) return label;
  if (input.priceCents != null) return formatPrice(input.priceCents);
  return OFFER_PRICE_FALLBACK;
}

export function offerDurationLabel(duration: string): string {
  return duration.trim() || OFFER_DURATION_FALLBACK;
}

// ---------------------------------------------------------------------------
// `?dienst=` — query-string boundary
// ---------------------------------------------------------------------------

export const serviceParamSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(80)
  .regex(SLUG_PATTERN);

/** A valid slug from `?dienst=` (first value if repeated), or `null`. */
export function parseServiceParam(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = serviceParamSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Catalogue entries derived from published offer pages
// ---------------------------------------------------------------------------

/** The fields of an `offer` block the catalogue needs (structural, so tests need no registry). */
export type OfferBlockData = {
  category: OfferCategory;
  sortOrder: number;
  title: string;
  summary: string;
  intro: string;
  duration: string;
  priceCents: number | null;
  priceLabel: string;
  bookingServiceSlugs: string[];
  image: CmsImageRef;
};

export type CatalogueOffer = {
  /** `service`: an `offer` block (bookable or enquiry); `giftVoucher`: the order form, never booked. */
  kind: 'service' | 'giftVoucher';
  slug: string;
  path: string;
  category: OfferCategory;
  sortOrder: number;
  title: string;
  /** Card text: the summary, else the intro. */
  summary: string;
  priceLabel: string;
  durationLabel: string;
  bookingServiceSlugs: string[];
  image: CmsImageRef;
};

/** The fields of a `giftVoucher` block the catalogue needs. */
export type GiftVoucherBlockData = {
  sortOrder: number;
  title: string;
  summary: string;
  intro: string;
};

/**
 * One catalogue entry from a published page, or `null` when the page is not an
 * offer page (wrong path, or no `offer` / `giftVoucher` block). The first
 * `offer` block wins; a page with only a `giftVoucher` block becomes a card
 * under Overige with "Bedrag naar keuze".
 */
export function offerFromPage(page: {
  slug: string;
  blocks: ReadonlyArray<{ type: string; data: unknown }>;
}): CatalogueOffer | null {
  const slug = offerSlugFromPageSlug(page.slug);
  if (!slug) return null;
  const block = page.blocks.find((entry) => entry.type === 'offer');
  if (!block) {
    const voucher = page.blocks.find((entry) => entry.type === 'giftVoucher');
    if (!voucher) return null;
    const data = voucher.data as GiftVoucherBlockData;
    return {
      kind: 'giftVoucher',
      slug,
      path: offerPagePath(slug),
      category: 'overige',
      sortOrder: data.sortOrder,
      title: data.title,
      summary: data.summary.trim() || data.intro.trim(),
      priceLabel: GIFT_VOUCHER_PRICE_LABEL,
      durationLabel: '',
      bookingServiceSlugs: [],
      image: { ...emptyImage },
    };
  }
  const data = block.data as OfferBlockData;
  return {
    kind: 'service',
    slug,
    path: offerPagePath(slug),
    category: data.category,
    sortOrder: data.sortOrder,
    title: data.title,
    summary: data.summary.trim() || data.intro.trim(),
    priceLabel: offerPriceLabel(data),
    durationLabel: offerDurationLabel(data.duration),
    bookingServiceSlugs: data.bookingServiceSlugs.map((entry) => entry.trim()).filter(Boolean),
    image: data.image,
  };
}

/** Category order first (Bikefit, Begeleiding, Overige), then `sortOrder`, then title. */
export function sortOffers(offers: readonly CatalogueOffer[]): CatalogueOffer[] {
  return [...offers].sort(
    (a, b) =>
      OFFER_CATEGORIES.indexOf(a.category) - OFFER_CATEGORIES.indexOf(b.category) ||
      a.sortOrder - b.sortOrder ||
      a.title.localeCompare(b.title, 'nl'),
  );
}

export function offersInCategory(
  offers: readonly CatalogueOffer[],
  category: OfferCategory,
): CatalogueOffer[] {
  return sortOffers(offers).filter((offer) => offer.category === category);
}

// ---------------------------------------------------------------------------
// Booking preselection
// ---------------------------------------------------------------------------

export type BookableService = { id: string; slug: string };

export type BookingSelection =
  /** No (valid) `?dienst=`: the normal widget. */
  | { kind: 'none' }
  /** A well-formed slug that matches no offer and no bookable service. */
  | { kind: 'unknown'; requested: string }
  /** A booking-service slug (legacy links such as `?dienst=volwassenenfit`). */
  | { kind: 'service'; serviceId: string }
  /**
   * An offer. `serviceIds` are the bookable services it maps to, in the
   * offer's order; empty means "not online bookable" → contact prompt.
   */
  | {
      kind: 'offer';
      offer: { slug: string; title: string; path: string };
      serviceIds: string[];
      initialServiceId: string | null;
    };

/**
 * Decides what `/afspraak?dienst=<slug>` shows.
 *
 * `services` must already be the services this booking block may offer
 * (active, offered by a provider, inside the block's own filter). An offer slug
 * wins over a booking-service slug, because offers are the public vocabulary.
 * Nothing falls back to another service: an offer without a bookable mapping
 * stays an offer with `serviceIds: []`.
 */
export function resolveBookingSelection(input: {
  requested: string | null;
  offers: ReadonlyArray<
    Pick<CatalogueOffer, 'slug' | 'title' | 'path' | 'bookingServiceSlugs'> & {
      kind?: CatalogueOffer['kind'];
    }
  >;
  services: readonly BookableService[];
}): BookingSelection {
  const { requested, offers, services } = input;
  if (!requested) return { kind: 'none' };

  // The gift voucher is ordered on its own page, never through the booking page.
  const offer = offers.find((entry) => entry.slug === requested && entry.kind !== 'giftVoucher');
  if (offer) {
    const serviceIds: string[] = [];
    for (const slug of offer.bookingServiceSlugs) {
      const service = services.find((entry) => entry.slug === slug);
      if (service && !serviceIds.includes(service.id)) serviceIds.push(service.id);
    }
    return {
      kind: 'offer',
      offer: { slug: offer.slug, title: offer.title, path: offer.path },
      serviceIds,
      initialServiceId: serviceIds.length === 1 ? serviceIds[0] : null,
    };
  }

  const service = services.find((entry) => entry.slug === requested);
  if (service) return { kind: 'service', serviceId: service.id };

  return { kind: 'unknown', requested };
}

// ---------------------------------------------------------------------------
// The service step: one choice per offer, the offer's services underneath
// ---------------------------------------------------------------------------

/**
 * One entry of the booking widget's first step (work block 2026-10-16):
 *  - `service`: a bookable service no published offer links to (Gezinspakket,
 *    Fit aan huis, Inspanningstest), chosen directly as before;
 *  - `offer`: an offer linked to bookable services ("Bikefit – huidige fiets"),
 *    shown ONCE, with its services as a sub-selection ("Volwassene", "Jeugd").
 *    The chosen service, never the offer, is what is booked: its id, duration,
 *    guardian rule, availability and price (`cms_services`) apply.
 */
export type BookingChoice =
  | { kind: 'service'; serviceId: string }
  | {
      kind: 'offer';
      offer: { slug: string; title: string; path: string };
      /** In the offer's order (`bookingServiceSlugs`); at least one. */
      serviceIds: string[];
    };

/**
 * Groups the bookable `services` (already in display order) under the
 * published offers that link to them. An offer takes the place of its first
 * service in the list; a service claimed by an earlier offer (category, sort
 * order, title) is not repeated under a later one. Offers without a bookable
 * service and the gift voucher add nothing. Pure: a missing or empty offer list
 * gives one `service` entry per service, the widget as it was before.
 */
export function groupBookingChoices(input: {
  offers: ReadonlyArray<
    Pick<
      CatalogueOffer,
      'slug' | 'title' | 'path' | 'bookingServiceSlugs' | 'category' | 'sortOrder'
    > & {
      kind?: CatalogueOffer['kind'];
    }
  >;
  services: readonly BookableService[];
}): BookingChoice[] {
  const { services } = input;
  const offers = [...input.offers]
    .filter((offer) => offer.kind !== 'giftVoucher')
    .sort(
      (a, b) =>
        OFFER_CATEGORIES.indexOf(a.category) - OFFER_CATEGORIES.indexOf(b.category) ||
        a.sortOrder - b.sortOrder ||
        a.title.localeCompare(b.title, 'nl'),
    );

  const claimedBy = new Map<string, number>();
  const groups: Array<{ offer: (typeof offers)[number]; serviceIds: string[] }> = [];
  for (const offer of offers) {
    const serviceIds: string[] = [];
    for (const slug of offer.bookingServiceSlugs) {
      const service = services.find((entry) => entry.slug === slug.trim());
      if (service && !claimedBy.has(service.id) && !serviceIds.includes(service.id)) {
        serviceIds.push(service.id);
      }
    }
    if (serviceIds.length === 0) continue;
    for (const id of serviceIds) claimedBy.set(id, groups.length);
    groups.push({ offer, serviceIds });
  }

  const choices: BookingChoice[] = [];
  const placed = new Set<number>();
  for (const service of services) {
    const group = claimedBy.get(service.id);
    if (group === undefined) {
      choices.push({ kind: 'service', serviceId: service.id });
      continue;
    }
    if (placed.has(group)) continue;
    placed.add(group);
    const { offer, serviceIds } = groups[group];
    choices.push({
      kind: 'offer',
      offer: { slug: offer.slug, title: offer.title, path: offer.path },
      serviceIds,
    });
  }
  return choices;
}

/** The label of a service under its offer: the catalogue's choice label, else its name. */
export function bookingChoiceLabel(service: { name: string; choiceLabel: string }): string {
  return service.choiceLabel.trim() || service.name;
}
