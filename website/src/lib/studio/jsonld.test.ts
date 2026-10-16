import { describe, expect, it } from 'vitest';
import { defaultSiteSettings } from '@/lib/cms/blocks';
import { offerSchema } from '@/lib/cms/blocks-aanbod';
import { offerServiceJsonLd } from './jsonld';

const settings = defaultSiteSettings();
const origin = 'https://studio.test';
const canonical = `${origin}/aanbod/bikefit-huidige-fiets`;

function offerBlock(bookingServiceSlugs: string[]) {
  return [
    {
      id: 'offer',
      type: 'offer' as const,
      data: offerSchema.parse({
        title: 'Bikefit – huidige fiets',
        priceCents: 12000,
        bookingServiceSlugs,
      }),
    },
  ];
}

describe('offer Service JSON-LD', () => {
  it('does not publish an independent editorial price for a linked offer', () => {
    const node = offerServiceJsonLd(
      offerBlock(['volwassenenfit', 'jeugdfit']),
      settings,
      origin,
      canonical,
    );
    expect(node).toMatchObject({ '@type': 'Service', name: 'Bikefit – huidige fiets' });
    expect(node).not.toHaveProperty('offers');
  });

  it('retains an approved editorial price for an unlinked enquiry offer', () => {
    const node = offerServiceJsonLd(offerBlock([]), settings, origin, canonical);
    expect(node?.offers).toEqual({ '@type': 'Offer', price: '120.00', priceCurrency: 'EUR' });
  });
});
