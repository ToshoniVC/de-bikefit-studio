import Link from 'next/link';
import { listPublishedOffers } from '@/lib/cms/offers-content';
import {
  OFFER_CATEGORY_LABELS,
  offersInCategory,
  showsOfferPrices,
  type CatalogueOffer,
  type OfferCategory,
} from '@/lib/offers/catalogue';
import { OFFERING_STATUS_LABELS, type OfferingStatus } from '@/lib/offers/offering';
import { StudioButtonLink, splitArrow } from '../link';
import { StudioSection } from './section';
import type { BlockProps } from './types';

/**
 * `offerCatalogue` — the offer, grouped (Bikefit, Begeleiding, Overige).
 *
 * The cards are read from the offerings in Beheer → Aanbod at render time
 * (`listPublishedOffers`, tag-cached), so there is exactly one place where an
 * offer's title, summary, price and status live. `extraCards` on the block
 * (the gift voucher) are fixed cards after the offerings of their category.
 * A group with nothing in it is left out; a catalogue with none at all
 * renders nothing.
 *
 * Each card is one link (the title), stretched over the card with CSS, so the
 * whole card is clickable while the link's accessible name stays the title.
 *
 * The price line needs "Prijzen tonen" *and* a page under `/aanbod`
 * (`showsOfferPrices`): the home page and `/bikefit` never show prices, also
 * when older published content still has the switch on.
 *
 * Every offering card names how it is booked: "Online te boeken", "Op
 * aanvraag", or — greyed out — "Tijdelijk niet online te boeken" for a
 * directly bookable offering nobody offers right now. Hidden offerings are not
 * listed.
 */

type Card = {
  key: string;
  href: string;
  title: string;
  summary: string;
  priceLabel: string;
  status: OfferingStatus | null;
};

function offerCard(offer: CatalogueOffer): Card {
  return {
    key: `offer-${offer.slug}`,
    href: offer.path,
    title: offer.title,
    summary: offer.summary,
    priceLabel: offer.priceLabel,
    status: offer.status,
  };
}

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
  } catch {
    // A fixed code, never the error: a failed query's message holds the SQL and its bound values.
    console.error('[aanbod] catalogue_unavailable');
  }

  const extra = (category: OfferCategory): Card[] =>
    data.extraCards
      .filter((card) => card.category === category)
      .map((card, index) => ({
        key: `extra-${category}-${index}`,
        href: card.href,
        title: card.title,
        summary: card.summary,
        priceLabel: card.priceLabel,
        status: null,
      }));
  const groups = data.groups
    .map((group) => ({
      ...group,
      cards: [...offersInCategory(offers, group.category).map(offerCard), ...extra(group.category)],
    }))
    .filter((group) => group.cards.length > 0);
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
                {group.cards.map((card) => (
                  <li
                    key={card.key}
                    className={`studio-offer-card${
                      card.status === 'unavailable' ? ' studio-offer-card--unavailable' : ''
                    }`}
                    data-offer-status={card.status ?? undefined}
                  >
                    <CardHeading className="studio-offer-card__title">
                      <Link href={card.href} className="studio-offer-card__link">
                        {card.title}
                      </Link>
                    </CardHeading>
                    {card.summary ? (
                      <p className="studio-offer-card__body">{card.summary}</p>
                    ) : null}
                    {card.status ? (
                      <p className="studio-offer-card__status">
                        {OFFERING_STATUS_LABELS[card.status]}
                      </p>
                    ) : null}
                    <p className="studio-offer-card__foot">
                      {showPrices && card.priceLabel ? (
                        <span className="studio-offer-card__price">{card.priceLabel}</span>
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
