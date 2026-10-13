import { describe, expect, it } from 'vitest';
import { blockRegistry } from '@/lib/cms/blocks';
import { AANBOD_PAGES } from './aanbod';
import { retargetBookingCtas } from './booking-cta';
import { BOOKING_PATH, CALLOUT_BLOCK, CONTACT_BLOCK, PHONE_HREF, PHONE_LABEL } from './shared';

describe('booking CTA target', () => {
  it('no seed or block default sends "Boek je bikefit" to the phone or #contact', () => {
    const sources = {
      defaults: Object.values(blockRegistry).map((entry) => entry.defaultData),
      callout: CALLOUT_BLOCK,
      contact: CONTACT_BLOCK,
      aanbod: AANBOD_PAGES,
    };
    expect(retargetBookingCtas(sources).changes).toEqual([]);
    expect(JSON.stringify(sources)).toContain(
      `"label":"Boek je bikefit →","href":"${BOOKING_PATH}"`,
    );
  });

  it('retargets a dialling booking button and leaves the phone-number link dialling', () => {
    const block = {
      title: 'Comfort is een keuze. Maak ze.',
      primaryCta: { label: 'Boek je bikefit →', href: PHONE_HREF, external: false },
      secondaryCta: { label: PHONE_LABEL, href: PHONE_HREF, external: false },
      cards: [{ cta: { label: 'Boek je bikefit', href: '#contact', external: false } }],
    };
    const { data, changes } = retargetBookingCtas(block);
    expect(data).toEqual({
      ...block,
      primaryCta: { label: 'Boek je bikefit →', href: BOOKING_PATH, external: false },
      cards: [{ cta: { label: 'Boek je bikefit', href: BOOKING_PATH, external: false } }],
    });
    expect(changes.map((change) => [change.path, change.from])).toEqual([
      ['primaryCta', PHONE_HREF],
      ['cards[0].cta', '#contact'],
    ]);
    expect(block.primaryCta.href).toBe(PHONE_HREF);
  });

  it('leaves booking links an editor pointed elsewhere alone', () => {
    const block = { primaryCta: { label: 'Boek je bikefit →', href: '/aanbod', external: false } };
    expect(retargetBookingCtas(block)).toEqual({ data: block, changes: [] });
  });
});
