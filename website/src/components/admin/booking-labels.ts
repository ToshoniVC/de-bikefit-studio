/**
 * Dutch labels and tiny pure helpers shared by the booking admin screens.
 * Client-safe: no database, no `server-only` imports.
 */

import type {
  CmsAvailabilityExceptionKind,
  CmsBookingStatus,
  CmsGoogleSyncStatus,
  CmsLocationKind,
} from '@/db/cms-schema';

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive';

export const BOOKING_STATUS_LABELS: Record<CmsBookingStatus, string> = {
  confirmed: 'Bevestigd',
  cancelled: 'Geannuleerd',
  completed: 'Afgerond',
  no_show: 'Niet verschenen',
};

/**
 * On the studio palette (see `tones.ts`): confirmed = the burgundy accent,
 * cancelled = muted bone, completed = mauve (`success` + `badgeTone`),
 * no-show = red.
 */
export const BOOKING_STATUS_VARIANTS: Record<CmsBookingStatus, BadgeVariant> = {
  confirmed: 'default',
  cancelled: 'secondary',
  completed: 'success',
  no_show: 'destructive',
};

/** "Google: gesynchroniseerd / mislukt / niet verbonden" (pending shows as in progress). */
export const GOOGLE_SYNC_LABELS: Record<CmsGoogleSyncStatus, string> = {
  synced: 'gesynchroniseerd',
  failed: 'mislukt',
  none: 'niet verbonden',
  pending: 'bezig',
};

export const GOOGLE_SYNC_VARIANTS: Record<CmsGoogleSyncStatus, BadgeVariant> = {
  synced: 'success',
  failed: 'destructive',
  none: 'secondary',
  pending: 'outline',
};

export const LOCATION_KIND_LABELS: Record<CmsLocationKind, string> = {
  studio: 'Studio',
  customer: 'Bij de klant',
};

export const EXCEPTION_KIND_LABELS: Record<CmsAvailabilityExceptionKind, string> = {
  closed: 'Gesloten',
  open: 'Extra open',
};

/** Index = weekday as stored (0 = Sunday). */
export const WEEKDAY_LABELS = [
  'Zondag',
  'Maandag',
  'Dinsdag',
  'Woensdag',
  'Donderdag',
  'Vrijdag',
  'Zaterdag',
] as const;

/** Display order: Monday first, Sunday last. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** 15000 → "150"; 14950 → "149,50"; `null` → "". For a euro input that stores cents. */
export function centsToEuroInput(cents: number | null): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2).replace('.', ',').replace(/,00$/, '');
}
