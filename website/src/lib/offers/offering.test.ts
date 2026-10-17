import { describe, expect, it } from 'vitest';
import { DEFAULT_SERVICES } from '@/lib/booking/defaults';
import { formatPrice } from '@/lib/booking/format';
import { DEFAULT_OFFERS } from './defaults';
import {
  offeringBookingSlugs,
  offeringDurationLabel,
  offeringPriceLabel,
  resolveOffering,
  settingsFromRows,
  validateOfferingInput,
  withheldServiceIds,
  type OfferingServiceInfo,
  type OfferingSettings,
} from './offering';
import { deriveLegacyOffering, legacyFieldsOf } from './offering-legacy';

/** The five bootstrap services, as the offering code sees them. */
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

const ADULT = 'svc-volwassenenfit';
const YOUTH = 'svc-jeugdfit';

/** The legacy `offer` block of a seeded offer page (before 17 Oct 2026). */
function seeded(slug: string) {
  const offer = DEFAULT_OFFERS.find((entry) => entry.content.slug === slug);
  if (!offer) throw new Error(slug);
  return legacyFieldsOf({
    bookingServiceSlugs: offer.variants.map((variant) => variant.serviceSlug).filter(Boolean),
    priceCents: null,
    priceLabel: 'Prijs op aanvraag',
  });
}

const FACTS = {
  durationMinutes: 90,
  bufferAfterMinutes: null,
  locationId: null,
  requiresGuardian: false,
};

const audienceDirect: OfferingSettings = {
  isListed: true,
  bookingMode: 'direct',
  variantMode: 'audience',
  variants: [
    { audience: 'adult', serviceId: ADULT, priceCents: null },
    { audience: 'youth', serviceId: YOUTH, priceCents: null },
  ],
};

describe('validateOfferingInput (Beheer → Aanbod)', () => {
  it('accepts Volwassene/Jeugd booked directly, each its own service facts and price', () => {
    const youthFacts = { ...FACTS, durationMinutes: 60, requiresGuardian: true };
    const result = validateOfferingInput({
      ...audienceDirect,
      variants: [
        { audience: 'adult', serviceId: ADULT, priceCents: 15000, service: FACTS },
        { audience: 'youth', serviceId: YOUTH, priceCents: null, service: youthFacts },
      ],
    });
    expect(result).toEqual({
      ok: true,
      data: {
        settings: {
          ...audienceDirect,
          variants: [
            { audience: 'adult', serviceId: ADULT, priceCents: 15000 },
            { audience: 'youth', serviceId: YOUTH, priceCents: null },
          ],
        },
        services: { adult: FACTS, youth: youthFacts },
      },
    });
  });

  it('direct booking needs the service facts (a duration) for every variant', () => {
    const result = validateOfferingInput({
      ...audienceDirect,
      variants: [
        { audience: 'adult', serviceId: ADULT, priceCents: null, service: FACTS },
        { audience: 'youth', serviceId: null, priceCents: null, service: null },
      ],
    });
    expect(result).toEqual({
      ok: false,
      message: 'Vul voor Jeugd de duur in om het online te boeken.',
    });
    expect(
      validateOfferingInput({
        ...audienceDirect,
        variants: [
          {
            audience: 'adult',
            serviceId: ADULT,
            priceCents: null,
            service: { ...FACTS, durationMinutes: 3 },
          },
          { audience: 'youth', serviceId: YOUTH, priceCents: null, service: FACTS },
        ],
      }),
    ).toMatchObject({ ok: false, message: expect.stringContaining('minstens 5 minuten') });
  });

  it('an enquiry needs no service', () => {
    const result = validateOfferingInput({
      isListed: true,
      bookingMode: 'enquiry',
      variantMode: 'single',
      variants: [{ audience: 'all', serviceId: null, priceCents: 9900 }],
    });
    expect(result).toMatchObject({ ok: true, data: { services: { all: null } } });
  });

  it('refuses one service for both audiences, variants that do not match the mode, € 0 and junk', () => {
    expect(
      validateOfferingInput({
        ...audienceDirect,
        variants: [
          { audience: 'adult', serviceId: ADULT, priceCents: null, service: FACTS },
          { audience: 'youth', serviceId: ADULT, priceCents: null, service: FACTS },
        ],
      }),
    ).toMatchObject({ ok: false, message: expect.stringContaining('eigen dienst') });
    expect(validateOfferingInput({ ...audienceDirect, variantMode: 'single' })).toMatchObject({
      ok: false,
      message: 'De varianten passen niet bij de gekozen opdeling.',
    });
    expect(
      validateOfferingInput({
        isListed: true,
        bookingMode: 'enquiry',
        variantMode: 'single',
        variants: [{ audience: 'all', serviceId: null, priceCents: 0 }],
      }),
    ).toMatchObject({ ok: false, message: expect.stringContaining('€ 0') });
    expect(validateOfferingInput({ ...audienceDirect, bookingMode: 'maybe' }).ok).toBe(false);
    expect(validateOfferingInput(null).ok).toBe(false);
  });
});

