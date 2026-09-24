/**
 * Initial booking data written by `scripts/cms-bootstrap.mts` (idempotent) and
 * used by `scripts/cms-seed-booking.mts`. Plain data, no I/O.
 *
 * Decided by Toshoni (24 Sep 2026): five services, prices hidden. Descriptions
 * reuse the site's existing copy (block registry defaults); nothing is invented
 * beyond the durations given.
 */

export const DEFAULT_STUDIO_LOCATION = {
  name: 'De Bikefit Studio, Ninove',
  kind: 'studio' as const,
  // The street address is not known yet (see docs/cms-architecture.md §13).
  addressLines: [] as string[],
  postalCode: '',
  city: 'Ninove',
  country: 'BE',
  notes: null,
  isDefault: true,
  isActive: true,
  sortOrder: 0,
};

/** Where "Fit aan huis" happens: the customer's address, asked in the booking form. */
export const CUSTOMER_LOCATION = {
  name: 'Bij jou thuis',
  kind: 'customer' as const,
  addressLines: [] as string[],
  postalCode: '',
  city: '',
  country: 'BE',
  notes: 'Het adres vult de klant in bij het boeken.',
  isDefault: false,
  isActive: true,
  sortOrder: 1,
};

export type DefaultService = {
  slug: string;
  name: string;
  description: string;
  durationMinutes: number;
  requiresGuardian: boolean;
  /** `'customer'` → linked to {@link CUSTOMER_LOCATION}; `null` → provider default. */
  location: 'customer' | null;
  sortOrder: number;
};

export const DEFAULT_SERVICES: DefaultService[] = [
  {
    slug: 'volwassenenfit',
    name: 'Volwassenenfit',
    description:
      'De standaard bikefit. Reken op 90 minuten; complexe gevallen, eerste keren of fits na een blessure kunnen tot twee uur duren.',
    durationMinutes: 90,
    requiresGuardian: false,
    location: null,
    sortOrder: 0,
  },
  {
    slug: 'jeugdfit',
    name: 'Jeugdfit',
    description:
      'Korter, ongeveer 60 minuten, en afgestemd op een lichaam in groei. Betaalbaar, duidelijk, op hun tempo.',
    durationMinutes: 60,
    requiresGuardian: true,
    location: null,
    sortOrder: 1,
  },
  {
    slug: 'gezinspakket',
    name: 'Gezinspakket',
    description:
      'Mama, papa, kinderen — één sessie in de studio, alle fietsen gepast. Iedereen rijdt beter naar huis.',
    durationMinutes: 150,
    requiresGuardian: false,
    location: null,
    sortOrder: 2,
  },
  {
    slug: 'fit-aan-huis',
    name: 'Fit aan huis',
    description: 'Voor groepen, clubs en gezinnen komen we op locatie.',
    durationMinutes: 120,
    requiresGuardian: false,
    location: 'customer',
    sortOrder: 3,
  },
  {
    slug: 'inspanningstest',
    name: 'Inspanningstest',
    description: '',
    durationMinutes: 60,
    requiresGuardian: false,
    location: null,
    sortOrder: 4,
  },
];

/** Mon–Fri 09:00–18:00, Sat 09:00–13:00 (weekday 0 = Sunday). */
export const DEFAULT_PROVIDER_HOURS = [
  ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 9 * 60, endMinute: 18 * 60 })),
  { weekday: 6, startMinute: 9 * 60, endMinute: 13 * 60 },
];
