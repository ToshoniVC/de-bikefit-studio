import { z } from 'zod';

/**
 * Shared field schemas for the block registry.
 *
 * Split out of `blocks.ts` so block families that live in their own module
 * (`blocks-aanbod.ts`) can reuse them without a circular import. `blocks.ts`
 * re-exports everything here, so `@/lib/cms/blocks` stays the one import path
 * for callers — and the admin's field-spec identity checks
 * (`inner === imageRefSchema`) keep working because it is the same object.
 */

/** Matches the prototype's section backgrounds: white, `--gray`, `--dark`. */
export const sectionVariantSchema = z.enum(['default', 'gray', 'dark']).default('default');
export type SectionVariant = z.infer<typeof sectionVariantSchema>;

/**
 * Links may be internal paths (`/bikefit`), anchors (`#contact`), `tel:` URIs
 * (the prototype's main CTA dials 0473 95 26 33) or absolute URLs — so this is
 * a non-empty string, not a URL.
 */
export const linkSchema = z.object({
  label: z.string().min(1),
  href: z.string().min(1),
  external: z.boolean().default(false),
});
export type CmsLink = z.infer<typeof linkSchema>;

export const optionalLinkSchema = linkSchema.nullable().default(null);

/**
 * Image reference. `mediaId` points at `cms_media`; `url` is only used for
 * assets that live outside the media library (e.g. `/brand/…` in /public).
 * `alt` is the per-block override; it falls back to `cms_media.alt[locale]`.
 */
export const imageRefSchema = z.object({
  mediaId: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
  alt: z.string().default(''),
  /** Purely decorative images are hidden from assistive technology. */
  decorative: z.boolean().default(false),
});
export type CmsImageRef = z.infer<typeof imageRefSchema>;

export const emptyImage: CmsImageRef = { mediaId: null, url: null, alt: '', decorative: false };

export const eyebrow = z.string().default('');
export const lede = z.string().default('');
