import Link from 'next/link';
import { listPublishedOffers } from '@/lib/cms/offers-content';
import {
  OFFER_CATEGORY_LABELS,
  offersInCategory,
  showsOfferPrices,
  type CatalogueOffer,
} from '@/lib/offers/catalogue';
import { StudioButtonLink, splitArrow } from '../link';
import { StudioSection } from './section';
import type { BlockProps } from './types';

/**
 * `offerCatalogue` — the offer, grouped (Bikefit, Begeleiding).
 *
 * The cards are read from the published offer pages at render time
 * (`listPublishedOffers`, tag-cached), so there is exactly one place where an
 * offer's title, summary and price live: its own page. A group with no
 * published offers is left out; a catalogue with none at all renders nothing.
 *
 * Each card is one link (the title), stretched over the card with CSS, so the
 * whole card is clickable while the link's accessible name stays the title.
 *
 * The price line needs "Prijzen tonen" *and* a page under `/aanbod`
 * (`showsOfferPrices`): the home page and `/bikefit` never show prices, also
 * when older published content still has the switch on.
 */
export async function OfferCatalogueBlock({
  data,
  anchor,
  headingLevel,
  locale,
  page,
}: BlockProps<'offerCatalogue'>) {
  let offers: CatalogueOffer[] = [];
  try {
    offers = await listPublishedOffers(locale);
  } catch (error) {
    console.error('[aanbod] catalogue unavailable', error);
  }

  const groups = data.groups
    .map((group) => ({ ...group, offers: offersInCategory(offers, group.category) }))
    .filter((group) => group.offers.length > 0);
  if (groups.length === 0) return null;

  // Group headings sit one level under the section title (or directly under
  // the page's h1 when this section has no title of its own).
  const GroupHeading = data.title && headingLevel === 2 ? 'h3' : 'h2';
  const CardHeading = GroupHeading === 'h2' ? 'h3' : 'h4';
  const idBase = anchor ?? 'aanbod';
  const showPrices = data.showPrices && showsOfferPrices(page.slug);

  return (
    <StudioSection
      variant={data.variant}
      anchor={anchor}
      eyebrow={data.eyebrow}
      title={data.title}
      lede={data.lede}
      headingLevel={headingLevel}
    >
      <div className="studio-offer-groups">
        {groups.map((group) => {
          const headingId = `${idBase}-${group.category}`;
          return (
            <section
              key={group.category}
              className="studio-offer-group"
              aria-labelledby={headingId}
            >
              <div className="studio-offer-group__head">
                <GroupHeading id={headingId} className="studio-offer-group__title">
                  {group.title || OFFER_CATEGORY_LABELS[group.category]}
                </GroupHeading>
                {group.lede ? <p className="studio-offer-group__lede">{group.lede}</p> : null}
              </div>
              <ul className="studio-offer-list">
                {group.offers.map((offer) => (
                  <li key={offer.slug} className="studio-offer-card">
                    <CardHeading className="studio-offer-card__title">
                      <Link href={offer.path} className="studio-offer-card__link">
                        {offer.title}
                      </Link>
                    </CardHeading>
                    {offer.summary ? (
                      <p className="studio-offer-card__body">{offer.summary}</p>
                    ) : null}
                    <p className="studio-offer-card__foot">
                      {showPrices ? (
                        <span className="studio-offer-card__price">{offer.priceLabel}</span>
                      ) : null}
                      <span className="studio-offer-card__more" aria-hidden="true">
                        Meer info &rarr;
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {data.cta ? (
        <p className="studio-stack">
          <StudioButtonLink href={data.cta.href} external={data.cta.external} variant="outline">
            {splitArrow(data.cta.label)}
          </StudioButtonLink>
        </p>
      ) : null}
    </StudioSection>
  );
}
