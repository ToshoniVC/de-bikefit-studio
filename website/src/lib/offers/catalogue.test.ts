import { describe, expect, it } from 'vitest';
import { DEFAULT_SERVICES } from '@/lib/booking/defaults';
import {
  bookingChoiceLabel,
  GIFT_VOUCHER_PRICE_LABEL,
  groupBookingChoices,
  OFFER_CTA_LABEL,
  OFFER_PRICE_FALLBACK,
  offerBookingHref,
  offerFromOffering,
  offerPagePath,
  offersInCategory,
  parseServiceParam,
  resolveBookingSelection,
  showsOfferPrices,
  sortOffers,
  type CatalogueOffer,
} from './catalogue';
import { DEFAULT_OFFERINGS, DEFAULT_OFFERS, LEGACY_OFFERINGS } from './defaults';
import { resolveOffering, type OfferingServiceInfo } from './offering';

const emptyImage = { mediaId: null, url: null, alt: '', decorative: false };

function offer(partial: Partial<CatalogueOffer> & { slug: string }): CatalogueOffer {
  return {
    id: `off-${partial.slug}`,
    path: offerPagePath(partial.slug),
    category: 'bikefit',
    sortOrder: 0,
    title: partial.slug,
    summary: '',
    priceLabel: OFFER_PRICE_FALLBACK,
    durationLabel: 'Duur in overleg',
    bookingServiceSlugs: [],
    status: partial.bookingServiceSlugs?.length ? 'bookable' : 'enquiry',
    variants: [],
    image: emptyImage,
    ...partial,
  };
}

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

describe('offer paths', () => {
  it('serves an offering at /aanbod/<slug>', () => {
    expect(offerPagePath('voetanalyse')).toBe('/aanbod/voetanalyse');
  });

  it('shows offer prices only on /aanbod and the offer pages under it', () => {
    expect(showsOfferPrices('aanbod')).toBe(true);
    expect(showsOfferPrices('/aanbod/')).toBe(true);
    expect(showsOfferPrices('aanbod/voetanalyse')).toBe(true);
    expect(showsOfferPrices('')).toBe(false);
    expect(showsOfferPrices('bikefit')).toBe(false);
    expect(showsOfferPrices('voor-wie')).toBe(false);
    expect(showsOfferPrices('aanbodx')).toBe(false);
    expect(showsOfferPrices('aanbod/a/b')).toBe(false);
  });

  it('links the booking button to /afspraak with the offer slug and the widget anchor', () => {
    expect(offerBookingHref('bikefit-huidige-fiets')).toBe(
      '/afspraak?dienst=bikefit-huidige-fiets#boeken',
    );
  });
});

describe('parseServiceParam (query-string and route boundary)', () => {
  it('accepts a slug and normalises case and whitespace', () => {
    expect(parseServiceParam('lactaattest')).toBe('lactaattest');
    expect(parseServiceParam('  Bikefit-Huidige-Fiets ')).toBe('bikefit-huidige-fiets');
  });

  it('takes the first value of a repeated parameter', () => {
    expect(parseServiceParam(['coaching', 'lactaattest'])).toBe('coaching');
  });

  it('drops anything that is not a plain slug', () => {
    for (const bad of [
      undefined,
      '',
      '   ',
      '../admin',
      'a b',
      'x;drop',
      '<script>',
      'slug-',
      '-slug',
      'a'.repeat(81),
      42,
    ]) {
      expect(parseServiceParam(bad)).toBeNull();
    }
  });
});

