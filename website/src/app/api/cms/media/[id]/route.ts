import { getMediaBytes } from '@/lib/cms/content';

/**
 * Media bytes for `storage = 'db'` items — the target of `mediaUrl()`.
 *
 * Deliberately **public and read-only**: these bytes are the images the public
 * site renders, so a visitor's browser must be able to fetch them without a
 * session. `getMediaBytes()` already refuses soft-deleted media, and there is
 * no write verb here — uploads go through a server action, which Next protects
 * with its own origin check.
 *
 * Hardening:
 *  - `X-Content-Type-Options: nosniff` so a mislabelled upload cannot be
 *    re-interpreted as HTML;
 *  - SVG (the one format that can carry script) is served with a locked-down
 *    CSP and `sandbox`, so opening it directly executes nothing;
 *  - ids are opaque UUIDs, so the immutable long cache is safe.
 */

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Next 16: route params are async.
  const { id } = await params;

  const media = await getMediaBytes(id);
  if (!media) return new Response('Not found', { status: 404 });

  const headers = new Headers({
    'Content-Type': media.mimeType,
    'Content-Length': String(media.data.byteLength),
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });

  if (media.mimeType === 'image/svg+xml') {
    headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  }

  return new Response(new Uint8Array(media.data), { headers });
}
