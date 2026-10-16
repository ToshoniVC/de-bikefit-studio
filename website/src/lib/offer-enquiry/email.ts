import { formatDateLong, formatTime } from '@/lib/booking/time';
import { escapeHtml } from '@/lib/html';
import {
  layout,
  PALETTE,
  paragraph,
  rowsHtml,
  rowsText,
  type RenderedEmail,
  type Row,
} from '@/lib/email/templates';
import { AUDIENCE_LABELS } from '@/lib/offers/offering';
import type { OfferEnquiry } from './input';

/**
 * The e-mail the studio gets when a visitor sends the enquiry form on an offer
 * page. Internal: it goes to the studio's order inbox, never to the visitor
 * (their address is only the Reply-To). Everything typed is escaped in the
 * HTML part; the subject holds the offer and the reference, no personal data
 * (subjects show up in inbox lists and the provider's dashboard). Plain module.
 */

export type OfferEnquiryEmailData = {
  siteName: string;
  offer: { title: string; url: string };
  enquiry: OfferEnquiry;
  receivedAt: string;
  reference: string;
};

export function offerEnquiryReference(requestId: string | null, now: Date): string {
  const base = (requestId ?? now.getTime().toString(36)).replace(/-/g, '').slice(0, 8);
  return `AV-${base.toUpperCase()}`;
}

export function offerEnquiryEmail(data: OfferEnquiryEmailData): RenderedEmail {
  const { enquiry } = data;
  const received = `${formatDateLong(data.receivedAt)}, ${formatTime(data.receivedAt)}`;
  const subject = `Aanvraag: ${data.offer.title} (${data.reference})`;
  const heading = `Nieuwe aanvraag: ${data.offer.title}`;

  const offerRows: Row[] = [
    ['Dienst', data.offer.title],
    ['Voor', enquiry.audience ? AUDIENCE_LABELS[enquiry.audience] : null],
    ['Pagina', data.offer.url],
    ['Referentie', data.reference],
    ['Ontvangen', `${received} (Brussel)`],
  ];
  const contactRows: Row[] = [
    ['Naam', enquiry.name],
    ['E-mail', enquiry.email],
    ['Telefoon', enquiry.phone || 'niet ingevuld'],
  ];
  const next =
    'Antwoorden op deze e-mail gaat rechtstreeks naar de aanvrager. De website stuurde de aanvrager geen bevestiging per e-mail en er is geen afspraak ingepland.';

  const text = [
    `${heading} via de website.`,
    '',
    rowsText(offerRows),
    '',
    'Vraag:',
    enquiry.message,
    '',
    'Aanvrager',
    rowsText(contactRows),
    '',
    next,
  ].join('\n');

  const label = (value: string) =>
    `<h2 style="margin:20px 0 4px;font-size:16px;line-height:1.4;color:${PALETTE.fg}">${escapeHtml(value)}</h2>`;
  const message = `<blockquote style="margin:8px 0 16px;padding:12px 16px;border-left:3px solid ${PALETTE.accent};background:${PALETTE.surface};color:${PALETTE.fg};font-size:15px;line-height:1.6;white-space:normal">${escapeHtml(enquiry.message).replace(/\n/g, '<br>')}</blockquote>`;

  const html = layout(
    data.siteName,
    heading,
    [
      rowsHtml(offerRows),
      label('Vraag'),
      message,
      label('Aanvrager'),
      rowsHtml(contactRows),
      paragraph(next),
    ].join(''),
  );

  return { subject, html, text };
}
