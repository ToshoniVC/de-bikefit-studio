import { OFFER_INDEX_PATH } from '@/lib/offers/catalogue';
import { BOOKING_PATH, type SeedNavigationItem } from './shared';

/**
 * Menus and redirects of the 13 Oct 2026 redesign (see `aanbod.ts` for the
 * pages). Plain data; used by `cms:seed` and `cms:rollout-aanbod`.
 */

function navItem(label: string, href: string, group = ''): SeedNavigationItem {
  return { label, href, external: false, group, children: [] };
}

/**
 * Logo links home; there is no "Home" item. The header CTA is `PRIMARY_CTA`.
 * "Contact" leads to the booking page, the single place to book or ask
 * (Toshoni's review, 13 Oct 2026); `/contact` itself redirects there.
 */
export const MAIN_MENU: SeedNavigationItem[] = [
  navItem('Aanbod', OFFER_INDEX_PATH),
  navItem('Voor wie', '/voor-wie'),
  navItem('Bikefit', '/bikefit'),
  navItem('Ons team', '/ons-team'),
  navItem('Contact', BOOKING_PATH),
];

export const FOOTER_MENU: SeedNavigationItem[] = [
  navItem('Aanbod', OFFER_INDEX_PATH, 'Studio'),
  navItem('Voor wie', '/voor-wie', 'Studio'),
  navItem('Bikefit', '/bikefit', 'Studio'),
  navItem('Ons team', '/ons-team', 'Studio'),
  navItem('Contact', BOOKING_PATH, 'Studio'),
  navItem('Afspraak maken', BOOKING_PATH, 'Praktisch'),
  navItem('Werkwijze', '/bikefit#werkwijze', 'Praktisch'),
  navItem('Veelgestelde vragen', '/veelgestelde-vragen', 'Praktisch'),
  navItem('Privacyverklaring', '/privacy', 'Juridisch'),
  navItem('Algemene voorwaarden', '/algemene-voorwaarden', 'Juridisch'),
];

/** `/over-ons` is replaced by `/ons-team`; the old page is unpublished (kept), not deleted. */
export const RETIRED_PAGE_SLUG = 'over-ons';

export const AANBOD_REDIRECTS = [
  {
    fromPath: '/over-ons',
    toPath: '/ons-team',
    statusCode: 301 as const,
    notes: 'Over ons is vervangen door Ons team (aanbod-rollout 13 okt 2026).',
  },
  // The gift voucher page left /aanbod/ when the offer pages were retired (17 Oct 2026).
  {
    fromPath: '/aanbod/cadeaubon',
    toPath: '/cadeaubon',
    statusCode: 301 as const,
    notes: 'De cadeaubon staat sinds 17 okt 2026 op /cadeaubon (aanbod zonder subpagina’s).',
  },
];
