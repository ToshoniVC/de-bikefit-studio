import { describe, expect, it } from 'vitest';
import { DEFAULT_SERVICES } from '@/lib/booking/defaults';
import { formatPrice } from '@/lib/booking/format';
import { groupBookingChoices, resolveBookingSelection } from './catalogue';
import { DEFAULT_OFFERINGS, type DefaultOffering } from './defaults';
import { buildOfferCatalogue } from './offer-catalogue';
import type { OfferingServiceInfo, OfferingSettings } from './offering';
import type { OfferingRecord } from './offering-content';

/**
 * The public catalogue as Beheer → Aanbod shapes it: cards, statuses, prices,
 * durations, hidden offerings, and which services `/afspraak` may offer. The
 * offerings and services are the seeded ones (`defaults.ts`).
 */

const SERVICES: OfferingServiceInfo[] = DEFAULT_SERVICES.map((service) => ({
  id: `svc-${service.slug}`,
  slug: service.slug,
  name: service.name,
  choiceLabel: service.choiceLabel,
  durationMinutes: service.durationMinutes,
  isActive: true,
  requiresGuardian: service.requiresGuardian,
  priceCents: null,
  showPrice: false,
}));
const ALL_OFFERED = new Set(SERVICES.map((service) => service.id));
const ADULT = 'svc-volwassenenfit';
const YOUTH = 'svc-jeugdfit';
const HOME = 'svc-fit-aan-huis';

function record(entry: DefaultOffering, settings: Partial<OfferingSettings> = {}): OfferingRecord {
  return {
    id: `off-${entry.content.slug}`,
    locale: 'nl',
    content: entry.content,
    settings: {
      isListed: entry.isListed,
      bookingMode: entry.bookingMode,
      variantMode: entry.variantMode,
      variants: entry.variants.map((variant) => ({
        audience: variant.audience,
        serviceId: variant.serviceSlug ? `svc-${variant.serviceSlug}` : null,
        priceCents: null,
      })),
      ...settings,
    },
    updatedAt: '2026-10-17T08:00:00.000Z',
  };
}

const SEEDED = DEFAULT_OFFERINGS.map((entry) => record(entry));
const bikefit = (settings: Partial<OfferingSettings> = {}) =>
  record(
    DEFAULT_OFFERINGS.find((entry) => entry.content.slug === 'bikefit-huidige-fiets')!,
    settings,
  );

function build(offerings: OfferingRecord[] = SEEDED, bookable: ReadonlySet<string> = ALL_OFFERED) {
  return buildOfferCatalogue({ offerings, services: SERVICES, bookableServiceIds: bookable });
}

function card(catalogue: ReturnType<typeof build>, slug: string) {
  return catalogue.offers.find((offer) => offer.slug === slug);
}

describe('buildOfferCatalogue: the seeded offer', () => {
  it('seven shown offers in category order; Bikefit bookable as Volwassene/Jeugd, the rest on request', () => {
    const catalogue = build();
    expect(catalogue.offers.map((offer) => offer.slug)).toEqual([
      'bikefit-nieuwe-fiets',
      'bikefit-huidige-fiets',
      'voetanalyse',
      'zadelanalyse',
      'afstellen-schoenplaatjes',
      'lactaattest',
      'coaching',
    ]);
    expect(card(catalogue, 'bikefit-huidige-fiets')).toMatchObject({
      status: 'bookable',
      bookingServiceSlugs: ['volwassenenfit', 'jeugdfit'],
      durationLabel: 'Volwassene: 1 u 30 min · Jeugd: 1 uur',
      priceLabel: 'Prijs op aanvraag',
    });
    expect(catalogue.offers.filter((offer) => offer.status === 'enquiry')).toHaveLength(6);
    expect(card(catalogue, 'lactaattest')?.durationLabel).toBe('Duur in overleg');
  });

  it('the three hidden legacy services are kept out of sight and held back from /afspraak', () => {
    const catalogue = build();
    expect(catalogue.hiddenSlugs.sort()).toEqual([
      'fit-aan-huis',
      'gezinspakket',
      'inspanningstest',
    ]);
    expect(catalogue.bySlug['fit-aan-huis']?.offering.isListed).toBe(false);
    expect(catalogue.withheldServiceIds.sort()).toEqual([
      HOME,
      'svc-gezinspakket',
      'svc-inspanningstest',
    ]);
    expect(catalogue.withheldServiceIds).not.toContain(ADULT);
  });

  it('the widget shows Bikefit once with Volwassene/Jeugd, and nothing hidden', () => {
    const catalogue = build();
    const withheld = new Set(catalogue.withheldServiceIds);
    const services = SERVICES.filter((service) => !withheld.has(service.id));
    expect(groupBookingChoices({ offers: catalogue.offers, services })).toEqual([
      expect.objectContaining({ kind: 'offer', serviceIds: [ADULT, YOUTH] }),
    ]);
    expect(catalogue.variantDisplay[ADULT]).toEqual({ label: 'Volwassene', priceLabel: '' });
    expect(
      resolveBookingSelection({ requested: 'fit-aan-huis', offers: catalogue.offers, services }),
    ).toEqual({
      kind: 'unknown',
      requested: 'fit-aan-huis',
    });
  });
});