describe('offerFromOffering (the card and labels of one offering)', () => {
  const resolved = (slug: string, bookable = new Set(SERVICES.map((s) => s.id))) => {
    const entry = DEFAULT_OFFERINGS.find((d) => d.content.slug === slug)!;
    const settings = {
      isListed: entry.isListed,
      bookingMode: entry.bookingMode,
      variantMode: entry.variantMode,
      variants: entry.variants.map((variant) => ({
        audience: variant.audience,
        serviceId: variant.serviceSlug ? `svc-${variant.serviceSlug}` : null,
        priceCents: null,
      })),
    };
    return offerFromOffering(
      { id: `off-${slug}`, content: entry.content },
      resolveOffering({
        settings,
        source: 'stored',
        services: SERVICES,
        bookableServiceIds: bookable,
      }),
    );
  };

  it('a directly bookable offering: services, durations from them, no invented price', () => {
    const card = resolved('bikefit-huidige-fiets');
    expect(card).toMatchObject({
      slug: 'bikefit-huidige-fiets',
      path: '/aanbod/bikefit-huidige-fiets',
      category: 'bikefit',
      title: 'Bikefit – huidige fiets',
      status: 'bookable',
      bookingServiceSlugs: ['volwassenenfit', 'jeugdfit'],
      durationLabel: 'Volwassene: 1 u 30 min · Jeugd: 1 uur',
      priceLabel: OFFER_PRICE_FALLBACK,
    });
    expect(card.summary).toBe('Comfortabeler fietsen op de fiets die je al hebt.');
  });

  it('an enquiry offering: its editorial duration, no booking service', () => {
    const card = resolved('coaching');
    expect(card.status).toBe('enquiry');
    expect(card.bookingServiceSlugs).toEqual([]);
    expect(card.durationLabel).toBe('Traject en opvolging in overleg');
  });

  it('nobody offers it: temporarily unavailable, never routed to another service', () => {
    const card = resolved('bikefit-huidige-fiets', new Set());
    expect(card.status).toBe('unavailable');
    expect(card.bookingServiceSlugs).toEqual([]);
  });

  it('falls back to the intro when the summary is empty', () => {
    const entry = DEFAULT_OFFERS[0];
    const card = offerFromOffering(
      { id: 'x', content: { ...entry.content, summary: '' } },
      resolveOffering({
        settings: {
          isListed: true,
          bookingMode: 'enquiry',
          variantMode: 'single',
          variants: [{ audience: 'all', serviceId: null, priceCents: null }],
        },
        source: 'stored',
        services: SERVICES,
        bookableServiceIds: new Set(),
      }),
    );
    expect(card.summary).toBe(entry.content.intro);
  });
});

describe('sorting and grouping', () => {
  it('orders Bikefit before Begeleiding before Overige, then by sortOrder, then title', () => {
    const sorted = sortOffers([
      offer({ slug: 'z', category: 'begeleiding', sortOrder: 10 }),
      offer({ slug: 'b', category: 'bikefit', sortOrder: 20 }),
      offer({ slug: 'o', category: 'overige', sortOrder: 0 }),
      offer({ slug: 'a', category: 'bikefit', sortOrder: 20 }),
      offer({ slug: 'c', category: 'bikefit', sortOrder: 10 }),
    ]);
    expect(sorted.map((entry) => entry.slug)).toEqual(['c', 'a', 'b', 'z', 'o']);
    expect(offersInCategory(sorted, 'begeleiding').map((entry) => entry.slug)).toEqual(['z']);
  });
});

