import type { CmsLocation } from '@/db/cms-schema';

/**
 * Small display helpers shared by the booking modules, e-mails and admin UI.
 * Plain module (type-only imports).
 */

export type LocationLike = Pick<
  CmsLocation,
  'name' | 'kind' | 'addressLines' | 'postalCode' | 'city' | 'country'
>;

export type FormattedLocation = {
  /** e.g. "De Bikefit Studio, Ninove" or "Bij jou thuis". */
  label: string;
  /** Address lines only (may be empty when the address is unknown). */
  addressLines: string[];
  /** Name + address on one line, for calendar events. */
  singleLine: string;
};

export function formatLocation(location: LocationLike | null | undefined): FormattedLocation {
  if (!location) return { label: '', addressLines: [], singleLine: '' };
  if (location.kind === 'customer') {
    return { label: location.name || 'Bij jou thuis', addressLines: [], singleLine: location.name };
  }
  const cityLine = [location.postalCode, location.city].filter(Boolean).join(' ');
  const addressLines = [...(location.addressLines ?? []).filter(Boolean), cityLine].filter(Boolean);
  const singleLine = [location.name, ...addressLines].filter(Boolean).join(', ');
  return { label: location.name, addressLines, singleLine };
}

/**
 * `4500` → `'€ 45,00'` (nl-BE). Booking prices are cents; the legacy webshop's
 * decimal-euro prices use `formatPrice` in `src/lib/format.ts` instead.
 */
export function formatPrice(priceCents: number | null | undefined): string {
  if (priceCents == null) return '';
  return new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' }).format(
    priceCents / 100,
  );
}

/** `90` → `'1 u 30 min'`, `60` → `'1 uur'`, `45` → `'45 min'`. */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return h === 1 ? '1 uur' : `${h} uur`;
  return `${h} u ${m} min`;
}

/**
 * URL-safe slug from a Dutch name: `'Fit aan huis'` → `'fit-aan-huis'`. At most
 * 80 characters; hyphens are trimmed AFTER the cut, so a truncated slug never
 * ends in `-` (the service form would refuse it).
 */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 80)
    .replace(/^-+|-+$/g, '');
}
