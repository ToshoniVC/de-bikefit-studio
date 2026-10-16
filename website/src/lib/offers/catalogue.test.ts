import { describe, expect, it } from 'vitest';
import { DEFAULT_SERVICES } from '@/lib/booking/defaults';
import {
  bookingChoiceLabel,
  GIFT_VOUCHER_PRICE_LABEL,
  groupBookingChoices,
  linkedOfferDurationLabel,
  OFFER_CTA_LABEL,
  OFFER_PRICE_FALLBACK,
  offerBookingHref,
  offerFromPage,
  offerPagePath,
  offerPriceLabel,
  offerSlugFromPageSlug,
  offersInCategory,
  parseServiceParam,
  resolveBookingSelection,
  showsOfferPrices,
  sortOffers,
  type CatalogueOffer,
} from './catalogue';
import { BOOKING_RECONCILIATION, DEFAULT_OFFERS, offerBlockData } from './defaults';

const emptyImage = { mediaId: null, url: null, alt: '', decorative: false };

function offer(partial: Partial<CatalogueOffer> & { slug: string }): CatalogueOffer {
  return {
    kind: 'service',
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

describe('offer paths', () => {
  it('maps offer slugs to /aanbod/<slug> and back', () => {
    expect(offerPagePath('voetanalyse')).toBe('/aanbod/voetanalyse');
    expect(offerSlugFromPageSlug('aanbod/voetanalyse')).toBe('voetanalyse');
    expect(offerSlugFromPageSlug('/aanbod/voetanalyse/')).toBe('voetanalyse');
  });

  it('rejects pages outside /aanbod and nested or malformed paths', () => {
    expect(offerSlugFromPageSlug('aanbod')).toBeNull();
    expect(offerSlugFromPageSlug('bikefit')).toBeNull();
    expect(offerSlugFromPageSlug('aanbod/a/b')).toBeNull();
    expect(offerSlugFromPageSlug('aanbodx/voetanalyse')).toBeNull();
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

describe('parseServiceParam (query-string boundary)', () => {
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

describe('offerPriceLabel', () => {
  it('does not leak independent editorial amounts for a service-linked offer', () => {
    const bookingServiceSlugs = ['volwassenenfit', 'jeugdfit'];
    expect(offerPriceLabel({ priceCents: 12000, priceLabel: '', bookingServiceSlugs })).toBe(
      'Prijs op aanvraag',
    );
    expect(
      offerPriceLabel({ priceCents: 12000, priceLabel: 'vanaf € 120', bookingServiceSlugs }),
    ).toBe('Prijs op aanvraag');
  });

  it('shows "Prijs op aanvraag" while nothing is confirmed, never € 0', () => {
    expect(offerPriceLabel({ priceCents: null, priceLabel: '' })).toBe('Prijs op aanvraag');
    expect(offerPriceLabel({ priceCents: null, priceLabel: '   ' })).toBe('Prijs op aanvraag');
  });

  it('formats a confirmed amount in cents and lets free text win', () => {
    expect(offerPriceLabel({ priceCents: 12000, priceLabel: '' })).toMatch(/120,00/);
    expect(offerPriceLabel({ priceCents: 12000, priceLabel: 'vanaf € 120' })).toBe('vanaf € 120');
  });

  it('never lets the "Prijs op aanvraag" placeholder hide a confirmed amount', () => {
    expect(offerPriceLabel({ priceCents: null, priceLabel: 'Prijs op aanvraag' })).toBe(
      'Prijs op aanvraag',
    );
    expect(offerPriceLabel({ priceCents: 12000, priceLabel: 'Prijs op aanvraag' })).toMatch(
      /120,00/,
    );
    expect(offerPriceLabel({ priceCents: 12000, priceLabel: ' prijs op aanvraag ' })).toMatch(
      /120,00/,
    );
  });
});

describe('linkedOfferDurationLabel', () => {
  it('names the linked CMS variants in offer order and follows changed service durations', () => {
    const services = [
      { slug: 'jeugdfit', name: 'Jeugdfit', choiceLabel: 'Jeugd', durationMinutes: 75 },
      {
        slug: 'volwassenenfit',
        name: 'Volwassenenfit',
        choiceLabel: 'Volwassene',
        durationMinutes: 90,
      },
    ];
    expect(linkedOfferDurationLabel(['volwassenenfit', 'jeugdfit'], services)).toBe(
      'Volwassene: 1 u 30 min · Jeugd: 1 u 15 min',
    );
    services[0].durationMinutes = 60;
    expect(linkedOfferDurationLabel(['volwassenenfit', 'jeugdfit'], services)).toBe(
      'Volwassene: 1 u 30 min · Jeugd: 1 uur',
    );
  });

  it('omits missing and repeated services; never invents a linked duration', () => {
    const services = [{ slug: 'jeugdfit', name: 'Jeugdfit', choiceLabel: '', durationMinutes: 60 }];
    expect(linkedOfferDurationLabel(['missing', ' jeugdfit ', 'jeugdfit'], services)).toBe(
      'Jeugdfit: 1 uur',
    );
    expect(linkedOfferDurationLabel(['missing'], services)).toBeNull();
  });
});

describe('offerFromPage', () => {
  const blocks = [
    { type: 'hero', data: {} },
    {
      type: 'offer',
      data: {
        ...offerBlockData(DEFAULT_OFFERS[0]),
        image: emptyImage,
      },
    },
  ];

  it('derives a catalogue entry from an offer page', () => {
    const entry = offerFromPage({ slug: 'aanbod/bikefit-nieuwe-fiets', blocks });
    expect(entry).toMatchObject({
      slug: 'bikefit-nieuwe-fiets',
      path: '/aanbod/bikefit-nieuwe-fiets',
      category: 'bikefit',
      title: 'Bikefit – aankoop nieuwe fiets',
      priceLabel: 'Prijs op aanvraag',
      durationLabel: 'Duur in overleg',
    });
  });

  it('keeps a linked Bikefit catalogue card at request-price despite editorial cents', () => {
    const current = DEFAULT_OFFERS.find((entry) => entry.slug === 'bikefit-huidige-fiets');
    expect(current).toBeDefined();
    const entry = offerFromPage({
      slug: 'aanbod/bikefit-huidige-fiets',
      blocks: [
        {
          type: 'offer',
          data: { ...offerBlockData(current!), priceCents: 12000, priceLabel: 'vanaf € 120' },
        },
      ],
    });
    expect(entry?.priceLabel).toBe('Prijs op aanvraag');
  });

  it('falls back to the intro when the summary is empty', () => {
    const entry = offerFromPage({
      slug: 'aanbod/x',
      blocks: [{ type: 'offer', data: { ...blocks[1].data, summary: '' } }],
    });
    expect(entry?.summary).toBe(DEFAULT_OFFERS[0].intro);
  });

  it('ignores pages outside /aanbod and pages without an offer block', () => {
    expect(offerFromPage({ slug: 'bikefit', blocks })).toBeNull();
    expect(offerFromPage({ slug: 'aanbod/x', blocks: [blocks[0]] })).toBeNull();
  });

  it('lists the gift voucher page under Overige, amount of choice, never bookable', () => {
    const voucher = {
      type: 'giftVoucher',
      data: { sortOrder: 0, title: 'Cadeaubon', summary: '', intro: 'Schenk fietsplezier.' },
    };
    const entry = offerFromPage({ slug: 'aanbod/cadeaubon', blocks: [voucher] });
    expect(entry).toMatchObject({
      kind: 'giftVoucher',
      slug: 'cadeaubon',
      path: '/aanbod/cadeaubon',
      category: 'overige',
      summary: 'Schenk fietsplezier.',
      priceLabel: GIFT_VOUCHER_PRICE_LABEL,
      bookingServiceSlugs: [],
    });
    // An offer block on the same page still wins.
    expect(offerFromPage({ slug: 'aanbod/x', blocks: [voucher, blocks[1]] })?.kind).toBe('service');
  });
});

describe('sorting and grouping', () => {
  it('orders Bikefit before Begeleiding, then by sortOrder', () => {
    const sorted = sortOffers([
      offer({ slug: 'coaching', category: 'begeleiding', sortOrder: 20 }),
      offer({ slug: 'zadel', category: 'bikefit', sortOrder: 40 }),
      offer({ slug: 'lactaat', category: 'begeleiding', sortOrder: 10 }),
      offer({ slug: 'nieuw', category: 'bikefit', sortOrder: 10 }),
    ]);
    expect(sorted.map((entry) => entry.slug)).toEqual(['nieuw', 'zadel', 'lactaat', 'coaching']);
    const withOther = sortOffers([
      offer({ slug: 'bon', category: 'overige', kind: 'giftVoucher' }),
      ...sorted,
    ]);
    expect(withOther.map((entry) => entry.slug).at(-1)).toBe('bon');
    expect(offersInCategory(sorted, 'begeleiding').map((entry) => entry.slug)).toEqual([
      'lactaat',
      'coaching',
    ]);
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
    offer({ slug: 'lactaattest', title: 'Lactaattest', category: 'begeleiding' }),
    offer({ slug: 'one', title: 'Eén dienst', bookingServiceSlugs: ['fit-aan-huis'] }),
    offer({ slug: 'gone', title: 'Weg', bookingServiceSlugs: ['inspanningstest'] }),
  ];

  it('without a parameter: the normal widget', () => {
    expect(resolveBookingSelection({ requested: null, offers, services })).toEqual({
      kind: 'none',
    });
  });

  it('an offer linked to several services narrows to them, in the offer order', () => {
    const result = resolveBookingSelection({
      requested: 'bikefit-huidige-fiets',
      offers,
      services,
    });
    expect(result).toEqual({
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

  it('an offer linked to one service preselects it', () => {
    const result = resolveBookingSelection({ requested: 'one', offers, services });
    expect(result).toMatchObject({
      kind: 'offer',
      serviceIds: ['svc-home'],
      initialServiceId: 'svc-home',
    });
  });

  it('an offer without a bookable service keeps the offer and offers NO other service', () => {
    for (const requested of ['lactaattest', 'gone']) {
      const result = resolveBookingSelection({ requested, offers, services });
      expect(result.kind).toBe('offer');
      if (result.kind === 'offer') {
        expect(result.serviceIds).toEqual([]);
        expect(result.initialServiceId).toBeNull();
      }
    }
  });

  it('a booking-service slug (legacy link) preselects that service', () => {
    expect(resolveBookingSelection({ requested: 'jeugdfit', offers, services })).toEqual({
      kind: 'service',
      serviceId: 'svc-youth',
    });
  });

  it('an unknown slug is reported, not mapped to a default', () => {
    expect(resolveBookingSelection({ requested: 'iets-anders', offers, services })).toEqual({
      kind: 'unknown',
      requested: 'iets-anders',
    });
  });

  it('an offer slug wins over a booking-service slug with the same name', () => {
    const clash = [...offers, offer({ slug: 'jeugdfit', title: 'Jeugd (aanbod)' })];
    expect(resolveBookingSelection({ requested: 'jeugdfit', offers: clash, services }).kind).toBe(
      'offer',
    );
  });

  it('never turns the gift voucher into a booking or an enquiry', () => {
    const withVoucher = [
      ...offers,
      offer({ slug: 'cadeaubon', category: 'overige', kind: 'giftVoucher' }),
    ];
    expect(
      resolveBookingSelection({ requested: 'cadeaubon', offers: withVoucher, services }),
    ).toEqual({ kind: 'unknown', requested: 'cadeaubon' });
  });
});

describe('default offers and booking reconciliation', () => {
  const legacySlugs = DEFAULT_SERVICES.map((service) => service.slug);

  it('has the seven offers: five Bikefit, two Begeleiding, unique slugs', () => {
    expect(DEFAULT_OFFERS).toHaveLength(7);
    expect(DEFAULT_OFFERS.filter((entry) => entry.category === 'bikefit')).toHaveLength(5);
    expect(DEFAULT_OFFERS.filter((entry) => entry.category === 'begeleiding')).toHaveLength(2);
    expect(new Set(DEFAULT_OFFERS.map((entry) => entry.slug)).size).toBe(7);
    expect(DEFAULT_OFFERS.map((entry) => entry.title)).toEqual([
      'Bikefit – aankoop nieuwe fiets',
      'Bikefit – huidige fiets',
      'Voetanalyse',
      'Zadelanalyse',
      'Afstellen schoenplaatjes',
      'Lactaattest',
      'Coaching',
    ]);
  });

  it('every offer block carries the exact CTA, no price and an honest duration', () => {
    for (const entry of DEFAULT_OFFERS) {
      const data = offerBlockData(entry);
      expect(data.ctaLabel).toBe(OFFER_CTA_LABEL);
      expect(data.priceCents).toBeNull();
      expect(data.priceLabel).toBe(OFFER_PRICE_FALLBACK);
      expect(String(data.duration)).toMatch(/in overleg$/);
      expect(JSON.stringify(data)).not.toMatch(/€|\b\d+\s*(min|minuten|uur)\b/);
    }
    expect(DEFAULT_OFFERS.find((entry) => entry.slug === 'coaching')?.duration).toBe(
      'Traject en opvolging in overleg',
    );
  });

  it('only links offers to booking services that exist', () => {
    for (const entry of DEFAULT_OFFERS) {
      for (const slug of entry.bookingServiceSlugs) expect(legacySlugs).toContain(slug);
    }
  });

  it('records a decision for every existing booking service, matching the offers', () => {
    expect(BOOKING_RECONCILIATION.map((row) => row.serviceSlug).sort()).toEqual(
      [...legacySlugs].sort(),
    );
    for (const row of BOOKING_RECONCILIATION) {
      const linkedFrom = DEFAULT_OFFERS.filter((entry) =>
        entry.bookingServiceSlugs.includes(row.serviceSlug),
      ).map((entry) => entry.slug);
      expect(linkedFrom).toEqual(row.offerSlugs);
      expect(row.decision === 'linked').toBe(row.offerSlugs.length > 0);
    }
  });

  it('keeps the real scheduling length on the linked services (no new numbers)', () => {
    const adult = DEFAULT_SERVICES.find((service) => service.slug === 'volwassenenfit');
    const youth = DEFAULT_SERVICES.find((service) => service.slug === 'jeugdfit');
    expect(adult?.durationMinutes).toBe(90);
    expect(youth?.durationMinutes).toBe(60);
    expect(youth?.requiresGuardian).toBe(true);
  });
});

describe("groupBookingChoices (the widget's first step, 16 Oct 2026)", () => {
  // The five bootstrap services in their admin order, all bookable.
  const services = DEFAULT_SERVICES.map((service) => ({
    id: `id-${service.slug}`,
    slug: service.slug,
  }));
  const seeded = DEFAULT_OFFERS.map((entry) =>
    offer({
      slug: entry.slug,
      title: entry.title,
      category: entry.category,
      sortOrder: entry.sortOrder,
      bookingServiceSlugs: entry.bookingServiceSlugs,
    }),
  );

  it('shows "Bikefit – huidige fiets" once, Volwassene and Jeugd under it, the rest directly', () => {
    expect(groupBookingChoices({ offers: seeded, services })).toEqual([
      {
        kind: 'offer',
        offer: {
          slug: 'bikefit-huidige-fiets',
          title: 'Bikefit – huidige fiets',
          path: '/aanbod/bikefit-huidige-fiets',
        },
        serviceIds: ['id-volwassenenfit', 'id-jeugdfit'],
      },
      { kind: 'service', serviceId: 'id-gezinspakket' },
      { kind: 'service', serviceId: 'id-fit-aan-huis' },
      { kind: 'service', serviceId: 'id-inspanningstest' },
    ]);
  });

  it('never lists a linked service twice, and keeps every bookable service reachable', () => {
    const choices = groupBookingChoices({ offers: seeded, services });
    const ids = choices.flatMap((choice) =>
      choice.kind === 'service' ? [choice.serviceId] : choice.serviceIds,
    );
    expect([...ids].sort()).toEqual(services.map((service) => service.id).sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('without offers (catalogue unavailable) the widget is the flat list it was', () => {
    expect(groupBookingChoices({ offers: [], services })).toEqual(
      services.map((service) => ({ kind: 'service', serviceId: service.id })),
    );
  });

  it("takes the place of its first service and keeps the offer's own order", () => {
    const choices = groupBookingChoices({
      offers: [offer({ slug: 'combi', bookingServiceSlugs: ['inspanningstest', 'gezinspakket'] })],
      services,
    });
    expect(
      choices.map((choice) => (choice.kind === 'offer' ? choice.offer.slug : choice.serviceId)),
    ).toEqual(['id-volwassenenfit', 'id-jeugdfit', 'combi', 'id-fit-aan-huis']);
    expect(choices[2]).toMatchObject({ serviceIds: ['id-inspanningstest', 'id-gezinspakket'] });
  });

  it('skips unbookable slugs; an offer with none adds nothing (its page shows the contact prompt)', () => {
    const choices = groupBookingChoices({
      offers: [
        offer({ slug: 'lactaattest', bookingServiceSlugs: [] }),
        offer({ slug: 'kapot', bookingServiceSlugs: ['bestaat-niet'] }),
        offer({ slug: 'half', bookingServiceSlugs: ['bestaat-niet', ' jeugdfit '] }),
      ],
      services,
    });
    expect(choices.filter((choice) => choice.kind === 'offer')).toEqual([
      {
        kind: 'offer',
        offer: { slug: 'half', title: 'half', path: '/aanbod/half' },
        serviceIds: ['id-jeugdfit'],
      },
    ]);
  });

  it('a service two offers link belongs to the first offer in catalogue order only', () => {
    const choices = groupBookingChoices({
      offers: [
        offer({
          slug: 'later',
          sortOrder: 50,
          bookingServiceSlugs: ['volwassenenfit', 'gezinspakket'],
        }),
        offer({ slug: 'eerst', sortOrder: 10, bookingServiceSlugs: ['volwassenenfit'] }),
      ],
      services,
    });
    expect(choices.filter((choice) => choice.kind === 'offer')).toEqual([
      expect.objectContaining({
        offer: expect.objectContaining({ slug: 'eerst' }),
        serviceIds: ['id-volwassenenfit'],
      }),
      expect.objectContaining({
        offer: expect.objectContaining({ slug: 'later' }),
        serviceIds: ['id-gezinspakket'],
      }),
    ]);
  });

  it('ignores the gift voucher', () => {
    const choices = groupBookingChoices({
      offers: [
        offer({ slug: 'cadeaubon', kind: 'giftVoucher', bookingServiceSlugs: ['jeugdfit'] }),
      ],
      services,
    });
    expect(choices.every((choice) => choice.kind === 'service')).toBe(true);
  });

  it("labels a choice with the catalogue's choice label, else the service name", () => {
    expect(bookingChoiceLabel({ name: 'Jeugdfit', choiceLabel: 'Jeugd' })).toBe('Jeugd');
    expect(bookingChoiceLabel({ name: 'Jeugdfit', choiceLabel: '  ' })).toBe('Jeugdfit');
  });

  it('the bootstrap labels the two linked services Volwassene and Jeugd, nothing else', () => {
    expect(
      DEFAULT_SERVICES.filter((service) => service.choiceLabel).map((service) => [
        service.slug,
        service.choiceLabel,
      ]),
    ).toEqual([
      ['volwassenenfit', 'Volwassene'],
      ['jeugdfit', 'Jeugd'],
    ]);
  });
});