describe('resolveBookingSelection (service preselection)', () => {
  const services = [
    { id: 'svc-adult', slug: 'volwassenenfit' },
    { id: 'svc-youth', slug: 'jeugdfit' },
    { id: 'svc-home', slug: 'fit-aan-huis' },
  ];
  const offers = [
    offer({
      slug: 'bikefit-huidige-fiets',
      title: 'Bikefit – huidige fiets',
      bookingServiceSlugs: ['volwassenenfit', 'jeugdfit'],
    }),
    offer({
      slug: 'voetanalyse',
      title: 'Voetanalyse',
      bookingServiceSlugs: ['voetanalyse-dienst'],
    }),
    offer({ slug: 'lactaattest', title: 'Lactaattest', status: 'enquiry' }),
    offer({ slug: 'zadelanalyse', title: 'Zadelanalyse', status: 'unavailable' }),
    offer({
      slug: 'jeugdfit',
      title: 'Een aanbod met de naam van een dienst',
      bookingServiceSlugs: ['jeugdfit'],
    }),
  ];

  it('without a parameter: the normal widget', () => {
    expect(resolveBookingSelection({ requested: null, offers, services })).toEqual({
      kind: 'none',
    });
  });

  it('an offer linked to several services narrows to them, in the offer order', () => {
    expect(
      resolveBookingSelection({ requested: 'bikefit-huidige-fiets', offers, services }),
    ).toEqual({
      kind: 'offer',
      offer: {
        slug: 'bikefit-huidige-fiets',
        title: 'Bikefit – huidige fiets',
        path: '/aanbod/bikefit-huidige-fiets',
        status: 'bookable',
      },
      serviceIds: ['svc-adult', 'svc-youth'],
      initialServiceId: null,
    });
  });

  it('an offer whose service is not bookable keeps the offer and offers NO other service', () => {
    const selection = resolveBookingSelection({ requested: 'voetanalyse', offers, services });
    expect(selection).toMatchObject({ kind: 'offer', serviceIds: [], initialServiceId: null });
  });

  it('enquiry and unavailable offers carry their status, so the page can say why', () => {
    expect(resolveBookingSelection({ requested: 'lactaattest', offers, services })).toMatchObject({
      kind: 'offer',
      offer: { status: 'enquiry' },
      serviceIds: [],
    });
    expect(resolveBookingSelection({ requested: 'zadelanalyse', offers, services })).toMatchObject({
      kind: 'offer',
      offer: { status: 'unavailable' },
    });
  });

  it('a booking-service slug (legacy link) preselects that service', () => {
    expect(resolveBookingSelection({ requested: 'fit-aan-huis', offers, services })).toEqual({
      kind: 'service',
      serviceId: 'svc-home',
    });
  });

  it('an unknown slug is reported, not mapped to a default', () => {
    expect(resolveBookingSelection({ requested: 'onbekend', offers, services })).toEqual({
      kind: 'unknown',
      requested: 'onbekend',
    });
  });

  it('an offer slug wins over a booking-service slug with the same name', () => {
    const selection = resolveBookingSelection({ requested: 'jeugdfit', offers, services });
    expect(selection.kind).toBe('offer');
    if (selection.kind === 'offer') expect(selection.initialServiceId).toBe('svc-youth');
  });
});

