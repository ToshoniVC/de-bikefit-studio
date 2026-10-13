import { getSiteSettings } from '@/lib/cms/content';
import { LEGAL_IDENTITY } from '@/lib/studio/legal';
import { GiftVoucherForm } from '../gift-voucher/order-form';
import { SectionHeading } from './section';
import type { BlockProps } from './types';

/**
 * `giftVoucher` — the "Cadeaubon" page at `/aanbod/cadeaubon`: a page head in
 * the offer-page style (it owns the `<h1>`), then the order form.
 *
 * The form posts to a server action that e-mails the studio; there is no
 * payment, invoice or voucher code on the site. The phone number from
 * Instellingen → Contact is the fallback whenever the request cannot be sent;
 * if that is empty, the legal identity's number (as on the error pages), so the
 * visitor always gets a working way out besides e-mail.
 */
export async function GiftVoucherBlock({
  data,
  anchor,
  headingLevel,
  locale,
}: BlockProps<'giftVoucher'>) {
  const settings = await getSiteSettings(locale);
  const hasPhone = Boolean(settings.contact.phoneLabel && settings.contact.phoneHref);
  const { phoneLabel, phoneHref } = hasPhone ? settings.contact : LEGAL_IDENTITY;
  const innerHeading = headingLevel === 1 ? 'h2' : 'h3';

  return (
    <>
      <section className="studio-pagehead studio-offer-head">
        <div className="studio-pagehead__inner studio-offer-head__inner">
          <div>
            {data.eyebrow ? <p className="studio-eyebrow">{data.eyebrow}</p> : null}
            <SectionHeading level={headingLevel} className="studio-pagehead__title">
              {data.title}
            </SectionHeading>
            {data.intro ? <p className="studio-pagehead__lede">{data.intro}</p> : null}
          </div>
        </div>
      </section>

      <section className="studio-section" {...(anchor ? { id: anchor } : {})}>
        <div className="studio-section__inner">
          <GiftVoucherForm
            formTitle={data.formTitle}
            sentTitle={data.sentTitle}
            sentText={data.sentText}
            headingTag={innerHeading}
            phoneLabel={phoneLabel}
            phoneHref={phoneHref}
          />
        </div>
      </section>
    </>
  );
}
