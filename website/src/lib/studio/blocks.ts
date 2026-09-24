import type { BlockInstance, BlockType } from '@/lib/cms/blocks';

/**
 * Presentation-side helpers over a published snapshot's block list.
 *
 * `src/lib/cms/blocks.ts` owns the *data* contract (schemas, validation).
 * Everything here is about how the public site treats those blocks: which ones
 * are visible at all, and what stable anchor each section gets.
 */

/**
 * Blocks that are hidden from visitors.
 *
 * `pricing` and `testimonial` ship with `isPlaceholder: true` because no prices
 * exist anywhere in the source material and the reviews in the copy deck are
 * illustrative, not real. While that flag is set the block renders nothing —
 * not an empty section, not a heading — and it is also left out of every piece
 * of structured data.
 */
export function isPlaceholderBlock(block: BlockInstance): boolean {
  if (block.type === 'pricing' || block.type === 'testimonial') {
    return block.data.isPlaceholder === true;
  }
  return false;
}

/** The blocks a visitor actually sees, in order. */
export function visibleBlocks(blocks: readonly BlockInstance[]): BlockInstance[] {
  return blocks.filter((block) => !isPlaceholderBlock(block));
}

/**
 * Stable, human-readable `id` per section so navigation and footers can deep
 * link (`/bikefit#werkwijze`). Repeats of the same type get `-2`, `-3`, … in
 * document order, which keeps ids unique without inventing content.
 */
const ANCHOR_BY_TYPE: Partial<Record<BlockType, string>> = {
  services: 'diensten',
  process: 'werkwijze',
  audience: 'voor-wie',
  faq: 'vragen',
  cta: 'afspraak',
  contact: 'contact',
  imageText: 'verhaal',
  richText: 'info',
  pricing: 'tarieven',
  testimonial: 'ervaringen',
  booking: 'boeken',
};

export function sectionAnchors(blocks: readonly BlockInstance[]): Map<string, string> {
  const counts = new Map<string, number>();
  const anchors = new Map<string, string>();

  for (const block of blocks) {
    const base = ANCHOR_BY_TYPE[block.type];
    if (!base) continue;
    const seen = (counts.get(base) ?? 0) + 1;
    counts.set(base, seen);
    anchors.set(block.id, seen === 1 ? base : `${base}-${seen}`);
  }
  return anchors;
}

/**
 * Does this `services` block describe bookable services?
 *
 * The prototype uses the same card grid for two very different things: "Vier
 * dingen, één positie" (what we look at during a fit) and "Vier manieren om te
 * boeken" (the fits you can actually book). Only the second is a schema.org
 * `Service`. The signal that separates them is already in the data — bookable
 * fits carry a `duration` ("90 minuten", "60 minuten"), the inspection points
 * never do — so no extra field and no guesswork is needed.
 */
export function isBookableServicesBlock(block: BlockInstance): boolean {
  return block.type === 'services' && block.data.cards.some((card) => card.duration.trim() !== '');
}
