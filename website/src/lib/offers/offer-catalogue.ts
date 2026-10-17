import { formatPrice } from '@/lib/booking/format';
import { offerFromOffering, sortOffers, type CatalogueOffer } from './catalogue';
import {
  resolveOffering,
  withheldServiceIds,
  type OfferingServiceInfo,
  type OfferingSettings,
  type ResolvedOffering,
} from './offering';
import type { OfferingContent, OfferingRecord } from './offering-content';

/**
 * Builds the public offer catalogue from the stored offerings (Beheer →
 * Aanbod) and who offers what. Pure (no I/O) and unit-tested in
 * `offer-catalogue.test.ts`; the server wiring is `src/lib/cms/offers-content.ts`.
 *
 * Per offering: its settings resolved against the services and the providers
 * (`resolveOffering`), then the card (`offerFromOffering`). A hidden offering
 * ("Tonen op de website" off) is left out of `offers` and its slug listed in
 * `hiddenSlugs`, so its page is served as a 404 and its services are held
 * back from `/afspraak`.
 */

export type CatalogueOfferEntry = {
  offer: CatalogueOffer;
  offering: ResolvedOffering;
  content: OfferingContent;
};

export type VariantDisplay = {
  /** "Volwassene" / "Jeugd"; '' = keep the service's own label. */
  label: string;
  /** "€ 150,00", or '' for "Prijs op aanvraag". */
  priceLabel: string;
};

export type OfferCatalogue = {
  /** Listed offers, sorted for the overviews. */
  offers: CatalogueOffer[];
  /** Every offering, listed or not, keyed by slug. */
  bySlug: Record<string, CatalogueOfferEntry>;
  /** Offerings not shown on the website. */
  hiddenSlugs: string[];
  /** Services `/afspraak` must not offer on their own (see `withheldServiceIds()`). */
  withheldServiceIds: string[];
  /**
   * For the booking widget: how a service is labelled and priced under the
   * shown, directly bookable offering it is a variant of.
   */
  variantDisplay: Record<string, VariantDisplay>;
};

export function buildOfferCatalogue(input: {
  offerings: readonly OfferingRecord[];
  services: readonly OfferingServiceInfo[];
  bookableServiceIds: ReadonlySet<string>;
}): OfferCatalogue {
  const bySlug: Record<string, CatalogueOfferEntry> = {};
  const listed: CatalogueOfferEntry[] = [];
  const hiddenSlugs: string[] = [];
  const visibility: Array<{ visible: boolean; settings: OfferingSettings }> = [];

  for (const record of input.offerings) {
    const offering = resolveOffering({
      settings: record.settings,
      source: 'stored',
      services: input.services,
      bookableServiceIds: input.bookableServiceIds,
    });
    const entry: CatalogueOfferEntry = {
      offer: offerFromOffering(record, offering),
      offering,
      content: record.content,
    };
    bySlug[record.content.slug] = entry;
    visibility.push({ visible: record.settings.isListed, settings: record.settings });
    if (!offering.isListed) {
      hiddenSlugs.push(record.content.slug);
      continue;
    }
    listed.push(entry);
  }

  const offers = sortOffers(listed.map((entry) => entry.offer));
  const order = new Map(offers.map((offer, index) => [offer.slug, index]));
  const variantDisplay: Record<string, VariantDisplay> = {};
  for (const { offering } of [...listed].sort(
    (a, b) => (order.get(a.offer.slug) ?? 0) - (order.get(b.offer.slug) ?? 0),
  )) {
    if (offering.bookingMode !== 'direct') continue;
    for (const variant of offering.variants) {
      if (!variant.serviceId || variantDisplay[variant.serviceId]) continue;
      variantDisplay[variant.serviceId] = {
        label: variant.label,
        priceLabel: variant.priceCents != null ? formatPrice(variant.priceCents) : '',
      };
    }
  }

  return {
    offers,
    bySlug,
    hiddenSlugs,
    withheldServiceIds: [...withheldServiceIds(visibility)],
    variantDisplay,
  };
}
