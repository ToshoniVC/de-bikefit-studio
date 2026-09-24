import { renderDefaultOgImage } from '@/lib/studio/og-image';

/**
 * `GET /og` — the default social-share card for every Studio page.
 *
 * This is a plain route handler rather than Next's `opengraph-image` file
 * convention, for one concrete reason: that convention is per route segment and
 * does not cascade, and Turbopack refuses to place one *inside* a catch-all
 * segment ("catch all segment must be the last segment modifying the path").
 * Since almost every CMS page is served by `[...slug]`, one stable URL that
 * `buildPageMetadata()` points at is both simpler and more predictable.
 *
 * It lives in the `(studio)` group, so it is a static route and always wins
 * over the catch-all next to it.
 */
export function GET() {
  return renderDefaultOgImage();
}
