import {
  BOOKING_PAGE_PATH,
  OFFER_INDEX_PATH,
  offerBookingHref,
  offerDurationLabel,
  offerPriceLabel,
  offerSlugFromPageSlug,
} from '@/lib/offers/catalogue';
import { StudioButtonLink, StudioLink } from '../link';
import { StudioImage, hasImage } from '../studio-image';
import { SectionHeading } from './section';
import type { BlockProps } from './types';

/**
 * `offer` — one service from the offer, the same template on every
 * `/aanbod/<slug>` page: title, intro, the booking button, then Doel, Inhoud,
 * Duur, Kostprijs and Mogelijke extra's.
 *
 * The booking button carries the offer's slug (the last segment of the page
 * path) to `/afspraak?dienst=<slug>#boeken`; the booking block decides there
 * whether the widget can take it or a contact prompt is the honest answer.
 *
 * "Duur in overleg" is the fallback while nothing is confirmed. A linked
 * booking offer displays "Prijs op aanvraag" until its approved variant prices
 * can be derived from cms_services; independent editorial cents/labels cannot
 * override the service-level showPrice setting.
 */
export function OfferBlock({ data, anchor, headingLevel, locale, page }: BlockProps<'offer'>) {
  const offerSlug = offerSlugFromPageSlug(page.slug);
  const bookingHref = offerSlug ? offerBookingHref(offerSlug) : `${BOOKING_PAGE_PATH}#boeken`;
  const price = offerPriceLabel(data);
  const duration = offerDurationLabel(data.duration);
  const ItemHeading = headingLevel === 1 ? 'h2' : 'h3';
  const withImage = hasImage(data.image);

  const bookButton = (
    <StudioButtonLink href={bookingHref} variant="primary">
      {data.ctaLabel}
    </StudioButtonLink>
  );

  return (
    <>
      <section className="studio-pagehead studio-offer-head" {...(anchor ? { id: anchor } : {})}>
        <div
          className={`studio-pagehead__inner studio-offer-head__inner${
            withImage ? ' studio-offer-head__inner--media' : ''
          }`}
        >
          <div>
            {data.eyebrow ? <p className="studio-eyebrow">{data.eyebrow}</p> : null}
            <SectionHeading level={headingLevel} className="studio-pagehead__title">
              {data.title}
            </SectionHeading>
            {data.intro ? <p className="studio-pagehead__lede">{data.intro}</p> : null}
            <dl className="studio-offer-head__facts">
              <div>
                <dt>Duur</dt>
                <dd>{duration}</dd>
              </div>
              <div>
                <dt>Kostprijs</dt>
                <dd>{price}</dd>
              </div>
            </dl>
            <div className="studio-hero__actions studio-stack">{bookButton}</div>
          </div>
          {withImage ? (
            <div className="studio-offer-head__visual">
              <StudioImage
                image={data.image}
                locale={locale}
                sizes="(max-width: 900px) 100vw, 40vw"
                priority
              />
            </div>
          ) : null}
        </div>
      </section>

      <section className="studio-section">
        <div className="studio-section__inner">
          <div className="studio-offer">
            {data.goal ? (
              <div className="studio-offer__item studio-offer__item--goal">
                <ItemHeading className="studio-offer__label">Doel</ItemHeading>
                <p className="studio-offer__goal">{data.goal}</p>
              </div>
            ) : null}

            {data.contents.length > 0 ? (
              <div className="studio-offer__item">
                <ItemHeading className="studio-offer__label">Inhoud</ItemHeading>
                <ul className="studio-offer__list">
                  {data.contents.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="studio-offer__item">
              <ItemHeading className="studio-offer__label">Duur</ItemHeading>
              <p>{duration}</p>
            </div>

            <div className="studio-offer__item">
              <ItemHeading className="studio-offer__label">Kostprijs</ItemHeading>
              <p>{price}</p>
            </div>

            {data.extras.length > 0 ? (
              <div className="studio-offer__item">
                <ItemHeading className="studio-offer__label">Mogelijke extra’s</ItemHeading>
                <ul className="studio-offer__list">
                  {data.extras.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
                {data.extrasNote ? <p className="studio-offer__note">{data.extrasNote}</p> : null}
              </div>
            ) : null}
          </div>

          <div className="studio-offer__actions">
            {bookButton}
            <StudioLink href={OFFER_INDEX_PATH} className="studio-offer__back">
              Terug naar het aanbod
            </StudioLink>
          </div>
        </div>
      </section>
    </>
  );
}