describe('settingsFromRows (stored rows, read defensively)', () => {
  it('orders variants by the mode and fills a missing one with nothing', () => {
    expect(
      settingsFromRows({ isListed: false, bookingMode: 'direct', variantMode: 'audience' }, [
        { audience: 'youth', serviceId: YOUTH, priceCents: 9500 },
      ]),
    ).toEqual({
      isListed: false,
      bookingMode: 'direct',
      variantMode: 'audience',
      variants: [
        { audience: 'adult', serviceId: null, priceCents: null },
        { audience: 'youth', serviceId: YOUTH, priceCents: 9500 },
      ],
    });
  });

  it('reads unknown modes as the safe default and drops a non-positive price', () => {
    expect(
      settingsFromRows({ isListed: true, bookingMode: '??', variantMode: '??' }, [
        { audience: 'all', serviceId: ADULT, priceCents: 0 },
        { audience: 'adult', serviceId: YOUTH, priceCents: 100 },
      ]),
    ).toEqual({
      isListed: true,
      bookingMode: 'enquiry',
      variantMode: 'single',
      variants: [{ audience: 'all', serviceId: ADULT, priceCents: null }],
    });
  });
});

describe('deriveLegacyOffering (the settings an offer page had before Beheer → Aanbod)', () => {
  it('Bikefit – huidige fiets: booked directly, Volwassene = Volwassenenfit, Jeugd = Jeugdfit, no price', () => {
    expect(deriveLegacyOffering(seeded('bikefit-huidige-fiets'), SERVICES)).toEqual({
      settings: audienceDirect,
      exact: true,
      notes: [],
    });
  });

  it('every other seeded offer is asked for, one option, "Prijs op aanvraag", exactly', () => {
    for (const offer of DEFAULT_OFFERS.filter((entry) => entry.bookingMode === 'enquiry')) {
      expect(
        deriveLegacyOffering(seeded(offer.content.slug), SERVICES),
        offer.content.slug,
      ).toEqual({
        settings: {
          isListed: true,
          bookingMode: 'enquiry',
          variantMode: 'single',
          variants: [{ audience: 'all', serviceId: null, priceCents: null }],
        },
        exact: true,
        notes: [],
      });
    }
  });

  it('keeps an editorial amount of an unlinked offer, never a free-text label', () => {
    expect(
      deriveLegacyOffering({ bookingServiceSlugs: [], priceCents: 9900, priceLabel: '' }, SERVICES)
        .settings.variants,
    ).toEqual([{ audience: 'all', serviceId: null, priceCents: 9900 }]);
    const label = deriveLegacyOffering(
      { bookingServiceSlugs: [], priceCents: 9900, priceLabel: 'vanaf € 120' },
      SERVICES,
    );
    expect(label.exact).toBe(false);
    expect(label.settings.variants[0].priceCents).toBeNull();
    expect(label.notes[0]).toContain('vanaf € 120');
  });

  it('never copies a service price onto the offer, and says so', () => {
    const priced = SERVICES.map((service) =>
      service.id === ADULT ? { ...service, priceCents: 15000, showPrice: true } : service,
    );
    const result = deriveLegacyOffering(seeded('bikefit-huidige-fiets'), priced);
    expect(result.settings.variants.every((variant) => variant.priceCents === null)).toBe(true);
    expect(result.exact).toBe(false);
    expect(result.notes[0]).toContain('Volwassenenfit');
  });

  it('one linked service is one option; unknown or unsplittable links are not exact', () => {
    expect(
      deriveLegacyOffering(
        { bookingServiceSlugs: ['gezinspakket'], priceCents: null, priceLabel: '' },
        SERVICES,
      ),
    ).toMatchObject({
      exact: true,
      settings: {
        bookingMode: 'direct',
        variantMode: 'single',
        variants: [{ audience: 'all', serviceId: 'svc-gezinspakket' }],
      },
    });
    const unknown = deriveLegacyOffering(
      { bookingServiceSlugs: ['bestaat-niet'], priceCents: null, priceLabel: '' },
      SERVICES,
    );
    expect(unknown).toMatchObject({ exact: false, settings: { bookingMode: 'enquiry' } });
    const two = deriveLegacyOffering(
      { bookingServiceSlugs: ['gezinspakket', 'fit-aan-huis'], priceCents: null, priceLabel: '' },
      SERVICES,
    );
    expect(two).toMatchObject({ exact: false, settings: { variantMode: 'single' } });
  });
});

