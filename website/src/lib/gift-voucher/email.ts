import { formatPrice } from '@/lib/booking/format';
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
import type { GiftVoucherOrder } from './order';

/**
 * The e-mail the studio gets when a visitor clicks "Bestel nu" on
 * `/aanbod/cadeaubon`. Internal: it goes to the studio, never to the visitor.
 * Everything the visitor typed is escaped in the HTML part; the subject holds
 * only the amount (no personal data: the mail helper logs subjects).
 * Plain module (no I/O).
 */

export type GiftVoucherEmailData = {
  siteName: string;
  order: GiftVoucherOrder;
  /** When the request came in (ISO); shown in Brussels time. */
  receivedAt: string;
  /** Short reference, also usable to find the request in the inbox. */
  reference: string;
};

const NO_MESSAGE = '(geen persoonlijke boodschap)';

export function giftVoucherReference(requestId: string | null, now: Date): string {
  const base = (requestId ?? now.getTime().toString(36)).replace(/-/g, '').slice(0, 8);
  return `CB-${base.toUpperCase()}`;
}

export function giftVoucherRequestEmail(data: GiftVoucherEmailData): RenderedEmail {
  const { order } = data;
  const amount = formatPrice(order.amountCents);
  const received = `${formatDateLong(data.receivedAt)}, ${formatTime(data.receivedAt)}`;
  const subject = `Cadeaubon-aanvraag: ${amount} (${data.reference})`;
  const heading = 'Nieuwe aanvraag voor een cadeaubon';

  const voucherRows: Row[] = [
    ['Bedrag', amount],
    ['Referentie', data.reference],
    ['Ontvangen', `${received} (Brussel)`],
  ];
  const contactRows: Row[] = [
    ['Naam', order.name],
    ['E-mail', order.email],
    ['Telefoon', order.phone || 'niet ingevuld'],
  ];
  const nextSteps = [
    `Maak een factuur op van ${amount} en een betaallink.`,
    `Stuur beide naar ${order.email}. Antwoorden op deze e-mail gaat rechtstreeks naar de besteller.`,
  ];
  const notDone =
    'Er is nog niets gefactureerd of betaald, er is geen cadeaubon aangemaakt en de besteller kreeg van de website geen bevestiging per e-mail.';

  const text = [
    `${heading} via de website.`,
    '',
    rowsText(voucherRows),
    '',
    'Persoonlijke boodschap:',
    order.message || NO_MESSAGE,
    '',
    'Besteller',
    rowsText(contactRows),
    '',
    'Wat nu (manueel)',
    ...nextSteps.map((step, index) => `${index + 1}. ${step}`),
    '',
    notDone,
  ].join('\n');

  const message = order.message
    ? `<blockquote style="margin:8px 0 16px;padding:12px 16px;border-left:3px solid ${PALETTE.accent};background:${PALETTE.surface};color:${PALETTE.fg};font-size:15px;line-height:1.6;white-space:normal">${escapeHtml(order.message).replace(/\n/g, '<br>')}</blockquote>`
    : paragraph(NO_MESSAGE);
  const label = (value: string) =>
    `<h2 style="margin:20px 0 4px;font-size:16px;line-height:1.4;color:${PALETTE.fg}">${escapeHtml(value)}</h2>`;
  const steps = `<ol style="margin:0 0 14px;padding-left:20px;font-size:15px;line-height:1.6;color:${PALETTE.fg}">${nextSteps
    .map((step) => `<li>${escapeHtml(step)}</li>`)
    .join('')}</ol>`;

  const html = layout(
    data.siteName,
    heading,
    [
      rowsHtml(voucherRows),
      label('Persoonlijke boodschap'),
      message,
      label('Besteller'),
      rowsHtml(contactRows),
      label('Wat nu (manueel)'),
      steps,
      paragraph(notDone),
    ].join(''),
  );

  return { subject, html, text };
}
