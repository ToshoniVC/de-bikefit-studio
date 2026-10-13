import { GIFT_VOUCHER_PAGE_SLUG } from '@/lib/gift-voucher/order';
import { OFFER_INDEX_PATH } from '@/lib/offers/catalogue';
import { OFFER_GROUPS, OTHER_OFFER_GROUP } from './aanbod';
import { cleanupBlocks, type CleanupBlock, type PageCleanupSpec } from './page-cleanup';
import type { SeedPage } from './shared';

/**
 * The gift voucher ("Cadeaubon", Toshoni, 13 Oct 2026): the page
 * `/aanbod/cadeaubon` with its order form, and the "Overige" group on
 * `/aanbod` that lists it. Plain data, no I/O.
 *
 * Used by `npm run cms:seed` (fresh databases) and by
 * `npm run cms:patch-cadeaubon`, which brings an existing database — staging
 * after the page cleanup — to exactly this: the page created and published,
 * one guarded edit of the /aanbod catalogue groups, nothing else.
 *
 * COPY PROVENANCE: the request itself (custom amount, personal text, contact
 * details, "Bestel nu" e-mails the studio, invoice and payment link made by
 * hand). No validity, terms, minimum amount or delivery promise is stated:
 * the studio has not decided those.
 */

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
        summary: 'Fietsplezier cadeau doen, met een bedrag en een boodschap naar keuze.',
        intro:
          'Geef iemand fietsplezier cadeau. Je kiest zelf het bedrag en schrijft er een persoonlijke boodschap bij. Na je bestelling sturen we je een factuur en een betaallink.',
        formTitle: 'Bestel je cadeaubon',
        sentTitle: 'Je bestelling is verstuurd',
        sentText: '',
      },
    },
  ],
};

/** The one edit on /aanbod: append "Overige" to the catalogue groups. */
export const CADEAUBON_AANBOD_SPEC: PageCleanupSpec = {
  slug: OFFER_INDEX_PATH.slice(1),
  edits: [
    {
      kind: 'set',
      select: { label: 'offerCatalogue', type: 'offerCatalogue' },
      field: 'groups',
      from: OFFER_GROUPS,
      to: [...OFFER_GROUPS, OTHER_OFFER_GROUP],
    },
  ],
};

/** Applies the /aanbod edit (pure); conflicts when an editor changed the groups. */
export function cadeaubonAanbodBlocks<T extends CleanupBlock>(blocks: readonly T[]) {
  return cleanupBlocks(CADEAUBON_AANBOD_SPEC, blocks);
}

/**
 * Invariants on what visitors get; an empty list means the voucher is live as
 * intended: /aanbod lists Overige last, and the voucher page has exactly one
 * `giftVoucher` block.
 */
export function cadeaubonProblems(
  aanbod: readonly CleanupBlock[],
  voucher: readonly CleanupBlock[] | null,
): string[] {
  const problems: string[] = [];
  const catalogue = aanbod.filter((block) => block.type === 'offerCatalogue');
  const groups = (catalogue[0]?.data.groups ?? []) as { category?: string }[];
  if (catalogue.length !== 1) problems.push('/aanbod: expected one offer catalogue');
  else if (groups.at(-1)?.category !== 'overige')
    problems.push('/aanbod: "Overige" is not the last group');
  if (!voucher) problems.push(`/${GIFT_VOUCHER_PAGE_SLUG}: not published`);
  else if (voucher.filter((block) => block.type === 'giftVoucher').length !== 1) {
    problems.push(`/${GIFT_VOUCHER_PAGE_SLUG}: expected one gift voucher form`);
  }
  return problems;
}
