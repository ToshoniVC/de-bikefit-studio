import { describe, expect, it } from 'vitest';
import {
  assignmentTodoEmail,
  bookingAssignedEmail,
  bookingReassignedEmail,
} from './templates-assignment';
import { bookingConfirmationEmail, type BookingEmailData } from './templates';
import { formatDateShort } from '@/lib/booking/time';

/** "za 24 okt." as date-fns writes it; 09:00 in Brussels. */
const SHORT = formatDateShort('2026-10-24T07:00:00.000Z', 'Europe/Brussels');

const DATA: BookingEmailData = {
  siteName: 'De Bikefit Studio',
  siteUrl: 'https://studio.invalid',
  serviceName: 'Volwassenenfit',
  durationMinutes: 90,
  providerName: '',
  assignmentPending: true,
  heldBy: 'Rutger <b>',
  assignUrl: 'https://studio.invalid/admin/bookings?assignment=pending',
  adminUrl: 'https://studio.invalid/admin/bookings',
  customerName: 'Anna <script>',
  customerEmail: 'anna@example.com',
  customerPhone: '+32 470 12 34 56',
  startsAt: '2026-10-24T07:00:00.000Z', // 09:00 in Brussels
  endsAt: '2026-10-24T08:30:00.000Z',
  timezone: 'Europe/Brussels',
  locationLabel: 'De Bikefit Studio',
  locationKind: 'studio',
  locationAddressLines: ['Ninove'],
  contactPhoneLabel: '0473 95 26 33',
};

describe('assignmentTodoEmail', () => {
  it('asks the beheerder to assign, names the holder and links the pending list', () => {
    const mail = assignmentTodoEmail(DATA);
    expect(mail.subject).toBe(`Toe te wijzen: Volwassenenfit — Anna <script>, ${SHORT} 09:00`);
    expect(mail.text).toContain('zonder een aanbieder te kiezen');
    expect(mail.text).toContain('Voorlopig bij: Rutger <b>');
    expect(mail.text).toContain(
      'Toewijzen in de admin: https://studio.invalid/admin/bookings?assignment=pending',
    );
    expect(mail.html).toContain('Rutger &lt;b&gt;');
    expect(mail.html).toContain('Anna &lt;script&gt;');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('href="https://studio.invalid/admin/bookings?assignment=pending"');
  });
});

describe('bookingAssignedEmail', () => {
  it('tells the customer who does the fit, with the legal footer', () => {
    const mail = bookingAssignedEmail({
      ...DATA,
      providerName: 'Rutger',
      assignmentPending: false,
    });
    expect(mail.subject).toBe(`Je afspraak is bij Rutger: Volwassenenfit op ${SHORT} om 09:00`);
    expect(mail.text).toContain('Rutger doet je Volwassenenfit');
    expect(mail.text).toContain('Bij: Rutger');
    expect(mail.text).toContain('Bel ons op 0473 95 26 33');
    expect(mail.text).toContain('Privacyverklaring: https://studio.invalid/');
    expect(mail.html).toContain('Je fitter is bekend');
  });
});

describe('bookingReassignedEmail', () => {
  it('tells the previous holder the slot is free again', () => {
    const mail = bookingReassignedEmail(
      { ...DATA, providerName: 'Toshoni', assignmentPending: false },
      'Rutger',
    );
    expect(mail.subject).toBe(
      `Afspraak niet meer bij jou: Volwassenenfit — Anna <script>, ${SHORT} 09:00`,
    );
    expect(mail.text).toContain('Hallo Rutger, een beheerder wees deze afspraak toe aan Toshoni');
    expect(mail.text).toContain('Nu bij: Toshoni');
    expect(mail.html).toContain('Open in de admin');
  });
});

describe('bookingConfirmationEmail while the booking waits for assignment', () => {
  it('names no provider and says who will be announced by e-mail', () => {
    const mail = bookingConfirmationEmail({
      ...DATA,
      cancelUrl: 'https://studio.invalid/afspraak/annuleren/x',
    });
    expect(mail.text).not.toContain('Bij:');
    expect(mail.text).toContain('Bij wie je terechtkomt, laten we je nog apart per e-mail weten.');
    const assigned = bookingConfirmationEmail({
      ...DATA,
      providerName: 'Rutger',
      assignmentPending: false,
    });
    expect(assigned.text).toContain('Bij: Rutger');
    expect(assigned.text).not.toContain('laten we je nog apart');
  });
});
