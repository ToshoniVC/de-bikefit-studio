import 'server-only';
import {
  offerFromPage,
  OFFER_PAGE_PREFIX,
  sortOffers,
  type CatalogueOffer,
} from '@/lib/offers/catalogue';
import { getPublishedPage, listPublishedPages } from './content';

/**
 * The published offer catalogue: every published page under `/aanbod/` that
 * carries an `offer` block, sorted by category and position.
 *
 * Built only from the cached readers in `content.ts` (tags `cms` +
 * `cms:pages`), so publishing or unpublishing an offer page refreshes every
 * overview that lists it — no extra tag, no second copy of the offer data.
 */
export async function listPublishedOffers(locale: string): Promise<CatalogueOffer[]> {
  const pages = await listPublishedPages(locale);
  const candidates = pages.filter((page) => page.slug.startsWith(`${OFFER_PAGE_PREFIX}/`));
  const loaded = await Promise.all(candidates.map((page) => getPublishedPage(locale, page.slug)));

  const offers: CatalogueOffer[] = [];
  for (const page of loaded) {
    if (!page) continue;
    const offer = offerFromPage({ slug: page.slug, blocks: page.snapshot.blocks });
    if (offer) offers.push(offer);
  }
  return sortOffers(offers);
}
