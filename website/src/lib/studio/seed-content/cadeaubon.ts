import { GIFT_VOUCHER_PAGE_SLUG } from '@/lib/gift-voucher/order';
import { GIFT_VOUCHER_PRICE_LABEL } from '@/lib/offers/catalogue';
import type { SeedPage } from './shared';

/**
 * The gift voucher ("Cadeaubon", Toshoni, 13 Oct 2026): the page `/cadeaubon`
 * with its order form, and its card under "Overige" on `/aanbod` (an
 * `extraCards` entry of that page's catalogue block, `aanbod.ts`). Plain data,
 * no I/O. Until 17 Oct 2026 the page lived at `/aanbod/cadeaubon`; that path
 * redirects (`navigation.ts`, applied by `cms:migrate-aanbod`).
 *
 * Used by `npm run cms:seed` (fresh databases) and by `cms:migrate-aanbod`.
 *
 * COPY PROVENANCE: the request itself (custom amount, personal text, contact
 * details, "Bestel nu" e-mails the studio, invoice and payment link made by
 * hand). No validity, terms, minimum amount or delivery promise is stated:
 * the studio has not decided those.
 */

export const CADEAUBON_PATH = `/${GIFT_VOUCHER_PAGE_SLUG}`;

/** The card on `/aanbod`, under Overige, after the offerings. */
export const CADEAUBON_CARD = {
  category: 'overige' as const,
  title: 'Cadeaubon',
  summary: 'Fietsplezier cadeau doen, met een bedrag en een boodschap naar keuze.',
  priceLabel: GIFT_VOUCHER_PRICE_LABEL,
  href: CADEAUBON_PATH,
};

export const CADEAUBON_PAGE: SeedPage = {
  slug: GIFT_VOUCHER_PAGE_SLUG,
  title: 'Cadeaubon',
  translationGroup: 'offer-cadeaubon',
  source: 'work block 2026-10-13 (gift voucher request)',
  metaTitle: 'Cadeaubon',
  metaDescription:
    'Bestel een cadeaubon van De Bikefit Studio: je kiest zelf het bedrag en schrijft er een persoonlijke boodschap bij.',
  structuredDataType: 'WebPage',
  blocks: [
    {
      type: 'giftVoucher',
      data: {
        sortOrder: 0,
        eyebrow: 'Aanbod',
        title: 'Cadeaubon',
        summary: CADEAUBON_CARD.summary,
        intro:
          'Geef iemand fietsplezier cadeau. Je kiest zelf het bedrag en schrijft er een persoonlijke boodschap bij. Na je bestelling sturen we je een factuur en een betaallink.',
        formTitle: 'Bestel je cadeaubon',
        sentTitle: 'Je bestelling is verstuurd',
        sentText: '',
      },
    },
  ],
};
