import 'server-only';
import { cache } from 'react';
import { listPublicServices } from '@/lib/booking/content';
import type { CatalogueOffer } from '@/lib/offers/catalogue';
import {
  buildOfferCatalogue,
  type CatalogueOfferEntry,
  type OfferCatalogue,
} from '@/lib/offers/offer-catalogue';
import { getOfferingStore } from '@/lib/offers/offering-store';

/**
 * The public offer catalogue: every offering in Beheer → Aanbod, with its
 * settings resolved against who offers what.
 *
 * Built only from cached readers: the offerings and services
 * (`offering-store.ts`, tags `cms` + `cms:offerings` + `booking`) and the
 * public services (`booking/content.ts`, tags `cms` + `booking`). Saving an
 * offering or a provider changing their subscriptions refreshes every
 * overview, the offer pages and the booking page. `React.cache` keeps it to
 * one build per request (page, overview and booking block share it).
 *
 * Degrades instead of failing: without the offering tables the catalogue is
 * empty; without the booking tables no direct offering is bookable (shown as
 * temporarily unavailable, never as another service).
 */
export const loadOfferCatalogue = cache(async (locale: string): Promise<OfferCatalogue> => {
  const store = await getOfferingStore(locale);

  let bookableServiceIds = new Set<string>();
  try {
    bookableServiceIds = new Set((await listPublicServices(locale)).map((service) => service.id));
  } catch {
    console.error('[aanbod] bookable_services_unavailable');
  }

  return buildOfferCatalogue({
    offerings: store.offerings,
    services: store.services,
    bookableServiceIds,
  });
});

/** The listed offers, sorted for the overviews. */
export async function listPublishedOffers(locale: string): Promise<CatalogueOffer[]> {
  return (await loadOfferCatalogue(locale)).offers;
}

/** One offering for `/aanbod/<slug>`: `null` when unknown or not shown on the website. */
export async function getPublishedOffer(
  locale: string,
  slug: string,
): Promise<CatalogueOfferEntry | null> {
  const catalogue = await loadOfferCatalogue(locale);
  const entry = catalogue.bySlug[slug];
  return entry && entry.offering.isListed ? entry : null;
}

/**
 * The server-side gate of the booking actions: may `/afspraak` book this
 * service? `false` when an offering holds it back (a variant of an offering
 * that is hidden or asked for through the enquiry form). Fails closed when the
 * offering settings cannot be read (migration 0010/0011 missing), like the
 * booking rate limit without migration 0008.
 */
export async function isServiceBookableOnline(serviceId: string, locale: string): Promise<boolean> {
  const store = await getOfferingStore(locale);
  if (!store.storeAvailable) return false;
  const catalogue = await loadOfferCatalogue(locale);
  return !catalogue.withheldServiceIds.includes(serviceId);
}
