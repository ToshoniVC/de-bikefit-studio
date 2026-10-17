import { z } from 'zod';
import type { CmsImageRef } from '@/lib/cms/block-primitives';
import {
  offeringBookingSlugs,
  offeringDurationLabel,
  offeringPriceLabel,
  type OfferingStatus,
  type ResolvedOffering,
  type ResolvedVariant,
} from './offering';
import type { OfferingContent } from './offering-content';

/**
 * The public offer ("Aanbod") and how it meets the booking catalogue.
 *
 * Plain module: no I/O, no Next, no `server-only` — unit-tested in
 * `catalogue.test.ts` and shared by the block renderers, the offer page, the
 * booking block, the seed and the bootstrap.
 *
 * Two vocabularies exist on purpose and are kept apart:
 *
 *  - an **offering** is what a visitor reads: one row in `cms_offerings`
 *    (Beheer → Aanbod) shown on `/aanbod` and at `/aanbod/<slug>` (title,
 *    intro, Doel, Inhoud, Duur, Kostprijs, Mogelijke extra's). Its slug is the
 *    last URL segment and what `?dienst=` carries.
 *  - a **booking service** is a `cms_services` row: a bookable slot length
 *    with providers behind it, written by the same admin form as a variant of
 *    an offering. Its id and slug are what existing bookings reference.
 *
 * The server resolves an offering's settings against who offers what
 * (`ResolvedOffering`, `./offering.ts`) and hands it to {@link offerFromOffering},
 * which derives the card, the labels and `bookingServiceSlugs` from the
 * bookable variants. Empty means "not online bookable": the booking page then
 * shows a prompt that names the offer instead of a widget with an unrelated
 * default fit. Nothing here ever creates or re-subscribes a booking service.
 */

/** Overview order; `overige` (13 Oct 2026) holds the gift voucher card, after the services. */
export const OFFER_CATEGORIES = ['bikefit', 'begeleiding', 'overige'] as const;
export type OfferCategory = (typeof OFFER_CATEGORIES)[number];

export const OFFER_CATEGORY_LABELS: Record<OfferCategory, string> = {
  bikefit: 'Bikefit',
  begeleiding: 'Begeleiding',
  overige: 'Overige',
};

/** Card price line of the gift voucher: the visitor chooses the amount. */
export const GIFT_VOUCHER_PRICE_LABEL = 'Bedrag naar keuze';

/** Offerings are served at `/aanbod/<slug>`; the overview page is the CMS page `aanbod`. */
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

/** `/aanbod/<slug>` — where an offering is served. */
export function offerPagePath(offerSlug: string): string {
  return `/${OFFER_PAGE_PREFIX}/${offerSlug}`;
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
  if (normalized === OFFER_PAGE_PREFIX) return true;
  const prefix = `${OFFER_PAGE_PREFIX}/`;
  return normalized.startsWith(prefix) && SLUG_PATTERN.test(normalized.slice(prefix.length));
}

/** `/afspraak?dienst=<slug>#boeken` — the booking block's section anchor. */
export function offerBookingHref(offerSlug: string): string {
  return `${BOOKING_PAGE_PATH}?${SERVICE_PARAM}=${encodeURIComponent(offerSlug)}#boeken`;
}

export function offerDurationLabel(duration: string): string {
  return duration.trim() || OFFER_DURATION_FALLBACK;
}

// ---------------------------------------------------------------------------
// `?dienst=` and `/aanbod/<slug>` — the URL boundary
// ---------------------------------------------------------------------------

export const serviceParamSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(80)
  .regex(SLUG_PATTERN);

/** A valid slug from `?dienst=` (first value if repeated) or a route segment, or `null`. */
export function parseServiceParam(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = serviceParamSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Catalogue entries derived from offerings
// ---------------------------------------------------------------------------

export type CatalogueOffer = {
  /** The `cms_offerings` id. */
  id: string;
  slug: string;
  path: string;
  category: OfferCategory;
  sortOrder: number;
  title: string;
  /** Card text: the summary, else the intro. */
  summary: string;
  priceLabel: string;
  durationLabel: string;
  /** Booking services `/afspraak` may use for this offer, in variant order; empty = not online bookable. */
  bookingServiceSlugs: string[];
  /** Bookable, temporarily unavailable or enquiry only. */
  status: OfferingStatus;
  /** The resolved variants. */
  variants: ResolvedVariant[];
  image: CmsImageRef;
};

/** One catalogue entry from an offering's copy and its resolved settings. */
export function offerFromOffering(
  record: { id: string; content: OfferingContent },
  offering: ResolvedOffering,
): CatalogueOffer {
  const { content } = record;
  return {
    id: record.id,
    slug: content.slug,
    path: offerPagePath(content.slug),
    category: content.category,
    sortOrder: content.sortOrder,
    title: content.title,
    summary: content.summary.trim() || content.intro.trim(),
    priceLabel: offeringPriceLabel(offering),
    durationLabel: offeringDurationLabel(offering, content.duration),
    bookingServiceSlugs: offeringBookingSlugs(offering),
    status: offering.status,
    variants: offering.variants,
    image: content.image,
  };
}

/** Category order first (Bikefit, Begeleiding, Overige), then `sortOrder`, then title. */
export function sortOffers<T extends Pick<CatalogueOffer, 'category' | 'sortOrder' | 'title'>>(
  offers: readonly T[],
): T[] {
  return [...offers].sort(
    (a, b) =>
      OFFER_CATEGORIES.indexOf(a.category) - OFFER_CATEGORIES.indexOf(b.category) ||
      a.sortOrder - b.sortOrder ||
      a.title.localeCompare(b.title, 'nl'),
  );
}

export function offersInCategory<
  T extends Pick<CatalogueOffer, 'category' | 'sortOrder' | 'title'>,
>(offers: readonly T[], category: OfferCategory): T[] {
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
      /**
       * `status` tells an empty `serviceIds` apart: `enquiry` (asked for through
       * the form on the offer page, on purpose) or `unavailable` (direct booking,
       * but nobody offers it right now). `null` when unknown.
       */
      offer: { slug: string; title: string; path: string; status: OfferingStatus | null };
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
      status?: OfferingStatus | null;
    }
  >;
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
      offer: {
        slug: offer.slug,
        title: offer.title,
        path: offer.path,
        status: offer.status ?? null,
      },
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
 *  - `service`: a bookable service no shown offer links to, chosen directly;
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
 * Groups the bookable `services` (already in display order) under the offers
 * that link to them. An offer takes the place of its first service in the
 * list; a service claimed by an earlier offer (category, sort order, title) is
 * not repeated under a later one. Offers without a bookable service add
 * nothing. Pure: a missing or empty offer list gives one `service` entry per
 * service, the widget as it was before.
 */
export function groupBookingChoices(input: {
  offers: ReadonlyArray<
    Pick<
      CatalogueOffer,
      'slug' | 'title' | 'path' | 'bookingServiceSlugs' | 'category' | 'sortOrder'
    >
  >;
  services: readonly BookableService[];
}): BookingChoice[] {
  const { services } = input;
  const offers = sortOffers(input.offers);

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
