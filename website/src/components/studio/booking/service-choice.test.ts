import { describe, expect, it } from 'vitest';
import {
  choicesFor,
  offerOfService,
  serviceMeta,
  serviceSummary,
  startOpenOffer,
} from './service-choice';
import type { BookingChoice, BookingServiceOption } from './types';

function service(partial: Partial<BookingServiceOption> & { id: string }): BookingServiceOption {
  return {
    slug: partial.id,
    name: partial.id,
    choiceLabel: '',
    description: '',
    durationMinutes: 60,
    requiresGuardian: false,
    location: null,
    priceLabel: '',
    ...partial,
  };
}

const adult = service({
  id: 'volwassenenfit',
  name: 'Volwassenenfit',
  choiceLabel: 'Volwassene',
  durationMinutes: 90,
});
const youth = service({
  id: 'jeugdfit',
  name: 'Jeugdfit',
  choiceLabel: 'Jeugd',
  durationMinutes: 60,
  requiresGuardian: true,
});
const family = service({ id: 'gezinspakket', name: 'Gezinspakket', durationMinutes: 150 });

const bikefit: BookingChoice = {
  kind: 'offer',
  offer: {
    slug: 'bikefit-huidige-fiets',
    title: 'Bikefit – huidige fiets',
    path: '/aanbod/bikefit-huidige-fiets',
  },
  serviceIds: ['volwassenenfit', 'jeugdfit'],
};
const choices: BookingChoice[] = [bikefit, { kind: 'service', serviceId: 'gezinspakket' }];

describe('the service step as data', () => {
  it('falls back to one choice per service', () => {
    expect(choicesFor([adult, family], undefined)).toEqual([
      { kind: 'service', serviceId: 'volwassenenfit' },
      { kind: 'service', serviceId: 'gezinspakket' },
    ]);
    expect(choicesFor([adult], choices)).toEqual(choices);
  });

  it('finds the offer a service is chosen under', () => {
    expect(offerOfService(choices, 'jeugdfit')).toBe(bikefit);
    expect(offerOfService(choices, 'gezinspakket')).toBeNull();
    expect(offerOfService(choices, null)).toBeNull();
  });

  it('opens the offer of a preselected service, or the only offer (?dienst=<offer>)', () => {
    expect(startOpenOffer(choices, 'jeugdfit')).toBe('bikefit-huidige-fiets');
    expect(startOpenOffer(choices, null)).toBeNull();
    expect(startOpenOffer([bikefit], null)).toBe('bikefit-huidige-fiets');
    expect(startOpenOffer(choices, 'gezinspakket')).toBeNull();
  });

  it("shows each choice's own duration and price; no amount means Prijs op aanvraag under an offer", () => {
    expect(serviceMeta(adult, true)).toEqual(['90 minuten', 'Prijs op aanvraag']);
    expect(serviceMeta(youth, true)).toEqual([
      '60 minuten',
      'met ouder of voogd',
      'Prijs op aanvraag',
    ]);
    expect(serviceMeta({ ...youth, priceLabel: '€ 95,00' }, true)).toEqual([
      '60 minuten',
      'met ouder of voogd',
      '€ 95,00',
    ]);
    // A service on its own looks as before: no price line unless one is shown.
    expect(serviceMeta(family)).toEqual(['150 minuten']);
  });

  it('summarises the choice with the offer and the label of the booked service', () => {
    expect(serviceSummary(youth, offerOfService(choices, 'jeugdfit'))).toBe(
      'Bikefit – huidige fiets · Jeugd · 60 minuten · met ouder of voogd · Prijs op aanvraag',
    );
    expect(serviceSummary(adult, offerOfService(choices, 'volwassenenfit'))).toBe(
      'Bikefit – huidige fiets · Volwassene · 90 minuten · Prijs op aanvraag',
    );
    expect(serviceSummary(family, null)).toBe('Gezinspakket · 150 minuten');
    expect(serviceSummary(null, null)).toBe('');
  });
});