describe('resolveOffering and its labels', () => {
  const bothOffered = new Set([ADULT, YOUTH]);

  it('bookable while ≥ 1 variant has an active provider; durations from the services', () => {
    const resolved = resolveOffering({
      settings: audienceDirect,
      source: 'stored',
      services: SERVICES,
      bookableServiceIds: bothOffered,
    });
    expect(resolved.status).toBe('bookable');
    expect(offeringDurationLabel(resolved, 'Duur in overleg')).toBe(
      'Volwassene: 1 u 30 min · Jeugd: 1 uur',
    );
    expect(offeringPriceLabel(resolved)).toBe('Prijs op aanvraag');
    expect(offeringBookingSlugs(resolved)).toEqual(['volwassenenfit', 'jeugdfit']);
  });

  it('unavailable (temporarily) when nobody offers any variant: no slugs, durations still shown', () => {
    const resolved = resolveOffering({
      settings: audienceDirect,
      source: 'stored',
      services: SERVICES,
      bookableServiceIds: new Set(),
    });
    expect(resolved.status).toBe('unavailable');
    expect(offeringBookingSlugs(resolved)).toEqual([]);
    expect(offeringDurationLabel(resolved, '')).toBe('Volwassene: 1 u 30 min · Jeugd: 1 uur');
  });

  it('a variant without a provider is left out of the booking, the other stays bookable', () => {
    const resolved = resolveOffering({
      settings: audienceDirect,
      source: 'stored',
      services: SERVICES,
      bookableServiceIds: new Set([ADULT]),
    });
    expect(resolved.status).toBe('bookable');
    expect(resolved.variants.map((variant) => variant.bookable)).toEqual([true, false]);
    expect(offeringBookingSlugs(resolved)).toEqual(['volwassenenfit']);
  });

  it('an inactive service is never bookable and has no duration', () => {
    const resolved = resolveOffering({
      settings: audienceDirect,
      source: 'stored',
      services: SERVICES.map((service) =>
        service.id === YOUTH ? { ...service, isActive: false } : service,
      ),
      bookableServiceIds: bothOffered,
    });
    expect(resolved.variants[1]).toMatchObject({ bookable: false, durationMinutes: null });
    expect(offeringDurationLabel(resolved, '')).toBe('Volwassene: 1 u 30 min');
  });

  it('enquiry: never bookable, editorial duration, own price; hidden: no slugs', () => {
    const enquiry = resolveOffering({
      settings: {
        isListed: true,
        bookingMode: 'enquiry',
        variantMode: 'single',
        variants: [{ audience: 'all', serviceId: ADULT, priceCents: 12000 }],
      },
      source: 'stored',
      services: SERVICES,
      bookableServiceIds: bothOffered,
    });
    expect(enquiry.status).toBe('enquiry');
    expect(enquiry.variants[0].bookable).toBe(false);
    expect(offeringDurationLabel(enquiry, 'Ongeveer 2 uur')).toBe('Ongeveer 2 uur');
    expect(offeringDurationLabel(enquiry, ' ')).toBe('Duur in overleg');
    expect(offeringPriceLabel(enquiry)).toBe(formatPrice(12000));

    const hidden = resolveOffering({
      settings: { ...audienceDirect, isListed: false },
      source: 'stored',
      services: SERVICES,
      bookableServiceIds: bothOffered,
    });
    expect(hidden.status).toBe('bookable');
    expect(offeringBookingSlugs(hidden)).toEqual([]);
  });

  it('prices per variant, never invented', () => {
    const resolved = resolveOffering({
      settings: {
        ...audienceDirect,
        variants: [
          { audience: 'adult', serviceId: ADULT, priceCents: 15000 },
          { audience: 'youth', serviceId: YOUTH, priceCents: null },
        ],
      },
      source: 'stored',
      services: SERVICES,
      bookableServiceIds: bothOffered,
    });
    expect(offeringPriceLabel(resolved)).toBe(
      `Volwassene ${formatPrice(15000)} · Jeugd op aanvraag`,
    );
  });
});

describe('withheldServiceIds (a variant is booked through its offering only)', () => {
  const enquiryWithService: OfferingSettings = {
    isListed: true,
    bookingMode: 'enquiry',
    variantMode: 'single',
    variants: [{ audience: 'all', serviceId: 'svc-gezinspakket', priceCents: null }],
  };

  it('holds back the services of hidden, enquiry and invisible offerings', () => {
    expect(
      withheldServiceIds([
        { visible: false, settings: audienceDirect },
        { visible: true, settings: enquiryWithService },
      ]),
    ).toEqual(new Set([ADULT, YOUTH, 'svc-gezinspakket']));
  });

  it('a shown, directly booked offering releases its services, even if another holds them', () => {
    expect(
      withheldServiceIds([
        { visible: true, settings: audienceDirect },
        { visible: false, settings: audienceDirect },
      ]),
    ).toEqual(new Set());
  });

  it('services no offering uses are never held back', () => {
    expect(withheldServiceIds([])).toEqual(new Set());
  });
});
