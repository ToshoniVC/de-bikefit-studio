/**
 * Constants for the default social-share card.
 *
 * Deliberately separate from `og-image.tsx`: that module imports
 * `ImageResponse` from `next/og`, and `seo.ts` (which every page renders) only
 * needs the URL and the dimensions. Keeping them apart stops the image renderer
 * from being pulled into every page's server bundle.
 */
export const OG_IMAGE_PATH = '/og';
export const OG_IMAGE_ALT = 'De Bikefit Studio — Fiets met comfort';
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;
