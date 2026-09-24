/**
 * Minimal RFC 5545 calendar file for one booking. Plain module (no I/O).
 *
 * - Times are written in UTC (`DTSTART:20261024T070000Z`), which every
 *   calendar client converts to the reader's zone — no VTIMEZONE block needed.
 * - `METHOD:PUBLISH` for a new booking (the file just adds an event);
 *   `METHOD:CANCEL` + `STATUS:CANCELLED` with a higher `SEQUENCE` for a
 *   cancellation, same `UID`.
 * - Lines are CRLF-terminated and folded at 75 octets; text is escaped.
 */

export type IcsEventInput = {
  /** Stable across updates, e.g. {@link icsUidFor}(booking.id). */
  uid: string;
  startsAt: Date | string;
  endsAt: Date | string;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  organizerName?: string;
  organizerEmail?: string;
  method?: 'PUBLISH' | 'CANCEL';
  sequence?: number;
  /** DTSTAMP; defaults to now. */
  stamp?: Date | string;
  /** Adds a display reminder this many minutes before the start (0 = none). */
  reminderMinutes?: number;
};

export function icsUidFor(bookingId: string, host = 'debikefitstudio.be'): string {
  return `${bookingId}@${host}`;
}

/** `2026-10-24T07:00:00.000Z` → `20261024T070000Z`. */
export function icsDate(value: Date | string): string {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** Escapes TEXT values (RFC 5545 §3.3.11). */
export function icsEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * A quoted parameter value such as `CN="…"` (RFC 5545 §3.1: no DQUOTE and no
 * control characters). TEXT escaping (`\n`, `\,`) does not apply inside a
 * parameter, so line breaks and other control characters become a space
 * (otherwise a name could start a new content line) and `"` becomes `'`.
 */
export function icsParamValue(value: string): string {
  return Array.from(value, (char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f ? ' ' : char;
  })
    .join('')
    .replace(/"/g, "'")
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** Folds a content line at 75 octets (UTF-8 safe). */
export function icsFold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char, 'utf8');
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (currentBytes + size > limit) {
      parts.push(current);
      current = '';
      currentBytes = 0;
    }
    current += char;
    currentBytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function buildIcs(event: IcsEventInput): string {
  const method = event.method ?? 'PUBLISH';
  const cancelled = method === 'CANCEL';
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//De Bikefit Studio//Afspraken//NL',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${icsDate(event.stamp ?? new Date())}`,
    `DTSTART:${icsDate(event.startsAt)}`,
    `DTEND:${icsDate(event.endsAt)}`,
    `SUMMARY:${icsEscape(event.summary)}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${icsEscape(event.description)}`);
  if (event.location) lines.push(`LOCATION:${icsEscape(event.location)}`);
  if (event.url) lines.push(`URL:${event.url}`);
  if (event.organizerEmail) {
    const name = event.organizerName ? icsParamValue(event.organizerName) : '';
    const cn = name ? `;CN="${name}"` : '';
    lines.push(`ORGANIZER${cn}:mailto:${event.organizerEmail}`);
  }
  lines.push(`STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`);
  lines.push(`SEQUENCE:${event.sequence ?? (cancelled ? 1 : 0)}`);
  lines.push('TRANSP:OPAQUE');
  if (!cancelled && event.reminderMinutes && event.reminderMinutes > 0) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsEscape(event.summary)}`,
      `TRIGGER:-PT${Math.round(event.reminderMinutes)}M`,
      'END:VALARM',
    );
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}
