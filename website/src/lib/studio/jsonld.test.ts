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

  it('with a resolved offering: only prices set in Beheer → Aanbod, never the editorial cents', () => {
    const variant = (audience: 'adult' | 'youth' | 'all', priceCents: number | null) => ({
      audience,
      label: audience === 'adult' ? 'Volwassene' : audience === 'youth' ? 'Jeugd' : '',
      serviceId: null,
      serviceSlug: null,
      serviceName: null,
      durationMinutes: null,
      requiresGuardian: false,
      priceCents,
      bookable: true,
    });
    const offering = (variants: ReturnType<typeof variant>[]) => ({
      source: 'stored' as const,
      isListed: true,
      bookingMode: 'direct' as const,
      variantMode: variants.length > 1 ? ('audience' as const) : ('single' as const),
      status: 'bookable' as const,
      variants,
    });
    // The block carries 12000 editorial cents; the offering has no price → no offers.
    expect(
      offerServiceJsonLd(
        offerBlock([]),
        settings,
        origin,
        canonical,
        offering([variant('all', null)]),
      ),
    ).not.toHaveProperty('offers');
    expect(
      offerServiceJsonLd(
        offerBlock([]),
        settings,
        origin,
        canonical,
        offering([variant('all', 9900)]),
      )?.offers,
    ).toEqual({ '@type': 'Offer', price: '99.00', priceCurrency: 'EUR' });
    expect(
      offerServiceJsonLd(
        offerBlock(['volwassenenfit', 'jeugdfit']),
        settings,
        origin,
        canonical,
        offering([variant('adult', 15000), variant('youth', null)]),
      )?.offers,
    ).toEqual({ '@type': 'Offer', name: 'Volwassene', price: '150.00', priceCurrency: 'EUR' });
  });
});
