import { z } from 'zod';
import { formatPrice } from '@/lib/booking/format';
import type { CmsImageRef } from '@/lib/cms/block-primitives';

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

export const OFFER_CATEGORIES = ['bikefit', 'begeleiding'] as const;
export type OfferCategory = (typeof OFFER_CATEGORIES)[number];

export const OFFER_CATEGORY_LABELS: Record<OfferCategory, string> = {
  bikefit: 'Bikefit',
  begeleiding: 'Begeleiding',
};

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

/**
 * One catalogue entry from a published page, or `null` when the page is not an
 * offer page (wrong path, or no `offer` block). The first `offer` block wins.
 */
export function offerFromPage(page: {
  slug: string;
  blocks: ReadonlyArray<{ type: string; data: unknown }>;
}): CatalogueOffer | null {
  const slug = offerSlugFromPageSlug(page.slug);
  if (!slug) return null;
  const block = page.blocks.find((entry) => entry.type === 'offer');
  if (!block) return null;
  const data = block.data as OfferBlockData;
  return {
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

/** Category order first (Bikefit, Begeleiding), then `sortOrder`, then title. */
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
  offers: ReadonlyArray<Pick<CatalogueOffer, 'slug' | 'title' | 'path' | 'bookingServiceSlugs'>>;
  services: readonly BookableService[];
}): BookingSelection {
  const { requested, offers, services } = input;
  if (!requested) return { kind: 'none' };

  const offer = offers.find((entry) => entry.slug === requested);
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
