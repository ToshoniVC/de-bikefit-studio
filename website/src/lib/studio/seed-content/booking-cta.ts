/**
 * "Boek je bikefit" buttons book: they go where the header's "Afspraak maken"
 * goes (`BOOKING_PATH`). Older defaults sent them to the phone (`tel:`) or to
 * `#contact`; this finds such links anywhere in block data and retargets them.
 * Phone-number links keep dialling: only a link whose label starts with
 * "Boek je bikefit" is touched, and only its `href`.
 *
 * Used by `scripts/cms-patch-booking-cta.mts` (existing CMS content) and by
 * the unit test that keeps seeds and block defaults from regressing. Pure.
 */
import { BOOKING_PATH } from './shared';

export type BookingCtaChange = { path: string; label: string; from: string };

const BOOKING_LABEL = /^boek je bikefit\b/i;

function isLink(value: Record<string, unknown>): value is { label: string; href: string } {
  return typeof value.label === 'string' && typeof value.href === 'string';
}

function dialsOrScrolls(href: string): boolean {
  const target = href.trim().toLowerCase();
  return target.startsWith('tel:') || target === '#contact';
}

/** Copy of `data` with every misdirected booking link pointing at `BOOKING_PATH`. */
export function retargetBookingCtas(
  data: unknown,
  path = '',
): { data: unknown; changes: BookingCtaChange[] } {
  if (Array.isArray(data)) {
    const changes: BookingCtaChange[] = [];
    const items = data.map((item, index) => {
      const result = retargetBookingCtas(item, `${path}[${index}]`);
      changes.push(...result.changes);
      return result.data;
    });
    return { data: items, changes };
  }
  if (data === null || typeof data !== 'object') return { data, changes: [] };

  const record = data as Record<string, unknown>;
  if (isLink(record) && BOOKING_LABEL.test(record.label.trim()) && dialsOrScrolls(record.href)) {
    return {
      data: { ...record, href: BOOKING_PATH },
      changes: [{ path, label: record.label, from: record.href }],
    };
  }
  const changes: BookingCtaChange[] = [];
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const result = retargetBookingCtas(value, path ? `${path}.${key}` : key);
    changes.push(...result.changes);
    copy[key] = result.data;
  }
  return { data: copy, changes };
}
