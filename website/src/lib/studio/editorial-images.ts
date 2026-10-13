import type { CmsImageRef } from '@/lib/cms/block-primitives';
import manifest from './editorial-images.json';

/**
 * The three editorial images of the 13 Oct 2026 redesign, as image refs the
 * seed and the staging rollout write into blocks. Plain module.
 *
 * The manifest (`editorial-images.json`) is maintained by
 * `scripts/import-editorial-image.mts`, which copies and compresses a
 * delivered file into `public/images/editorial/` and records its provenance.
 * A slot without a file yields an empty ref, so a page never points at an
 * image that does not exist; the section then shows its decorative panel.
 *
 * These are generated images of generic people. They are never used as a
 * portrait of a team member (the `team` block draws initials instead).
 */

export const EDITORIAL_IMAGE_DIR = '/images/editorial';

export type EditorialSlot = keyof typeof manifest.images;

export const EDITORIAL_SLOTS = Object.keys(manifest.images) as EditorialSlot[];

export function editorialImage(slot: EditorialSlot): CmsImageRef {
  const entry = manifest.images[slot] as { file: string | null; alt: string };
  if (!entry.file) return { mediaId: null, url: null, alt: '', decorative: false };
  return {
    mediaId: null,
    url: `${EDITORIAL_IMAGE_DIR}/${entry.file}`,
    alt: entry.alt,
    decorative: false,
  };
}
