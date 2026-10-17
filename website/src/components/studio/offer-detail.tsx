import Link from 'next/link';
import type { SiteSettings } from '@/lib/cms/blocks';
import { OFFER_ENQUIRY_ANCHOR, OFFER_ENQUIRY_CTA_LABEL } from '@/lib/offer-enquiry/input';
import { OFFER_CATEGORY_LABELS, OFFER_INDEX_PATH, offerBookingHref } from '@/lib/offers/catalogue';
import type { CatalogueOfferEntry } from '@/lib/offers/offer-catalogue';
import {
  OFFERING_STATUS_LABELS,
  type OfferingStatus,
  type ResolvedVariant,
} from '@/lib/offers/offering';
import { offeringCtaLabel } from '@/lib/offers/offering-content';
import { LEGAL_IDENTITY } from '@/lib/studio/legal';
import {
  breadcrumbJsonLd,
  jsonLdDocument,
  offeringServiceJsonLd,
  webPageJsonLd,
  type BreadcrumbEntry,
} from '@/lib/studio/jsonld';
import type { StudioLocale } from '@/lib/studio/locale';
import { absoluteUrl } from '@/lib/studio/site';
import { SectionHeading } from './blocks/section';
import { JsonLd } from './json-ld';
import { StudioButtonLink, StudioLink } from './link';
import { OfferEnquiryForm } from './offer-enquiry-form';
import { StudioImage, hasImage } from './studio-image';

/**
 * `/aanbod/<slug>` — one offering, rendered from Beheer → Aanbod (there is no
 * CMS page behind it since 17 Oct 2026): the breadcrumb, its structured data,
 * then the same template for every offering: title, intro, the call to
 * action, then Doel, Inhoud, Duur, Kostprijs and Mogelijke extra's.
 *
 * Duur, Kostprijs and the call to action follow the offering's settings,
 * resolved on the server (`src/lib/offers/offer-catalogue.ts`):
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
 * the prices set per variant ("Prijs op aanvraag" until then).
 */
export function OfferPageView({
  entry,
  settings,
  locale,
  parentTitle,
}: {
  entry: CatalogueOfferEntry;
  settings: SiteSettings;
  locale: StudioLocale;
  /** The title of the `/aanbod` page, for the breadcrumb. */
  parentTitle: string;
}) {
  const { offer, offering, content } = entry;
  const origin = absoluteUrl('/').replace(/\/+$/, '');
  const canonical = absoluteUrl(offer.path);
  const trail: BreadcrumbEntry[] = [
    { name: 'Home', url: `${origin}/` },
    { name: parentTitle, url: absoluteUrl(OFFER_INDEX_PATH) },
    { name: content.title, url: canonical },
  ];
  const description =
    content.metaDescription.trim() || settings.seo.defaultMetaDescription.trim() || undefined;

  const graph = jsonLdDocument([
    webPageJsonLd({
      origin,
      canonical,
      locale,
      title: content.title,
      description,
      structuredDataType: 'WebPage',
      hasBreadcrumb: true,
    }),
    breadcrumbJsonLd(canonical, trail),
    offeringServiceJsonLd({ content, offering, settings, origin, canonical }),
  ]);

  const status: OfferingStatus = offering.status;
  const hasPhone = Boolean(settings.contact.phoneLabel && settings.contact.phoneHref);
  const { phoneLabel, phoneHref } = hasPhone ? settings.contact : LEGAL_IDENTITY;

  return (
    <>
      <JsonLd data={graph} />
      <nav className="studio-breadcrumb-bar" aria-label="Kruimelpad">
        <ol className="studio-breadcrumb">
          <li>
            <Link href="/">Home</Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href={OFFER_INDEX_PATH}>{parentTitle}</Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">{content.title}</li>
        </ol>
      </nav>
      <OfferDetail
        entry={entry}
        locale={locale}
        status={status}
        phoneLabel={phoneLabel}
        phoneHref={phoneHref}
      />
    </>
  );
}

function OfferDetail({
  entry,
  locale,
  status,
  phoneLabel,
  phoneHref,
}: {
  entry: CatalogueOfferEntry;
  locale: StudioLocale;
  status: OfferingStatus;
  phoneLabel: string;
  phoneHref: string;
}) {
  const { offer, offering, content } = entry;
  const variants = offering.variants;
  const partlyUnavailable =
    status === 'bookable' && variants.length > 1 && variants.some((variant) => !variant.bookable);
  const withImage = hasImage(content.image);
  const eyebrow = `Aanbod · ${OFFER_CATEGORY_LABELS[content.category]}`;

  const action =
    status === 'bookable' ? (
      <StudioButtonLink href={offerBookingHref(content.slug)} variant="primary">
        {offeringCtaLabel(content)}
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
        Op dit moment kan niemand {content.title} online inplannen, dus je kan het nu niet online
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
        id="dienst"
      >
        <div
          className={`studio-pagehead__inner studio-offer-head__inner${
            withImage ? ' studio-offer-head__inner--media' : ''
          }`}
        >
          <div>
            <p className="studio-eyebrow">{eyebrow}</p>
            <SectionHeading level={1} className="studio-pagehead__title">
              {content.title}
            </SectionHeading>
            {content.intro ? <p className="studio-pagehead__lede">{content.intro}</p> : null}
            <dl className="studio-offer-head__facts">
              <div>
                <dt>Duur</dt>
                <dd>{offer.durationLabel}</dd>
              </div>
              <div>
                <dt>Kostprijs</dt>
                <dd>{offer.priceLabel}</dd>
              </div>
              <div>
                <dt>Boeken</dt>
                <dd data-offer-status={status}>{OFFERING_STATUS_LABELS[status]}</dd>
              </div>
            </dl>
            <div className="studio-hero__actions studio-stack">{action}</div>
            {unavailableNote}
            {partlyUnavailable ? <PartlyUnavailable variants={variants} /> : null}
          </div>
          {withImage ? (
            <div className="studio-offer-head__visual">
              <StudioImage
                image={content.image}
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
            {content.goal ? (
              <div className="studio-offer__item studio-offer__item--goal">
                <h2 className="studio-offer__label">Doel</h2>
                <p className="studio-offer__goal">{content.goal}</p>
              </div>
            ) : null}

            {content.contents.length > 0 ? (
              <div className="studio-offer__item">
                <h2 className="studio-offer__label">Inhoud</h2>
                <ul className="studio-offer__list">
                  {content.contents.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="studio-offer__item">
              <h2 className="studio-offer__label">Duur</h2>
              <p>{offer.durationLabel}</p>
            </div>

            <div className="studio-offer__item">
              <h2 className="studio-offer__label">Kostprijs</h2>
              <p>{offer.priceLabel}</p>
            </div>

            {content.extras.length > 0 ? (
              <div className="studio-offer__item">
                <h2 className="studio-offer__label">Mogelijke extra’s</h2>
                <ul className="studio-offer__list">
                  {content.extras.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
                {content.extrasNote ? (
                  <p className="studio-offer__note">{content.extrasNote}</p>
                ) : null}
              </div>
            ) : null}
          </div>

          {status === 'enquiry' ? (
            <div className="studio-offer__enquiry" id={OFFER_ENQUIRY_ANCHOR}>
              <OfferEnquiryForm
                offerSlug={content.slug}
                offerTitle={content.title}
                audiences={variants
                  .map((variant) => variant.audience)
                  .filter((audience): audience is 'adult' | 'youth' => audience !== 'all')}
                headingTag="h2"
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
