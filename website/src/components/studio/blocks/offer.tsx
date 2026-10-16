import { getSiteSettings } from '@/lib/cms/content';
import { OFFER_ENQUIRY_ANCHOR, OFFER_ENQUIRY_CTA_LABEL } from '@/lib/offer-enquiry/input';
import {
  BOOKING_PAGE_PATH,
  OFFER_INDEX_PATH,
  offerBookingHref,
  offerDurationLabel,
  offerPriceLabel,
  offerSlugFromPageSlug,
} from '@/lib/offers/catalogue';
import {
  OFFERING_STATUS_LABELS,
  type OfferingStatus,
  type ResolvedVariant,
} from '@/lib/offers/offering';
import { StudioButtonLink, StudioLink } from '../link';
import { OfferEnquiryForm } from '../offer-enquiry-form';
import { StudioImage, hasImage } from '../studio-image';
import { SectionHeading } from './section';
import type { BlockProps } from './types';

/**
 * `offer` — one service from the offer, the same template on every
 * `/aanbod/<slug>` page: title, intro, the call to action, then Doel, Inhoud,
 * Duur, Kostprijs and Mogelijke extra's.
 *
 * Duur, Kostprijs and the call to action follow the offering's settings in
 * Beheer → Aanbod, resolved on the server (`page.offer`, see
 * `src/lib/offers/offer-catalogue.ts`):
 *
 *  - **bookable** (direct, ≥ 1 provider): the booking button to
 *    `/afspraak?dienst=<slug>#boeken`, where only this offering's variants are
 *    offered. A variant nobody offers right now is named as such;
 *  - **unavailable** (direct, nobody offers it right now): greyed out, the
 *    button is disabled and no availability is shown or suggested; the phone
 *    number stays as the way to ask;
 *  - **enquiry** (asked for on purpose): the button scrolls to the enquiry
 *    form, which mails the studio (`src/lib/offer-enquiry/`).
 *
 * Duur of a direct offering comes from its variants' services; Kostprijs from
 * the prices set per variant ("Prijs op aanvraag" until then). The block's
 * own price fields are never shown once the offering is resolved.
 */
export async function OfferBlock({
  data,
  anchor,
  headingLevel,
  locale,
  page,
}: BlockProps<'offer'>) {
  const offerSlug = offerSlugFromPageSlug(page.slug);
  const entry = page.offer ?? null;
  const offering = entry?.offering ?? null;
  // Without a resolved offering (never on the public site) the old behaviour.
  const status: OfferingStatus = offering?.status ?? 'bookable';
  const price = entry?.offer.priceLabel ?? offerPriceLabel(data);
  const duration = entry?.offer.durationLabel ?? offerDurationLabel(data.duration);
  const variants = offering?.variants ?? [];
  const partlyUnavailable =
    status === 'bookable' && variants.length > 1 && variants.some((variant) => !variant.bookable);

  const settings = status === 'bookable' ? null : await getSiteSettings(locale);
  const phoneLabel = settings?.contact.phoneLabel ?? '';
  const phoneHref = settings?.contact.phoneHref ?? '';
  const ItemHeading = headingLevel === 1 ? 'h2' : 'h3';
  const withImage = hasImage(data.image);

  const bookingHref = offerSlug ? offerBookingHref(offerSlug) : `${BOOKING_PAGE_PATH}#boeken`;
  const action =
    status === 'bookable' ? (
      <StudioButtonLink href={bookingHref} variant="primary">
        {data.ctaLabel}
      </StudioButtonLink>
    ) : status === 'enquiry' ? (
      <StudioButtonLink href={`#${OFFER_ENQUIRY_ANCHOR}`} variant="primary">
        {OFFER_ENQUIRY_CTA_LABEL}
      </StudioButtonLink>
    ) : (
      // Not a link: there is nothing to book. Disabled for real, and said in words.
      <button type="button" className="studio-btn studio-btn--primary" disabled>
        {OFFERING_STATUS_LABELS.unavailable}
      </button>
    );

  const unavailableNote =
    status === 'unavailable' ? (
      <p className="studio-offer__status-note">
        Op dit moment kan niemand {data.title} online inplannen, dus je kan het nu niet online
        boeken.
        {phoneLabel && phoneHref ? (
          <>
            {' '}
            Bel ons gerust op <a href={phoneHref}>{phoneLabel}</a>.
          </>
        ) : null}
      </p>
    ) : null;

  return (
    <>
      <section
        className={`studio-pagehead studio-offer-head${
          status === 'unavailable' ? ' studio-offer-head--unavailable' : ''
        }`}
        {...(anchor ? { id: anchor } : {})}
      >
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
              {offering ? (
                <div>
                  <dt>Boeken</dt>
                  <dd data-offer-status={status}>{OFFERING_STATUS_LABELS[status]}</dd>
                </div>
              ) : null}
            </dl>
            <div className="studio-hero__actions studio-stack">{action}</div>
            {unavailableNote}
            {partlyUnavailable ? <PartlyUnavailable variants={variants} /> : null}
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

          {status === 'enquiry' && offerSlug ? (
            <div className="studio-offer__enquiry" id={OFFER_ENQUIRY_ANCHOR}>
              <OfferEnquiryForm
                offerSlug={offerSlug}
                offerTitle={data.title}
                audiences={variants
                  .map((variant) => variant.audience)
                  .filter((audience): audience is 'adult' | 'youth' => audience !== 'all')}
                headingTag={ItemHeading}
                phoneLabel={phoneLabel}
                phoneHref={phoneHref}
              />
            </div>
          ) : null}

          <div className="studio-offer__actions">
            {status === 'enquiry' ? null : action}
            <StudioLink href={OFFER_INDEX_PATH} className="studio-offer__back">
              Terug naar het aanbod
            </StudioLink>
          </div>
        </div>
      </section>
    </>
  );
}

/** "Jeugd: tijdelijk niet online te boeken" under a partly bookable offering. */
function PartlyUnavailable({ variants }: { variants: ResolvedVariant[] }) {
  const missing = variants.filter((variant) => !variant.bookable).map((variant) => variant.label);
  return (
    <p className="studio-offer__status-note">
      {missing.join(' en ')}: {OFFERING_STATUS_LABELS.unavailable.toLowerCase()}.
    </p>
  );
}
