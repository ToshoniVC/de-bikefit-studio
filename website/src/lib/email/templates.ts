import {
  formatDateLong,
  formatSlot,
  formatTimeRange,
  formatDateShort,
  formatTime,
} from '@/lib/booking/time';
import { formatDuration } from '@/lib/booking/format';
import { escapeHtml } from '@/lib/html';
import { LEGAL_IDENTITY, LEGAL_LINKS } from '@/lib/studio/legal';

/**
 * Dutch booking e-mails (informal “je”): plain text + simple inline-styled HTML
 * in the studio palette (bone background, ink text, burgundy accent). No
 * external images, no web fonts, no tracking. Plain module (no I/O).
 */

export type RenderedEmail = { subject: string; html: string; text: string };

export type BookingEmailData = {
  siteName: string;
  siteUrl: string;
  serviceName: string;
  durationMinutes: number;
  providerName: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  customerAge?: number | null;
  guardianName?: string | null;
  guardianEmail?: string | null;
  guardianPhone?: string | null;
  bikeDetails?: string | null;
  notes?: string | null;
  /** Address typed by the customer for a `customer`-kind location. */
  customerAddress?: string | null;
  /** ISO instants. */
  startsAt: string;
  endsAt: string;
  timezone: string;
  locationLabel: string;
  locationKind: 'studio' | 'customer' | null;
  locationAddressLines: string[];
  /** `${siteUrl}/afspraak/annuleren/<token>`; only in the customer confirmation. */
  cancelUrl?: string | null;
  /** Last moment the link works (ISO), `cancelUntilHours` before the start. */
  cancelDeadline?: string | null;
  cancelledBy?: 'customer' | 'provider' | 'admin' | null;
  /** Phone fallback, e.g. "0473 95 26 33". */
  contactPhoneLabel?: string | null;
  confirmationText?: string | null;
  /** Admin link for the provider mails. */
  adminUrl?: string | null;
};

const PALETTE = {
  bg: '#fdfbf7',
  surface: '#f7f1e8',
  border: '#e8dccc',
  fg: '#2a1219',
  muted: '#5a3f44',
  accent: '#3e1420',
  onAccent: '#edd5b9',
};

type Row = [label: string, value: string | null | undefined];

function whenLabel(data: BookingEmailData): string {
  return `${formatDateLong(data.startsAt, data.timezone)}, ${formatTimeRange(data.startsAt, data.endsAt, data.timezone)}`;
}

function whereLines(data: BookingEmailData): string[] {
  if (data.locationKind === 'customer') {
    return [data.locationLabel || 'Bij jou thuis', data.customerAddress ?? ''].filter(Boolean);
  }
  return [data.locationLabel, ...data.locationAddressLines].filter(Boolean);
}

function rowsText(rows: Row[]): string {
  return rows
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
}

function rowsHtml(rows: Row[]): string {
  const cells = rows
    .filter(([, value]) => value)
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 16px 6px 0;color:${PALETTE.muted};vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td>` +
        `<td style="padding:6px 0;color:${PALETTE.fg};vertical-align:top">${escapeHtml(value ?? '').replace(/\n/g, '<br>')}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;font-size:15px;line-height:1.5">${cells}</table>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${PALETTE.fg}">${escapeHtml(text)}</p>`;
}

function button(href: string, label: string): string {
  return (
    `<p style="margin:20px 0"><a href="${escapeHtml(href)}" ` +
    `style="display:inline-block;background:${PALETTE.accent};color:${PALETTE.onAccent};text-decoration:none;` +
    `padding:12px 20px;border-radius:4px;font-size:15px">${escapeHtml(label)}</a></p>`
  );
}

/** `footerHtml` (already-escaped markup) replaces the plain site name in the bottom band. */
function layout(siteName: string, heading: string, inner: string, footerHtml?: string): string {
  return [
    '<!doctype html><html lang="nl"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(heading)}</title></head>`,
    `<body style="margin:0;padding:0;background:${PALETTE.bg};font-family:Helvetica,Arial,sans-serif">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PALETTE.bg}"><tr><td align="center" style="padding:24px 12px">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${PALETTE.border};border-radius:6px">`,
    `<tr><td style="background:${PALETTE.accent};color:${PALETTE.onAccent};padding:18px 24px;font-size:14px;letter-spacing:.08em;text-transform:uppercase">${escapeHtml(siteName)}</td></tr>`,
    `<tr><td style="padding:24px">`,
    `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${PALETTE.fg};font-weight:600">${escapeHtml(heading)}</h1>`,
    inner,
    '</td></tr>',
    `<tr><td style="background:${PALETTE.surface};color:${PALETTE.muted};padding:14px 24px;font-size:12px">${footerHtml ?? escapeHtml(siteName)}</td></tr>`,
    '</table></td></tr></table></body></html>',
  ].join('');
}

