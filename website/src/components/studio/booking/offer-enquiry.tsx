import { OFFER_ENQUIRY_ANCHOR, OFFER_ENQUIRY_CTA_LABEL } from '@/lib/offer-enquiry/input';
import { OFFER_INDEX_PATH } from '@/lib/offers/catalogue';
import type { OfferingStatus } from '@/lib/offers/offering';
import { StudioButtonLink, StudioLink } from '../link';

/**
 * What `/afspraak?dienst=<offer>` shows when that offer cannot be booked
 * online. The offer stays named; no widget with another service, no invented
 * availability. Two different reasons, said differently (Beheer → Aanbod):
 *
 *  - `enquiry`: asked for on purpose → the enquiry form on the offer page;
 *  - `unavailable`: booked online, but nobody offers it right now → it says
 *    "tijdelijk", with phone and, once set in Instellingen → Contact, e-mail
 *    with the offer in the subject;
 *  - unknown (`null`): the neutral wording of before.
 */
export function OfferEnquiry({
  offer,
  phoneLabel,
  phoneHref,
  email,
  titleTag = 'h3',
}: {
  offer: { title: string; path: string; status?: OfferingStatus | null };
  phoneLabel: string;
  phoneHref: string;
  email: string;
  /** `h2` when the surrounding section owns the page's `<h1>`. */
  titleTag?: 'h2' | 'h3';
}) {
  const Title = titleTag;
  const hasPhone = Boolean(phoneLabel && phoneHref);
  const subject = encodeURIComponent(`Afspraak: ${offer.title}`);
  const status = offer.status ?? null;

  const text =
    status === 'enquiry'
      ? 'Deze dienst boek je niet online: je vraagt hem aan, dan plannen we samen een moment dat bij je past.'
      : status === 'unavailable'
        ? 'Deze dienst is tijdelijk niet online te boeken: op dit moment kan niemand hem online inplannen. Neem contact met ons op, dan zoeken we samen een oplossing.'
        : 'Deze dienst kun je nog niet online boeken. Neem contact met ons op, dan plannen we samen een moment dat bij je past.';

  return (
    <div className="studio-booking studio-booking__enquiry" data-offer-status={status ?? undefined}>
      <p className="studio-eyebrow">Je koos</p>
      <Title className="studio-booking__enquiry-title">{offer.title}</Title>
      <p>{text}</p>
      <div className="studio-hero__actions studio-stack">
        {status === 'enquiry' ? (
          <StudioButtonLink href={`${offer.path}#${OFFER_ENQUIRY_ANCHOR}`} variant="primary">
            {OFFER_ENQUIRY_CTA_LABEL}
          </StudioButtonLink>
        ) : null}
        {hasPhone ? (
          <StudioButtonLink
            href={phoneHref}
            variant={status === 'enquiry' ? 'ghost' : 'primary'}
            arrow={status !== 'enquiry'}
          >
            Bel {phoneLabel}
          </StudioButtonLink>
        ) : null}
        {email && status !== 'enquiry' ? (
          <StudioButtonLink
            href={`mailto:${email}?subject=${subject}`}
            variant={hasPhone ? 'ghost' : 'primary'}
            arrow={false}
          >
            Mail ons
          </StudioButtonLink>
        ) : null}
        {!hasPhone && !email && status !== 'enquiry' ? (
          <StudioButtonLink href="/contact" variant="primary">
            Contact
          </StudioButtonLink>
        ) : null}
      </div>
      <p className="studio-booking__enquiry-links">
        <StudioLink href={offer.path}>Meer over {offer.title}</StudioLink>
        <StudioLink href={OFFER_INDEX_PATH}>Bekijk het volledige aanbod</StudioLink>
      </p>
    </div>
  );
}