describe('default offerings (what cms:bootstrap writes)', () => {
  it('has the seven offers (five Bikefit, two Begeleiding) plus three hidden legacy services, unique slugs', () => {
    expect(DEFAULT_OFFERS).toHaveLength(7);
    expect(DEFAULT_OFFERS.filter((entry) => entry.content.category === 'bikefit')).toHaveLength(5);
    expect(DEFAULT_OFFERS.filter((entry) => entry.content.category === 'begeleiding')).toHaveLength(
      2,
    );
    expect(LEGACY_OFFERINGS.map((entry) => entry.content.slug)).toEqual([
      'gezinspakket',
      'fit-aan-huis',
      'inspanningstest',
    ]);
    expect(
      LEGACY_OFFERINGS.every((entry) => !entry.isListed && entry.bookingMode === 'direct'),
    ).toBe(true);
    const slugs = DEFAULT_OFFERINGS.map((entry) => entry.content.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('every offer carries the default CTA, no price and an honest duration', () => {
    for (const entry of DEFAULT_OFFERS) {
      expect(entry.content.ctaLabel).toBe('');
      expect(entry.content.duration).toMatch(/in overleg$/);
      expect(entry.content.title).not.toMatch(/€/);
      expect(entry.isListed).toBe(true);
    }
    expect(OFFER_CTA_LABEL).toBe('Boek een afspraak voor deze dienst');
    expect(GIFT_VOUCHER_PRICE_LABEL).toBe('Bedrag naar keuze');
  });

  it('only links offerings to booking services that exist, each service at most once', () => {
    const known = new Set(DEFAULT_SERVICES.map((service) => service.slug));
    const used: string[] = [];
    for (const entry of DEFAULT_OFFERINGS) {
      for (const variant of entry.variants) {
        if (!variant.serviceSlug) continue;
        expect(known.has(variant.serviceSlug), variant.serviceSlug).toBe(true);
        used.push(variant.serviceSlug);
      }
    }
    expect(new Set(used).size).toBe(used.length);
    expect(used.sort()).toEqual([...known].sort());
  });

  it('the current-bike fit is booked directly as Volwassene + Jeugd; the other six are asked for', () => {
    const current = DEFAULT_OFFERS.find((entry) => entry.content.slug === 'bikefit-huidige-fiets')!;
    expect(current.bookingMode).toBe('direct');
    expect(current.variantMode).toBe('audience');
    expect(current.variants.map((v) => `${v.audience}:${v.serviceSlug}`)).toEqual([
      'adult:volwassenenfit',
      'youth:jeugdfit',
    ]);
    expect(DEFAULT_OFFERS.filter((entry) => entry.bookingMode === 'enquiry')).toHaveLength(6);
  });
});

describe("groupBookingChoices (the widget's first step)", () => {
  const services = [
    { id: 'svc-adult', slug: 'volwassenenfit' },
    { id: 'svc-youth', slug: 'jeugdfit' },
    { id: 'svc-family', slug: 'gezinspakket' },
    { id: 'svc-home', slug: 'fit-aan-huis' },
  ];
  const bikefit = offer({
    slug: 'bikefit-huidige-fiets',
    title: 'Bikefit – huidige fiets',
    category: 'bikefit',
    sortOrder: 20,
    bookingServiceSlugs: ['volwassenenfit', 'jeugdfit'],
  });

  it('shows "Bikefit – huidige fiets" once, Volwassene and Jeugd under it, the rest directly', () => {
    expect(groupBookingChoices({ offers: [bikefit], services })).toEqual([
      {
        kind: 'offer',
        offer: {
          slug: 'bikefit-huidige-fiets',
          title: 'Bikefit – huidige fiets',
          path: '/aanbod/bikefit-huidige-fiets',
        },
        serviceIds: ['svc-adult', 'svc-youth'],
      },
      { kind: 'service', serviceId: 'svc-family' },
      { kind: 'service', serviceId: 'svc-home' },
    ]);
  });

  it('without offers (catalogue unavailable) the widget is the flat list it was', () => {
    expect(groupBookingChoices({ offers: [], services }).map((choice) => choice.kind)).toEqual([
      'service',
      'service',
      'service',
      'service',
    ]);
  });

  it('a service two offers link belongs to the first offer in catalogue order only', () => {
    const other = offer({
      slug: 'ander',
      title: 'Ander',
      category: 'begeleiding',
      sortOrder: 0,
      bookingServiceSlugs: ['jeugdfit', 'gezinspakket'],
    });
    const choices = groupBookingChoices({ offers: [other, bikefit], services });
    expect(choices).toEqual([
      expect.objectContaining({ kind: 'offer', serviceIds: ['svc-adult', 'svc-youth'] }),
      expect.objectContaining({ kind: 'offer', serviceIds: ['svc-family'] }),
      { kind: 'service', serviceId: 'svc-home' },
    ]);
  });

  it('skips unbookable slugs; an offer with none adds nothing', () => {
    const ghost = offer({ slug: 'spook', bookingServiceSlugs: ['bestaat-niet'] });
    expect(
      groupBookingChoices({ offers: [ghost], services }).every((c) => c.kind === 'service'),
    ).toBe(true);
  });

  it("labels a choice with the catalogue's choice label, else the service name", () => {
    expect(bookingChoiceLabel({ name: 'Volwassenenfit', choiceLabel: 'Volwassene' })).toBe(
      'Volwassene',
    );
    expect(bookingChoiceLabel({ name: 'Gezinspakket', choiceLabel: '  ' })).toBe('Gezinspakket');
  });
});
