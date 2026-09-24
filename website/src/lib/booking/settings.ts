import type { z } from 'zod';
import { DEFAULT_LOCALE } from '@/db/cms-schema';
import { siteSettingSchemas } from '@/lib/cms/blocks';
import { isValidTimeZone } from './time';

/**
 * Booking rules — the `booking` key of `cms_site_settings`, merged with the
 * schema defaults (slot grid 30 min, 24 h notice, 56 days horizon, 15 min
 * buffer, cancel until 48 h before, Europe/Brussels).
 *
 * Plain module: the pure parts (`BookingRules`, `DEFAULT_BOOKING_RULES`,
 * `parseBookingRules`) are safe anywhere. `getBookingRules()` reads through the
 * cached `getSiteSettings()` of `@/lib/cms/content`, which is `server-only`;
 * it is imported lazily so importing this file never drags that in.
 */

export type BookingRules = z.infer<(typeof siteSettingSchemas)['booking']>;

export const DEFAULT_BOOKING_RULES: BookingRules = siteSettingSchemas.booking.parse({});

/**
 * Any stored value → complete rules; invalid input falls back to the defaults.
 * The schema only checks that `timezone` is non-empty, so a zone the runtime
 * does not know (which would make the slot engine throw a RangeError) is
 * replaced by the default zone while the other stored rules are kept.
 */
export function parseBookingRules(value: unknown): BookingRules {
  const parsed = siteSettingSchemas.booking.safeParse(value ?? {});
  if (!parsed.success) return DEFAULT_BOOKING_RULES;
  if (!isValidTimeZone(parsed.data.timezone)) {
    return { ...parsed.data, timezone: DEFAULT_BOOKING_RULES.timezone };
  }
  return parsed.data;
}

/** The effective booking rules for a locale (server only; cached, tag `cms:settings`). */
export async function getBookingRules(locale: string = DEFAULT_LOCALE): Promise<BookingRules> {
  const { getSiteSettings } = await import('@/lib/cms/content');
  const settings = await getSiteSettings(locale);
  return parseBookingRules(settings.booking);
}
