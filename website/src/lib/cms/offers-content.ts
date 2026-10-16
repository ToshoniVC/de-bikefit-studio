import 'server-only';
import { cache } from 'react';
import { listPublicServices } from '@/lib/booking/content';
import { OFFER_PAGE_PREFIX, type CatalogueOffer } from '@/lib/offers/catalogue';
import {
  buildOfferCatalogue,
  type CataloguePage,
  type OfferCatalogue,
} from '@/lib/offers/offer-catalogue';
import { getOfferingStore, type OfferingStore } from '@/lib/offers/offering-store';
import { getPublishedPage, listPublishedPages } from './content';

/**
 * The published offer catalogue: every published page under `/aanbod/` that
 * carries an `offer` (or `giftVoucher`) block, with its offering settings from
 * Beheer → Aanbod resolved against who offers what.
 *
 * Built only from cached readers: the pages (`content.ts`, tags `cms` +
 * `cms:pages`), the offering settings (`offering-store.ts`, tags `cms` +
 * `cms:offerings` + `booking`) and the public services (`booking/content.ts`,
 * tags `cms` + `booking`). Publishing a page, saving an offering, editing a
 * service or a provider changing their subscriptions refreshes every overview.
 * `React.cache` keeps it to one build per request (page, overview and booking
 * block share it).
 *
 * Degrades instead of failing: without the offering tables every page derives
 * its settings from its block; without the booking tables no direct offering
 * is bookable (shown as temporarily unavailable, never as another service).
 */
export const loadOfferCatalogue = cache(async (locale: string): Promise<OfferCatalogue> => {
  const summaries = await listPublishedPages(locale);
  const candidates = summaries.filter((page) => page.slug.startsWith(`${OFFER_PAGE_PREFIX}/`));
  const loaded = await Promise.all(candidates.map((page) => getPublishedPage(locale, page.slug)));
  const pages: CataloguePage[] = loaded.flatMap((page) =>
    page ? [{ id: page.id, slug: page.slug, blocks: page.snapshot.blocks }] : [],
  );

  let store: OfferingStore = { stored: [], services: [], storeAvailable: false };
  try {
    store = await getOfferingStore(locale);
  } catch {
    console.error('[aanbod] offering_services_unavailable');
  }

  let bookableServiceIds = new Set<string>();
  try {
    bookableServiceIds = new Set((await listPublicServices(locale)).map((service) => service.id));
  } catch {
    console.error('[aanbod] bookable_services_unavailable');
  }

  return buildOfferCatalogue({
    pages,
    stored: store.stored,
    services: store.services,
    bookableServiceIds,
  });
});

/** The listed offers, sorted for the overviews (unchanged contract). */
export async function listPublishedOffers(locale: string): Promise<CatalogueOffer[]> {
  return (await loadOfferCatalogue(locale)).offers;
}

/**
 * The server-side gate of the booking actions: may `/afspraak` book this
 * service? `false` when an offering holds it back (a variant of an offering
 * that is hidden, asked for through the enquiry form, or a draft). Fails
 * closed when the offering settings cannot be read (migration 0010 missing),
 * like the booking rate limit without migration 0008.
 */
export async function isServiceBookableOnline(serviceId: string, locale: string): Promise<boolean> {
  const store = await getOfferingStore(locale);
  if (!store.storeAvailable) return false;
  const catalogue = await loadOfferCatalogue(locale);
  return !catalogue.withheldServiceIds.includes(serviceId);
}
