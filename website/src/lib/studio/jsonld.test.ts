import { describe, expect, it } from 'vitest';
import { defaultSiteSettings } from '@/lib/cms/blocks';
import { DEFAULT_OFFERS } from '@/lib/offers/defaults';
import type { ResolvedOffering } from '@/lib/offers/offering';
import { offeringServiceJsonLd } from './jsonld';

const settings = defaultSiteSettings();
const origin = 'https://studio.test';
const canonical = `${origin}/aanbod/bikefit-huidige-fiets`;
const content = DEFAULT_OFFERS.find(
  (entry) => entry.content.slug === 'bikefit-huidige-fiets',
)!.content;

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
const offering = (variants: ReturnType<typeof variant>[]): ResolvedOffering => ({
  source: 'stored',
  isListed: true,
  bookingMode: 'direct',
  variantMode: variants.length > 1 ? 'audience' : 'single',
  status: 'bookable',
  variants,
});
const node = (variants: ReturnType<typeof variant>[]) =>
  offeringServiceJsonLd({ content, offering: offering(variants), settings, origin, canonical });

describe('offering Service JSON-LD', () => {
  it('names the offering, its category and the organisation; no price while "Prijs op aanvraag"', () => {
    const service = node([variant('all', null)]);
    expect(service).toMatchObject({
      '@type': 'Service',
      '@id': `${canonical}#dienst`,
      name: 'Bikefit – huidige fiets',
      serviceType: 'Bikefit',
      url: canonical,
      provider: { '@id': `${origin}/#organization` },
    });
    expect(service).not.toHaveProperty('offers');
  });

  it('mirrors the prices set in Beheer → Aanbod: one amount, or one Offer per priced variant', () => {
    expect(node([variant('all', 9900)]).offers).toEqual({
      '@type': 'Offer',
      price: '99.00',
      priceCurrency: 'EUR',
    });
    expect(node([variant('adult', 15000), variant('youth', null)]).offers).toEqual({
      '@type': 'Offer',
      name: 'Volwassene',
      price: '150.00',
      priceCurrency: 'EUR',
    });
    expect(node([variant('adult', 15000), variant('youth', 9000)]).offers).toEqual([
      { '@type': 'Offer', name: 'Volwassene', price: '150.00', priceCurrency: 'EUR' },
      { '@type': 'Offer', name: 'Jeugd', price: '90.00', priceCurrency: 'EUR' },
    ]);
  });
});