describe('buildOfferCatalogue: what Beheer → Aanbod controls', () => {
  it('a direct offering nobody offers is temporarily unavailable, never routed elsewhere', () => {
    const catalogue = build(SEEDED, new Set([HOME]));
    expect(card(catalogue, 'bikefit-huidige-fiets')).toMatchObject({
      status: 'unavailable',
      bookingServiceSlugs: [],
      durationLabel: 'Volwassene: 1 u 30 min · Jeugd: 1 uur',
    });
    expect(catalogue.withheldServiceIds).not.toContain(ADULT);
  });

  it('a variant nobody offers is left out of the booking; the other stays bookable', () => {
    const catalogue = build(SEEDED, new Set([ADULT]));
    expect(card(catalogue, 'bikefit-huidige-fiets')).toMatchObject({
      status: 'bookable',
      bookingServiceSlugs: ['volwassenenfit'],
    });
  });

  it('a hidden offering leaves every overview, its slug is listed, its services are held back', () => {
    const catalogue = build([
      bikefit({ isListed: false }),
      ...SEEDED.filter((r) => r.content.slug !== 'bikefit-huidige-fiets'),
    ]);
    expect(card(catalogue, 'bikefit-huidige-fiets')).toBeUndefined();
    expect(catalogue.hiddenSlugs).toContain('bikefit-huidige-fiets');
    expect(catalogue.bySlug['bikefit-huidige-fiets']?.content.title).toBe(
      'Bikefit – huidige fiets',
    );
    expect(catalogue.withheldServiceIds).toEqual(expect.arrayContaining([ADULT, YOUTH]));
  });

  it('switching Bikefit to enquiry holds its services back and keeps the editorial duration', () => {
    const catalogue = build([
      bikefit({ bookingMode: 'enquiry' }),
      ...SEEDED.filter((r) => r.content.slug !== 'bikefit-huidige-fiets'),
    ]);
    expect(card(catalogue, 'bikefit-huidige-fiets')).toMatchObject({
      status: 'enquiry',
      bookingServiceSlugs: [],
      durationLabel: 'Duur in overleg',
    });
    expect(catalogue.withheldServiceIds).toEqual(expect.arrayContaining([ADULT, YOUTH]));
  });

  it('prices and labels per variant reach the cards and the widget', () => {
    const priced = bikefit({
      variants: [
        { audience: 'adult', serviceId: ADULT, priceCents: 15000 },
        { audience: 'youth', serviceId: YOUTH, priceCents: null },
      ],
    });
    const catalogue = build([priced]);
    expect(card(catalogue, 'bikefit-huidige-fiets')?.priceLabel).toBe(
      `Volwassene ${formatPrice(15000)} · Jeugd op aanvraag`,
    );
    expect(catalogue.variantDisplay).toEqual({
      [ADULT]: { label: 'Volwassene', priceLabel: formatPrice(15000) },
      [YOUTH]: { label: 'Jeugd', priceLabel: '' },
    });
  });

  it('a single-option enquiry with a price shows it', () => {
    const coaching = SEEDED.find((r) => r.content.slug === 'coaching')!;
    const catalogue = build([
      {
        ...coaching,
        settings: {
          ...coaching.settings,
          variants: [{ audience: 'all', serviceId: null, priceCents: 9900 }],
        },
      },
    ]);
    expect(card(catalogue, 'coaching')?.priceLabel).toBe(formatPrice(9900));
    expect(catalogue.variantDisplay).toEqual({});
  });
});
