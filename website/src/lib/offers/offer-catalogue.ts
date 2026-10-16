import { formatPrice } from '@/lib/booking/format';
import { offerFromPage, offerSlugFromPageSlug, sortOffers, type CatalogueOffer } from './catalogue';
import {
  resolveOffering,
  withheldServiceIds,
  type OfferingServiceInfo,
  type OfferingSettings,
  type OfferingSource,
  type ResolvedOffering,
} from './offering';
import { deriveLegacyOffering } from './offering-legacy';

/**
 * Builds the public offer catalogue from the published offer pages, the stored
 * offering settings and who offers what. Pure (no I/O) and unit-tested in
 * `offer-catalogue.test.ts`; the server wiring is `src/lib/cms/offers-content.ts`.
 *
 * Per published page under `/aanbod/`:
 *  - with an `offer` block: its stored settings (`cms_offerings`), else the
 *    settings derived from the block as before Beheer → Aanbod existed
 *    (`deriveLegacyOffering()`), resolved against the services;
 *  - with only a `giftVoucher` block: the gift voucher card, unchanged.
 *
 * A hidden offering ("Tonen op de website" off) is left out of `offers` and
 * its page id is listed in `hiddenPageIds`, so its page is served as a 404.
 */

export type CataloguePage = {
  id: string;
  slug: string;
  blocks: ReadonlyArray<{ type: string; data: unknown }>;
};

export type CatalogueOfferEntry = {
  offer: CatalogueOffer;
  /** `null` for the gift voucher. */
  offering: ResolvedOffering | null;
};

export type VariantDisplay = {
  /** "Volwassene" / "Jeugd"; '' = keep the service's own label. */
  label: string;
  /** "€ 150,00", or '' for "Prijs op aanvraag". */
  priceLabel: string;
};

export type OfferCatalogue = {
  /** Listed offers (and the gift voucher), sorted for the overviews. */
  offers: CatalogueOffer[];
  /** Every published offer page, listed or not, keyed by page id. */
  byPageId: Record<string, CatalogueOfferEntry>;
  /** Published offer pages whose offering is not shown on the website. */
  hiddenPageIds: string[];
  /** Services `/afspraak` must not offer on their own (see `withheldServiceIds()`). */
  withheldServiceIds: string[];
  /**
   * For the booking widget: how a service is labelled and priced under the
   * stored, shown, directly bookable offering it is a variant of.
   */
  variantDisplay: Record<string, VariantDisplay>;
};

type LegacyBlockData = {
  bookingServiceSlugs?: unknown;
  priceCents?: unknown;
  priceLabel?: unknown;
};

/** The legacy fields of a stored `offer` block, read defensively. */
export function legacyFieldsOf(data: unknown): {
  bookingServiceSlugs: string[];
  priceCents: number | null;
  priceLabel: string;
} {
  const value = (data ?? {}) as LegacyBlockData;
  return {
    bookingServiceSlugs: Array.isArray(value.bookingServiceSlugs)
      ? value.bookingServiceSlugs.filter((slug): slug is string => typeof slug === 'string')
      : [],
    priceCents: typeof value.priceCents === 'number' ? value.priceCents : null,
    priceLabel: typeof value.priceLabel === 'string' ? value.priceLabel : '',
  };
}

/** Stored settings for a page, else the legacy derivation of its `offer` block. */
export function offeringSettingsFor(
  page: CataloguePage,
  stored: ReadonlyArray<{ pageId: string; settings: OfferingSettings }>,
  services: readonly OfferingServiceInfo[],
): { settings: OfferingSettings; source: OfferingSource } | null {
  const block = page.blocks.find((entry) => entry.type === 'offer');
  if (!block) return null;
  const row = stored.find((entry) => entry.pageId === page.id);
  if (row) return { settings: row.settings, source: 'stored' };
  return {
    settings: deriveLegacyOffering(legacyFieldsOf(block.data), services).settings,
    source: 'legacy',
  };
}

export function buildOfferCatalogue(input: {
  pages: readonly CataloguePage[];
  stored: ReadonlyArray<{ pageId: string; settings: OfferingSettings }>;
  services: readonly OfferingServiceInfo[];
  bookableServiceIds: ReadonlySet<string>;
}): OfferCatalogue {
  const byPageId: Record<string, CatalogueOfferEntry> = {};
  const listed: CatalogueOffer[] = [];
  const hiddenPageIds: string[] = [];
  const visibility: Array<{ visible: boolean; settings: OfferingSettings }> = [];
  const visibleStored: Array<{ offer: CatalogueOffer; offering: ResolvedOffering }> = [];
  const seenStored = new Set<string>();

  for (const page of input.pages) {
    if (!offerSlugFromPageSlug(page.slug)) continue;
    const found = offeringSettingsFor(page, input.stored, input.services);
    const offering = found
      ? resolveOffering({
          settings: found.settings,
          source: found.source,
          services: input.services,
          bookableServiceIds: input.bookableServiceIds,
        })
      : null;
    const offer = offerFromPage(page, offering);
    if (!offer) continue;
    byPageId[page.id] = { offer, offering };
    if (found) {
      visibility.push({ visible: found.settings.isListed, settings: found.settings });
      if (found.source === 'stored') seenStored.add(page.id);
    }
    if (offering && !offering.isListed) {
      hiddenPageIds.push(page.id);
      continue;
    }
    listed.push(offer);
    if (offering?.source === 'stored') visibleStored.push({ offer, offering });
  }

  // Stored offerings of draft pages (or pages no longer under /aanbod/) still
  // hold their services back: they are not visible anywhere.
  for (const row of input.stored) {
    if (!seenStored.has(row.pageId)) visibility.push({ visible: false, settings: row.settings });
  }

  const offers = sortOffers(listed);
  const variantDisplay: Record<string, VariantDisplay> = {};
  const order = new Map(offers.map((offer, index) => [offer.slug, index]));
  visibleStored.sort((a, b) => (order.get(a.offer.slug) ?? 0) - (order.get(b.offer.slug) ?? 0));
  for (const { offering } of visibleStored) {
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
    byPageId,
    hiddenPageIds,
    withheldServiceIds: [...withheldServiceIds(visibility)],
    variantDisplay,
  };
}