const BRING_ALONG =
  'Breng je fiets mee (proper en in werkende staat), de schoenen en fietskleding waarin je écht rijdt, en eventuele notities over wat je dwars zit.';

// ---------------------------------------------------------------------------
// Transactional footer (customer-facing mails)
//
// Legal identity (art. 2:20 WVV), phone, and links to the terms and the
// privacy statement. No unsubscribe link: these are service messages about a
// booking, not marketing. Identity comes from `@/lib/studio/legal`, the same
// source as the public footer.
// ---------------------------------------------------------------------------

function legalFooter(data: BookingEmailData) {
  const base = data.siteUrl.replace(/\/+$/, '');
  return {
    identity: `${LEGAL_IDENTITY.name} (handelsnaam ${LEGAL_IDENTITY.tradeName}), ${LEGAL_IDENTITY.street}, ${LEGAL_IDENTITY.city} · KBO/btw ${LEGAL_IDENTITY.kbo} · RPR ${LEGAL_IDENTITY.rpr}`,
    phone: `Tel. ${data.contactPhoneLabel?.trim() || LEGAL_IDENTITY.phoneLabel}`,
    termsUrl: `${base}${LEGAL_LINKS.terms}`,
    privacyUrl: `${base}${LEGAL_LINKS.privacy}`,
  };
}

function legalFooterText(data: BookingEmailData): string {
  const footer = legalFooter(data);
  return [
    '--',
    footer.identity,
    footer.phone,
    `Algemene voorwaarden: ${footer.termsUrl}`,
    `Privacyverklaring: ${footer.privacyUrl}`,
  ].join('\n');
}

function legalFooterHtml(data: BookingEmailData): string {
  const footer = legalFooter(data);
  const link = (href: string, label: string) =>
    `<a href="${escapeHtml(href)}" style="color:${PALETTE.muted};text-decoration:underline">${escapeHtml(label)}</a>`;
  return (
    `<p style="margin:0 0 6px;line-height:1.5">${escapeHtml(footer.identity)}</p>` +
    `<p style="margin:0;line-height:1.5">${escapeHtml(footer.phone)} · ` +
    `${link(footer.termsUrl, 'Algemene voorwaarden')} · ${link(footer.privacyUrl, 'Privacyverklaring')}</p>`
  );
}

// ---------------------------------------------------------------------------
// Customer: confirmation
// ---------------------------------------------------------------------------

export function bookingConfirmationEmail(data: BookingEmailData): RenderedEmail {
  const subject = `Je afspraak is bevestigd: ${data.serviceName} op ${formatDateShort(data.startsAt, data.timezone)} om ${formatTime(data.startsAt, data.timezone)}`;
  const heading = 'Je afspraak staat vast';
  const rows: Row[] = [
    ['Wat', `${data.serviceName} (${formatDuration(data.durationMinutes)})`],
    ['Wanneer', whenLabel(data)],
    ['Bij', data.providerName],
    ['Waar', whereLines(data).join('\n')],
  ];
  const intro = `Hallo ${data.customerName}, bedankt voor je boeking. Dit is je afspraak:`;
  const extra = data.confirmationText?.trim() || '';
  const ics =
    'In de bijlage vind je een agendabestand (.ics) om de afspraak in je eigen agenda te zetten.';
  const cancelLine =
    data.cancelUrl && data.cancelDeadline
      ? `Kan je toch niet? Annuleer dan via onderstaande link, tot ${formatSlot(data.cancelDeadline, data.timezone)}.`
      : data.cancelUrl
        ? 'Kan je toch niet? Annuleer dan via onderstaande link.'
        : '';
  const phoneLine = data.contactPhoneLabel
    ? `Later annuleren of iets wijzigen? Bel ons op ${data.contactPhoneLabel}.`
    : '';

  const text = [
    intro,
    '',
    rowsText(rows),
    '',
    extra,
    ics,
    BRING_ALONG,
    '',
    cancelLine,
    data.cancelUrl ?? '',
    phoneLine,
    '',
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
      extra ? paragraph(extra) : '',
      paragraph(ics),
      paragraph(BRING_ALONG),
      cancelLine ? paragraph(cancelLine) : '',
      data.cancelUrl ? button(data.cancelUrl, 'Afspraak annuleren') : '',
      phoneLine ? paragraph(phoneLine) : '',
      paragraph('Tot dan!'),
    ].join(''),
    legalFooterHtml(data),
  );

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Provider: new booking
// ---------------------------------------------------------------------------

