import { describe, expect, it } from 'vitest';
import { giftVoucherReference, giftVoucherRequestEmail } from './email';

const base = {
  siteName: 'De Bikefit Studio',
  receivedAt: '2026-10-13T13:40:00.000Z',
  reference: 'CB-3F1C2A9E',
  order: {
    amountCents: 7550,
    message: 'Voor papa <script>alert(1)</script>\nVeel fietsplezier & groetjes',
    name: 'An "Fietsfan" Peeters',
    email: 'an@example.com',
    phone: '',
    requestId: '3f1c2a9e-7b4d-4c1e-9a8f-0d2b6e5c4a31',
  },
};

describe('giftVoucherRequestEmail', () => {
  const mail = giftVoucherRequestEmail(base);

  it('subject: amount and reference only, no personal data', () => {
    expect(mail.subject).toMatch(/^Cadeaubon-aanvraag: €\s?75,50 \(CB-3F1C2A9E\)$/);
    expect(mail.subject).not.toMatch(/Peeters|example\.com/);
  });

  it('text part: amount, message with line breaks, contact data and the manual workflow', () => {
    expect(mail.text).toMatch(/Bedrag: €\s?75,50/);
    expect(mail.text).toContain(
      'Voor papa <script>alert(1)</script>\nVeel fietsplezier & groetjes',
    );
    expect(mail.text).toContain('Naam: An "Fietsfan" Peeters');
    expect(mail.text).toContain('E-mail: an@example.com');
    expect(mail.text).toContain('Telefoon: niet ingevuld');
    expect(mail.text).toMatch(/1\. Maak een factuur op van €\s?75,50 en een betaallink\./);
    expect(mail.text).toContain('2. Stuur beide naar an@example.com.');
    expect(mail.text).toContain('Er is nog niets gefactureerd of betaald');
    expect(mail.text).toContain('dinsdag 13 oktober 2026, 15:40 (Brussel)');
  });

  it('HTML part: everything the visitor typed is escaped, line breaks kept', () => {
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain(
      'Voor papa &lt;script&gt;alert(1)&lt;/script&gt;<br>Veel fietsplezier &amp; groetjes',
    );
    expect(mail.html).toContain('An &quot;Fietsfan&quot; Peeters');
    expect(mail.html).not.toMatch(/<img/i);
  });

  it('says so when there is no personal message', () => {
    const empty = giftVoucherRequestEmail({ ...base, order: { ...base.order, message: '' } });
    expect(empty.text).toContain('(geen persoonlijke boodschap)');
  });
});

describe('giftVoucherReference', () => {
  it('derives a short, stable reference from the request id', () => {
    const now = new Date('2026-10-13T13:40:00Z');
    expect(giftVoucherReference('3f1c2a9e-7b4d-4c1e', now)).toBe('CB-3F1C2A9E');
    expect(giftVoucherReference(null, now)).toMatch(/^CB-[0-9A-Z]{1,8}$/);
  });
});
