import { describe, expect, it } from 'vitest';
import { DEFAULT_SERVICES } from '@/lib/booking/defaults';
import { formatPrice } from '@/lib/booking/format';
import { groupBookingChoices, offerPageSlug, resolveBookingSelection } from './catalogue';
import { DEFAULT_OFFERS, offerBlockData } from './defaults';
import { buildOfferCatalogue, type CataloguePage } from './offer-catalogue';
import type { OfferingServiceInfo, OfferingSettings } from './offering';

/**
 * The public catalogue as Beheer → Aanbod shapes it: cards, statuses, prices,
 * durations, hidden pages, and which services `/afspraak` may offer. Pages and
 * services are the seeded ones (`defaults.ts`), so "before" (legacy, no
 * settings saved) and "after" (settings saved) can be compared directly.
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

const PAGES: CataloguePage[] = [
  ...DEFAULT_OFFERS.map((offer) => ({
    id: `page-${offer.slug}`,
    slug: offerPageSlug(offer.slug),
    blocks: [{ type: 'offer', data: offerBlockData(offer) }],
  })),
  {
    id: 'page-cadeaubon',
    slug: 'aanbod/cadeaubon',
    blocks: [
      { type: 'giftVoucher', data: { sortOrder: 0, title: 'Cadeaubon', summary: '', intro: '' } },
    ],
  },
  // Not an offer page: ignored.
  { id: 'page-aanbod', slug: 'aanbod', blocks: [{ type: 'offerCatalogue', data: {} }] },
];

const BIKEFIT = 'page-bikefit-huidige-fiets';
const LACTAAT = 'page-lactaattest';

const bikefitStored: OfferingSettings = {
  isListed: true,
  bookingMode: 'direct',
  variantMode: 'audience',
  variants: [
    { audience: 'adult', serviceId: ADULT, priceCents: null },
    { audience: 'youth', serviceId: YOUTH, priceCents: null },
  ],
};

function build(
  stored: Array<{ pageId: string; settings: OfferingSettings }> = [],
  bookable: ReadonlySet<string> = ALL_OFFERED,
) {
  return buildOfferCatalogue({
    pages: PAGES,
    stored,
    services: SERVICES,
    bookableServiceIds: bookable,
  });
}

function card(catalogue: ReturnType<typeof build>, slug: string) {
  return catalogue.offers.find((offer) => offer.slug === slug);
}

describe('buildOfferCatalogue: before and after the settings are saved', () => {
  it('legacy (nothing saved): Bikefit bookable as Volwassene/Jeugd, the rest on request', () => {
    const catalogue = build();
    const bikefit = card(catalogue, 'bikefit-huidige-fiets')!;
    expect(bikefit).toMatchObject({
      status: 'bookable',
      priceLabel: 'Prijs op aanvraag',
      durationLabel: 'Volwassene: 1 u 30 min · Jeugd: 1 uur',
      bookingServiceSlugs: ['volwassenenfit', 'jeugdfit'],
    });
    for (const offer of catalogue.offers.filter((entry) => entry.kind === 'service')) {
      if (offer.slug === 'bikefit-huidige-fiets') continue;
      expect(offer, offer.slug).toMatchObject({
        status: 'enquiry',
        priceLabel: 'Prijs op aanvraag',
        bookingServiceSlugs: [],
      });
    }
    expect(card(catalogue, 'cadeaubon')).toMatchObject({ kind: 'giftVoucher', status: null });
    expect(catalogue.withheldServiceIds).toEqual([]);
    expect(catalogue.hiddenPageIds).toEqual([]);
  });

  it('saving the derived settings changes nothing a visitor sees', () => {
    const before = build();
    const after = build([{ pageId: BIKEFIT, settings: bikefitStored }]);
    const strip = (offers: typeof before.offers) =>
      offers.map(({ variants: _variants, ...offer }) => {
        void _variants;
        return offer;
      });
    expect(strip(after.offers)).toEqual(strip(before.offers));
    expect(after.withheldServiceIds).toEqual([]);
  });
});

describe('buildOfferCatalogue: what Beheer → Aanbod controls', () => {
  it('a direct offering nobody offers is temporarily unavailable, never routed elsewhere', () => {
    const catalogue = build(
      [{ pageId: BIKEFIT, settings: bikefitStored }],
      new Set(['svc-gezinspakket']),
    );
    const bikefit = card(catalogue, 'bikefit-huidige-fiets')!;
    expect(bikefit).toMatchObject({ status: 'unavailable', bookingServiceSlugs: [] });
    const selection = resolveBookingSelection({
      requested: 'bikefit-huidige-fiets',
      offers: catalogue.offers,
      services: [{ id: 'svc-gezinspakket', slug: 'gezinspakket' }],
    });
    expect(selection).toEqual({
      kind: 'offer',
      offer: {
        slug: 'bikefit-huidige-fiets',
        title: bikefit.title,
        path: '/aanbod/bikefit-huidige-fiets',
        status: 'unavailable',
      },
      serviceIds: [],
      initialServiceId: null,
    });
  });

  it('an enquiry offering keeps its status apart from "unavailable"', () => {
    const catalogue = build();
    const selection = resolveBookingSelection({
      requested: 'lactaattest',
      offers: catalogue.offers,
      services: SERVICES,
    });
    expect(selection).toMatchObject({
      kind: 'offer',
      offer: { status: 'enquiry' },
      serviceIds: [],
    });
  });

  it('a hidden offering leaves every overview, its page 404s, and its services are held back', () => {
    const catalogue = build([{ pageId: BIKEFIT, settings: { ...bikefitStored, isListed: false } }]);
    expect(card(catalogue, 'bikefit-huidige-fiets')).toBeUndefined();
    expect(catalogue.hiddenPageIds).toEqual([BIKEFIT]);
    expect(catalogue.byPageId[BIKEFIT].offering?.isListed).toBe(false);
    expect(new Set(catalogue.withheldServiceIds)).toEqual(new Set([ADULT, YOUTH]));
  });

  it('switching Bikefit to enquiry holds its services back from /afspraak', () => {
    const catalogue = build([
      { pageId: BIKEFIT, settings: { ...bikefitStored, bookingMode: 'enquiry' } },
    ]);
    expect(card(catalogue, 'bikefit-huidige-fiets')).toMatchObject({
      status: 'enquiry',
      bookingServiceSlugs: [],
    });
    expect(new Set(catalogue.withheldServiceIds)).toEqual(new Set([ADULT, YOUTH]));
    const bookable = SERVICES.filter((s) => !catalogue.withheldServiceIds.includes(s.id));
    expect(bookable.map((service) => service.slug)).toEqual([
      'gezinspakket',
      'fit-aan-huis',
      'inspanningstest',
    ]);
  });

  it('an offering saved for a draft page still holds its services back', () => {
    const catalogue = build([{ pageId: 'page-draft', settings: bikefitStored }]);
    // The published Bikefit page has no row (legacy) and releases them again.
    expect(catalogue.withheldServiceIds).toEqual([]);
    const onlyDraft = buildOfferCatalogue({
      pages: PAGES.filter((page) => page.id !== BIKEFIT),
      stored: [{ pageId: 'page-draft', settings: bikefitStored }],
      services: SERVICES,
      bookableServiceIds: ALL_OFFERED,
    });
    expect(new Set(onlyDraft.withheldServiceIds)).toEqual(new Set([ADULT, YOUTH]));
  });

  it('prices and labels per variant reach the cards and the widget', () => {
    const catalogue = build([
      {
        pageId: BIKEFIT,
        settings: {
          ...bikefitStored,
          variants: [
            { audience: 'adult', serviceId: ADULT, priceCents: 15000 },
            { audience: 'youth', serviceId: YOUTH, priceCents: null },
          ],
        },
      },
    ]);
    expect(card(catalogue, 'bikefit-huidige-fiets')?.priceLabel).toBe(
      `Volwassene ${formatPrice(15000)} · Jeugd op aanvraag`,
    );
    expect(catalogue.variantDisplay).toEqual({
      [ADULT]: { label: 'Volwassene', priceLabel: formatPrice(15000) },
      [YOUTH]: { label: 'Jeugd', priceLabel: '' },
    });
  });

  it('a legacy offering never overrides the widget prices of its services', () => {
    expect(build().variantDisplay).toEqual({});
  });

  it('a single-option enquiry with a price shows it; the widget groups only bookable variants', () => {
    const catalogue = build(
      [
        {
          pageId: LACTAAT,
          settings: {
            isListed: true,
            bookingMode: 'enquiry',
            variantMode: 'single',
            variants: [{ audience: 'all', serviceId: null, priceCents: 9500 }],
          },
        },
        { pageId: BIKEFIT, settings: bikefitStored },
      ],
      new Set([ADULT, 'svc-gezinspakket']),
    );
    expect(card(catalogue, 'lactaattest')).toMatchObject({
      status: 'enquiry',
      priceLabel: formatPrice(9500),
    });
    const services = [
      { id: ADULT, slug: 'volwassenenfit' },
      { id: 'svc-gezinspakket', slug: 'gezinspakket' },
    ];
    expect(groupBookingChoices({ offers: catalogue.offers, services })).toEqual([
      {
        kind: 'offer',
        offer: {
          slug: 'bikefit-huidige-fiets',
          title: card(catalogue, 'bikefit-huidige-fiets')!.title,
          path: '/aanbod/bikefit-huidige-fiets',
        },
        serviceIds: [ADULT],
      },
      { kind: 'service', serviceId: 'svc-gezinspakket' },
    ]);
  });
});
