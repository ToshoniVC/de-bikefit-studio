import { describe, expect, it } from 'vitest';
import { validateBlock, validateBlocks } from '@/lib/cms/blocks';
import { GIFT_VOUCHER_PAGE_SLUG, GIFT_VOUCHER_SUBMIT_LABEL } from '@/lib/gift-voucher/order';
import { offerFromPage } from '@/lib/offers/catalogue';
import { AANBOD_PAGES } from './aanbod';
import {
  CADEAUBON_AANBOD_SPEC,
  CADEAUBON_PAGE,
  cadeaubonAanbodBlocks,
  cadeaubonProblems,
} from './cadeaubon';
import before from './page-cleanup.fixture.json';
import { cleanupBlocks, PAGE_CLEANUP_SPECS, type CleanupBlock } from './page-cleanup';

/**
 * The gift voucher patch on the content staging holds after the page cleanup
 * (the staging-before fixture with the cleanup applied): it must produce
 * today's seed for /aanbod, refuse editor changes, and add nothing else.
 */

function stored(blocks: readonly CleanupBlock[]): CleanupBlock[] {
  const result = validateBlocks(blocks);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.blocks.map((block) => ({
    type: block.type,
    data: block.data as Record<string, unknown>,
  }));
}

/** /aanbod as staging will hold it once `cms:patch-page-cleanup` ran. */
function stagingAanbod(): CleanupBlock[] {
  const page = before.pages.find((entry) => entry.slug === 'aanbod')!;
  const spec = PAGE_CLEANUP_SPECS.find((entry) => entry.slug === 'aanbod')!;
  return cleanupBlocks(spec, stored(page.blocks as CleanupBlock[])).next;
}

const seedAanbod = AANBOD_PAGES.find((entry) => entry.slug === 'aanbod')!;

describe('cadeaubon page (seed)', () => {
  it('lives at /aanbod/cadeaubon with exactly one valid gift voucher block', () => {
    expect(CADEAUBON_PAGE.slug).toBe(GIFT_VOUCHER_PAGE_SLUG);
    expect(CADEAUBON_PAGE.blocks.map((block) => block.type)).toEqual(['giftVoucher']);
    for (const block of CADEAUBON_PAGE.blocks)
      expect(validateBlock(block.type, block.data).ok).toBe(true);
  });

  it('becomes the Overige card, priced "Bedrag naar keuze"', () => {
    expect(offerFromPage(CADEAUBON_PAGE)).toMatchObject({
      kind: 'giftVoucher',
      category: 'overige',
      path: '/aanbod/cadeaubon',
      title: 'Cadeaubon',
      priceLabel: 'Bedrag naar keuze',
    });
  });

  it('states no validity, terms, payment method or minimum (not decided)', () => {
    const text = JSON.stringify(CADEAUBON_PAGE).toLowerCase();
    for (const word of [
      'geldig',
      'voorwaarde',
      'maand',
      'jaar',
      'minimum',
      'bancontact',
      'overschrijving',
      'terugbetaal',
    ]) {
      expect(text).not.toContain(word);
    }
    expect(GIFT_VOUCHER_SUBMIT_LABEL).toBe('Bestel nu');
  });

  it('adds Overige to /aanbod only, after the existing groups', () => {
    const groups = (page: (typeof AANBOD_PAGES)[number]) =>
      page.blocks
        .filter((block) => block.type === 'offerCatalogue')
        .map((block) =>
          (block.data.groups as { category: string }[]).map((group) => group.category),
        );
    expect(groups(seedAanbod)).toEqual([['bikefit', 'begeleiding', 'overige']]);
    for (const page of AANBOD_PAGES.filter((entry) => entry.slug !== 'aanbod')) {
      for (const categories of groups(page)) expect(categories).not.toContain('overige');
    }
  });
});

describe('cadeaubon patch on /aanbod', () => {
  it("turns the staging content (after the page cleanup) into today's seed", () => {
    const result = cadeaubonAanbodBlocks(stagingAanbod());
    expect(result.conflicts).toEqual([]);
    expect(result.changes).toHaveLength(1);
    expect(result.updated).toHaveLength(1);
    expect(result.next).toEqual(stored(seedAanbod.blocks));
    expect(cadeaubonProblems(stagingAanbod(), null)).toEqual([
      '/aanbod: "Overige" is not the last group',
      '/aanbod/cadeaubon: not published',
    ]);
    expect(cadeaubonProblems(result.next, stored(CADEAUBON_PAGE.blocks))).toEqual([]);
  });

  it('is idempotent', () => {
    const once = cadeaubonAanbodBlocks(stagingAanbod()).next;
    const again = cadeaubonAanbodBlocks(once);
    expect(again.changes).toEqual([]);
    expect(again.updated).toEqual([]);
    expect(again.conflicts).toEqual([]);
  });

  it('works whether or not the page cleanup ran first (independent fields)', () => {
    const raw = before.pages.find((entry) => entry.slug === 'aanbod')!;
    const result = cadeaubonAanbodBlocks(stored(raw.blocks as CleanupBlock[]));
    expect(result.conflicts).toEqual([]);
    expect(result.changes).toHaveLength(1);
  });

  it('matches the groups as Postgres jsonb returns them (keys reordered)', () => {
    const blocks = stagingAanbod().map((block) =>
      block.type === 'offerCatalogue'
        ? {
            ...block,
            data: {
              ...block.data,
              groups: (block.data.groups as Record<string, string>[]).map(
                ({ category, title, lede }) => ({ lede, title, category }),
              ),
            },
          }
        : block,
    );
    const result = cadeaubonAanbodBlocks(blocks);
    expect(result.conflicts).toEqual([]);
    expect(result.changes).toHaveLength(1);
    expect(cadeaubonAanbodBlocks(result.next).changes).toEqual([]);
  });

  it('refuses groups an editor changed, and leaves them alone', () => {
    const blocks = stagingAanbod();
    const catalogue = blocks.find((block) => block.type === 'offerCatalogue')!;
    const edited = (catalogue.data.groups as { lede: string }[]).map((group, index) =>
      index === 0 ? { ...group, lede: 'Tekst van de redactie' } : group,
    );
    catalogue.data = { ...catalogue.data, groups: edited };
    const result = cadeaubonAanbodBlocks(blocks);
    expect(result.conflicts).toEqual([expect.stringContaining('offerCatalogue.groups')]);
    expect(result.updated).toEqual([]);
  });

  it('touches only the catalogue groups', () => {
    expect(CADEAUBON_AANBOD_SPEC.slug).toBe('aanbod');
    expect(CADEAUBON_AANBOD_SPEC.edits).toHaveLength(1);
    const blocks = stagingAanbod();
    const result = cadeaubonAanbodBlocks(blocks);
    result.next.forEach((block, index) => {
      if (block.type !== 'offerCatalogue') expect(block).toEqual(blocks[index]);
      else expect({ ...block.data, groups: null }).toEqual({ ...blocks[index].data, groups: null });
    });
  });
});