export function providerNotificationEmail(data: BookingEmailData): RenderedEmail {
  const subject = `Nieuwe afspraak: ${data.serviceName} — ${data.customerName}, ${formatDateShort(data.startsAt, data.timezone)} ${formatTime(data.startsAt, data.timezone)}`;
  const heading = 'Nieuwe afspraak';
  const rows: Row[] = [
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
  const intro = `Hallo ${data.providerName}, er is een nieuwe afspraak geboekt via de website.`;
  const text = [
    intro,
    '',
    rowsText(rows),
    '',
    data.adminUrl ? `Bekijk ze in de admin: ${data.adminUrl}` : '',
  ]
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

// ---------------------------------------------------------------------------
// Cancellation (customer or provider)
// ---------------------------------------------------------------------------

export function bookingCancellationEmail(
  data: BookingEmailData,
  audience: 'customer' | 'provider',
): RenderedEmail {
  const shortWhen = `${formatDateShort(data.startsAt, data.timezone)} om ${formatTime(data.startsAt, data.timezone)}`;
  const rows: Row[] = [
    ['Dienst', data.serviceName],
    ['Wanneer', whenLabel(data)],
    [
      audience === 'customer' ? 'Bij' : 'Klant',
      audience === 'customer' ? data.providerName : data.customerName,
    ],
    ['Waar', whereLines(data).join('\n')],
  ];

  if (audience === 'customer') {
    const subject = `Je afspraak is geannuleerd: ${data.serviceName} op ${shortWhen}`;
    const intro =
      data.cancelledBy === 'customer'
        ? `Hallo ${data.customerName}, je hebt je afspraak geannuleerd. Dat is in orde.`
        : `Hallo ${data.customerName}, we moesten je afspraak helaas annuleren. Sorry voor het ongemak.`;
    const next = `Een nieuwe afspraak maken kan altijd via ${data.siteUrl}/afspraak${data.contactPhoneLabel ? ` of telefonisch op ${data.contactPhoneLabel}` : ''}.`;
    const text = [
      intro,
      '',
      rowsText(rows),
      '',
      next,
      '',
      data.siteName,
      '',
      legalFooterText(data),
    ].join('\n');
    const html = layout(
      data.siteName,
      'Afspraak geannuleerd',
      [
        paragraph(intro),
        rowsHtml(rows),
        paragraph(next),
        button(`${data.siteUrl}/afspraak`, 'Nieuwe afspraak maken'),
      ].join(''),
      legalFooterHtml(data),
    );
    return { subject, html, text };
  }

  const who =
    data.cancelledBy === 'customer'
      ? 'de klant (via de annuleerlink)'
      : data.cancelledBy === 'admin'
        ? 'een beheerder'
        : 'jou';
  const subject = `Afspraak geannuleerd: ${data.serviceName} — ${data.customerName}, ${shortWhen}`;
  const intro = `Hallo ${data.providerName}, deze afspraak is geannuleerd door ${who}. Het tijdslot is weer vrij.`;
  const text = [intro, '', rowsText(rows), '', data.adminUrl ? `Admin: ${data.adminUrl}` : '']
    .filter(Boolean)
    .join('\n');
  const html = layout(
    data.siteName,
    'Afspraak geannuleerd',
    [
      paragraph(intro),
      rowsHtml(rows),
      data.adminUrl ? button(data.adminUrl, 'Open in de admin') : '',
    ].join(''),
  );
  return { subject, html, text };
}
