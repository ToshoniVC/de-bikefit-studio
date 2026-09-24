import { describe, expect, it } from 'vitest';
import { buildIcs, icsDate, icsEscape, icsUidFor, type IcsEventInput } from './ics';

const BOOKING: IcsEventInput = {
  uid: icsUidFor('bk_123'),
  startsAt: '2026-10-24T07:00:00.000Z', // 09:00 in Brussels
  endsAt: '2026-10-24T08:30:00.000Z',
  summary: 'Bikefit bij De Bikefit Studio',
  stamp: '2026-09-24T10:00:00Z',
};

function lines(ics: string): string[] {
  return ics.replace(/\r\n /g, '').split('\r\n');
}

describe('buildIcs', () => {
  it('wraps exactly one VEVENT in a VCALENDAR with CRLF line endings', () => {
    const ics = buildIcs(BOOKING);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(lines(ics)).toEqual(
      expect.arrayContaining(['METHOD:PUBLISH', 'STATUS:CONFIRMED', 'SEQUENCE:0', 'TRANSP:OPAQUE']),
    );
  });

  it('writes every timestamp in UTC, also across the DST switch', () => {
    expect(lines(buildIcs(BOOKING))).toEqual(
      expect.arrayContaining([
        'DTSTAMP:20260924T100000Z',
        'DTSTART:20261024T070000Z',
        'DTEND:20261024T083000Z',
      ]),
    );
    // 09:00 local on 2026-10-25 is 08:00 UTC (winter time).
    const sunday = buildIcs({
      ...BOOKING,
      startsAt: new Date('2026-10-25T08:00:00Z'),
      endsAt: new Date('2026-10-25T09:30:00Z'),
    });
    expect(lines(sunday)).toContain('DTSTART:20261025T080000Z');
    expect(icsDate('2026-10-24T07:00:00.123Z')).toBe('20261024T070000Z');
  });

  it('uses a UID that is stable per booking and survives cancellation', () => {
    expect(icsUidFor('bk_123')).toBe('bk_123@debikefitstudio.be');
    expect(icsUidFor('bk_123')).toBe(icsUidFor('bk_123'));
    expect(icsUidFor('bk_123', 'staging.example')).toBe('bk_123@staging.example');
    const uid = 'UID:bk_123@debikefitstudio.be';
    expect(lines(buildIcs(BOOKING))).toContain(uid);
    expect(lines(buildIcs({ ...BOOKING, method: 'CANCEL' }))).toContain(uid);
  });

  it('marks a cancellation with METHOD:CANCEL, STATUS:CANCELLED and a higher sequence', () => {
    const cancelled = lines(buildIcs({ ...BOOKING, method: 'CANCEL', reminderMinutes: 60 }));
    expect(cancelled).toEqual(
      expect.arrayContaining(['METHOD:CANCEL', 'STATUS:CANCELLED', 'SEQUENCE:1']),
    );
    expect(cancelled).not.toContain('BEGIN:VALARM');
    expect(lines(buildIcs({ ...BOOKING, method: 'CANCEL', sequence: 3 }))).toContain('SEQUENCE:3');
  });

  it('escapes commas, semicolons, backslashes and newlines in text values', () => {
    const ics = lines(
      buildIcs({
        ...BOOKING,
        summary: 'Bikefit, 90 min; Ninove',
        description: 'Lijn 1\nLijn 2\r\nLijn 3',
        location: 'Kerkstraat 1, 9400 Ninove',
      }),
    );
    expect(ics).toContain('SUMMARY:Bikefit\\, 90 min\\; Ninove');
    expect(ics).toContain('DESCRIPTION:Lijn 1\\nLijn 2\\nLijn 3');
    expect(ics).toContain('LOCATION:Kerkstraat 1\\, 9400 Ninove');
    expect(icsEscape('C:\\pad')).toBe('C:\\\\pad');
  });

  it('folds long lines at 75 octets without splitting UTF-8 characters', () => {
    const description = 'é'.repeat(100);
    const ics = buildIcs({ ...BOOKING, description });
    for (const physical of ics.split('\r\n')) {
      expect(Buffer.byteLength(physical, 'utf8')).toBeLessThanOrEqual(75);
    }
    expect(lines(ics)).toContain(`DESCRIPTION:${description}`);
  });

  it('adds a display alarm only when a reminder is requested', () => {
    const withReminder = lines(buildIcs({ ...BOOKING, reminderMinutes: 60 }));
    expect(withReminder).toEqual(
      expect.arrayContaining(['BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT60M', 'END:VALARM']),
    );
    expect(lines(buildIcs({ ...BOOKING, reminderMinutes: 0 }))).not.toContain('BEGIN:VALARM');
  });

  it('adds optional fields only when given, with a quoted organizer name', () => {
    const minimal = buildIcs(BOOKING);
    for (const field of ['DESCRIPTION:', 'LOCATION:', 'URL:', 'ORGANIZER']) {
      expect(minimal).not.toContain(field);
    }
    const full = lines(
      buildIcs({
        ...BOOKING,
        url: 'https://debikefitstudio.be/afspraak/annuleren/abc',
        organizerName: 'Rutger "Fit"',
        organizerEmail: 'afspraken@debikefitstudio.be',
      }),
    );
    expect(full).toContain('URL:https://debikefitstudio.be/afspraak/annuleren/abc');
    expect(full).toContain('ORGANIZER;CN="Rutger \'Fit\'":mailto:afspraken@debikefitstudio.be');
  });

  it('keeps a line break in the organizer name from starting a new content line', () => {
    const ics = buildIcs({
      ...BOOKING,
      organizerName: 'Rutger\r\nATTENDEE:mailto:evil@example.com\nX',
      organizerEmail: 'afspraken@debikefitstudio.be',
    });
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).not.toMatch(/\r\nATTENDEE/);
    expect(unfolded).toContain(
      'ORGANIZER;CN="Rutger ATTENDEE:mailto:evil@example.com X":mailto:afspraken@debikefitstudio.be',
    );
  });
});
