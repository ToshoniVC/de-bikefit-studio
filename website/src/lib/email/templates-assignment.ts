import { formatDateShort, formatTime } from '@/lib/booking/time';
import { formatDuration } from '@/lib/booking/format';
import {
  button,
  layout,
  legalFooterHtml,
  legalFooterText,
  paragraph,
  rowsHtml,
  rowsText,
  whenLabel,
  whereLines,
  type BookingEmailData,
  type RenderedEmail,
  type Row,
} from './templates';

/**
 * The mails around assigning an "Iedereen" booking to a provider (17 Oct
 * 2026, `booking-architecture.md` §16). Plain module (no I/O), same palette
 * and helpers as `./templates.ts`:
 *
 *  - {@link assignmentTodoEmail}: to the beheerder when a booking comes in
 *    without a chosen provider (and more than one could do it);
 *  - {@link bookingAssignedEmail}: to the customer once a beheerder assigned
 *    (or moved) the booking — who does the fit;
 *  - {@link bookingReassignedEmail}: to the provider who held the slot before,
 *    when the booking went to someone else.
 *
 * The new provider gets the ordinary `providerNotificationEmail()`.
 */

function shortWhen(data: BookingEmailData): string {
  return `${formatDateShort(data.startsAt, data.timezone)} ${formatTime(data.startsAt, data.timezone)}`;
}

function customerRows(data: BookingEmailData): Row[] {
  return [
    ['Dienst', `${data.serviceName} (${formatDuration(data.durationMinutes)})`],
    ['Wanneer', whenLabel(data)],
    ['Waar', whereLines(data).join('\n')],
    ['Klant', data.customerName],
    ['Leeftijd', data.customerAge != null ? String(data.customerAge) : null],
    ['E-mail', data.customerEmail],
    ['Telefoon', data.customerPhone],
    ['Ouder/voogd', data.guardianName],
    ['E-mail ouder/voogd', data.guardianEmail],
    ['Telefoon ouder/voogd', data.guardianPhone],
    ['Fiets', data.bikeDetails],
    ['Opmerkingen', data.notes],
  ];
}

/** To the beheerder: a booking waits for assignment. `data.heldBy` names who holds the slot. */
export function assignmentTodoEmail(data: BookingEmailData): RenderedEmail {
  const subject = `Toe te wijzen: ${data.serviceName} — ${data.customerName}, ${shortWhen(data)}`;
  const heading = 'Afspraak toewijzen';
  const intro = `Een klant boekte ${data.serviceName} zonder een aanbieder te kiezen. Wijs de afspraak toe aan een aanbieder; tot dan houdt ${data.heldBy || 'een aanbieder'} het moment vrij en weet de klant nog niet bij wie hij terechtkomt.`;
  const rows: Row[] = [...customerRows(data), ['Voorlopig bij', data.heldBy]];
  const link = data.assignUrl || data.adminUrl || '';
  const text = [intro, '', rowsText(rows), '', link ? `Toewijzen in de admin: ${link}` : '']
    .filter(Boolean)
    .join('\n');
  const html = layout(
    data.siteName,
    heading,
    [paragraph(intro), rowsHtml(rows), link ? button(link, 'Toewijzen in de admin') : ''].join(''),
  );
  return { subject, html, text };
}

/** To the customer: who does the fit (after the beheerder assigned or moved the booking). */
export function bookingAssignedEmail(data: BookingEmailData): RenderedEmail {
  const subject = `Je afspraak is bij ${data.providerName}: ${data.serviceName} op ${formatDateShort(data.startsAt, data.timezone)} om ${formatTime(data.startsAt, data.timezone)}`;
  const heading = 'Je fitter is bekend';
  const intro = `Hallo ${data.customerName}, ${data.providerName} doet je ${data.serviceName}. Dit blijft je afspraak:`;
  const rows: Row[] = [
    ['Wat', `${data.serviceName} (${formatDuration(data.durationMinutes)})`],
    ['Wanneer', whenLabel(data)],
    ['Bij', data.providerName],
    ['Waar', whereLines(data).join('\n')],
  ];
  const phoneLine = data.contactPhoneLabel
    ? `Vragen of iets wijzigen? Bel ons op ${data.contactPhoneLabel}.`
    : '';
  const text = [
    intro,
    '',
    rowsText(rows),
    '',
    phoneLine,
    'Tot dan!',
    data.siteName,
    '',
    legalFooterText(data),
  ]
    .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
    .join('\n');
  const html = layout(
    data.siteName,
    heading,
    [
      paragraph(intro),
      rowsHtml(rows),
      phoneLine ? paragraph(phoneLine) : '',
      paragraph('Tot dan!'),
    ].join(''),
    legalFooterHtml(data),
  );
  return { subject, html, text };
}

/** To the provider who held the slot before: the booking went to `data.providerName`. */
export function bookingReassignedEmail(
  data: BookingEmailData,
  previousProviderName: string,
): RenderedEmail {
  const subject = `Afspraak niet meer bij jou: ${data.serviceName} — ${data.customerName}, ${shortWhen(data)}`;
  const heading = 'Afspraak toegewezen aan iemand anders';
  const intro = `Hallo ${previousProviderName}, een beheerder wees deze afspraak toe aan ${data.providerName}. Het tijdslot is weer vrij in jouw agenda.`;
  const rows: Row[] = [
    ['Dienst', data.serviceName],
    ['Wanneer', whenLabel(data)],
    ['Klant', data.customerName],
    ['Waar', whereLines(data).join('\n')],
    ['Nu bij', data.providerName],
  ];
  const text = [intro, '', rowsText(rows), '', data.adminUrl ? `Admin: ${data.adminUrl}` : '']
    .filter(Boolean)
    .join('\n');
  const html = layout(
    data.siteName,
    heading,
    [
      paragraph(intro),
      rowsHtml(rows),
      data.adminUrl ? button(data.adminUrl, 'Open in de admin') : '',
    ].join(''),
  );
  return { subject, html, text };
}
