import { OFFER_INDEX_PATH } from '@/lib/offers/catalogue';
import { StudioButtonLink, StudioLink } from '../link';

/**
 * What `/afspraak?dienst=<offer>` shows when that offer cannot be booked
 * online (no linked booking service, or nobody offers it yet): the offer
 * stays named, and the visitor gets the two real ways to plan it — phone and,
 * once it is set in Instellingen → Contact, e-mail with the offer in the
 * subject. No widget with another service, no invented availability.
 */
export function OfferEnquiry({
  offer,
  phoneLabel,
  phoneHref,
  email,
}: {
  offer: { title: string; path: string };
  phoneLabel: string;
  phoneHref: string;
  email: string;
}) {
  const hasPhone = Boolean(phoneLabel && phoneHref);
  const subject = encodeURIComponent(`Afspraak: ${offer.title}`);

  return (
    <div className="studio-booking studio-booking__enquiry">
      <p className="studio-eyebrow">Je koos</p>
      <h3 className="studio-booking__enquiry-title">{offer.title}</h3>
      <p>
        Deze dienst kun je nog niet online boeken. Neem contact met ons op, dan plannen we samen een
        moment dat bij je past.
      </p>
      <div className="studio-hero__actions studio-stack">
        {hasPhone ? (
          <StudioButtonLink href={phoneHref} variant="primary">
            Bel {phoneLabel}
          </StudioButtonLink>
        ) : null}
        {email ? (
          <StudioButtonLink
            href={`mailto:${email}?subject=${subject}`}
            variant={hasPhone ? 'ghost' : 'primary'}
            arrow={false}
          >
            Mail ons
          </StudioButtonLink>
        ) : null}
        {!hasPhone && !email ? (
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
