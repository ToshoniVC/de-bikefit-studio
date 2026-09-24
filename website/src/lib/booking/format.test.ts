import { describe, expect, it } from 'vitest';
import { formatDuration, formatLocation, formatPrice, slugify } from './format';

/** Intl uses a no-break space between the euro sign and the amount. */
function plain(value: string): string {
  return value.replace(/\s/g, ' ');
}

/** The slug rule enforced by the service form (`src/lib/cms/actions/services.ts`). */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe('formatPrice', () => {
  it('formats cents as euros in nl-BE', () => {
    expect(plain(formatPrice(4500))).toBe('€ 45,00');
    expect(plain(formatPrice(1))).toBe('€ 0,01');
    expect(plain(formatPrice(123456))).toBe('€ 1.234,56');
  });

  it('shows zero as a price and an unknown price as an empty string', () => {
    expect(plain(formatPrice(0))).toBe('€ 0,00');
    expect(formatPrice(null)).toBe('');
    expect(formatPrice(undefined)).toBe('');
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates a Dutch name', () => {
    expect(slugify('Fit aan huis')).toBe('fit-aan-huis');
    expect(slugify('Volwassenenfit')).toBe('volwassenenfit');
  });

  it('strips accents and expands ligatures', () => {
    expect(slugify('Één keer Café Crème')).toBe('een-keer-cafe-creme');
    expect(slugify('Ĳsselmeer')).toBe('ijsselmeer');
  });

  it('collapses punctuation and trims leading and trailing hyphens', () => {
    expect(slugify('  --Jeugdfit (6–16 jaar)!! ')).toBe('jeugdfit-6-16-jaar');
    expect(slugify('Gezinspakket: mama & papa')).toBe('gezinspakket-mama-papa');
  });

  it('returns an empty string when nothing usable is left', () => {
    expect(slugify('')).toBe('');
    expect(slugify('!!! — ???')).toBe('');
  });

  it('caps the slug at 80 characters and keeps it valid for the service form', () => {
    const slug = slugify('a'.repeat(100));
    expect(slug).toHaveLength(80);
    expect(slug).toMatch(SLUG_PATTERN);
  });

  // Regression: the 80-character cut used to happen after the hyphen trim, so a
  // long name could end in "-" and the service form rejected its own slug.
  it('never ends a truncated slug in a hyphen', () => {
    const slug = slugify(`${'a'.repeat(79)} bikefit`);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug).toMatch(SLUG_PATTERN);
  });
});

describe('formatDuration', () => {
  it('writes minutes the Dutch way', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(60)).toBe('1 uur');
    expect(formatDuration(120)).toBe('2 uur');
    expect(formatDuration(90)).toBe('1 u 30 min');
  });
});

describe('formatLocation', () => {
  it('builds label, address lines and a single line for a studio', () => {
    expect(
      formatLocation({
        name: 'De Bikefit Studio',
        kind: 'studio',
        addressLines: ['Kerkstraat 1', ''],
        postalCode: '9400',
        city: 'Ninove',
        country: 'BE',
      }),
    ).toEqual({
      label: 'De Bikefit Studio',
      addressLines: ['Kerkstraat 1', '9400 Ninove'],
      singleLine: 'De Bikefit Studio, Kerkstraat 1, 9400 Ninove',
    });
  });

  it('never exposes an address for customer locations or a missing location', () => {
    const customer = {
      name: '',
      kind: 'customer' as const,
      addressLines: ['Geheim 1'],
      postalCode: '9400',
      city: 'Ninove',
      country: 'BE',
    };
    expect(formatLocation(customer)).toEqual({
      label: 'Bij jou thuis',
      addressLines: [],
      singleLine: '',
    });
    expect(formatLocation(null)).toEqual({ label: '', addressLines: [], singleLine: '' });
  });
});
