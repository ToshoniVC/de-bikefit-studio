import Image from 'next/image';
import type { CmsImageRef } from '@/lib/cms/blocks';
import { resolveMedia } from '@/lib/studio/site';
import type { StudioLocale } from '@/lib/studio/locale';

/**
 * Renders a block's image reference.
 *
 * `mediaId` is resolved through the media library; `url` covers assets that
 * live in `/public` instead. Bytes for `storage: 'db'` media are served from
 * `/api/cms/media/<id>`, which already sets an immutable one-year
 * `Cache-Control`, so the images are served `unoptimized`: running them through
 * Next's optimiser a second time would buy nothing and would add a round trip.
 *
 * `fill` is used because `cms_media.width/height` are nullable — the aspect
 * ratio belongs to the surrounding box (`.studio-split__visual`,
 * `.studio-card__media`), which never collapses.
 *
 * Alt text precedence: the block's per-use override, then the media library's
 * per-locale alt. `decorative: true` produces `alt=""` and hides the image from
 * assistive technology, which is the correct markup for a purely visual asset.
 */
export async function StudioImage({
  image,
  locale,
  sizes = '(max-width: 900px) 100vw, 50vw',
  priority = false,
  className,
}: {
  image: CmsImageRef;
  locale: StudioLocale;
  sizes?: string;
  priority?: boolean;
  className?: string;
}) {
  const media = image.mediaId ? await resolveMedia(image.mediaId, locale) : null;
  const src = media?.url ?? image.url;
  if (!src) return null;

  const alt = image.decorative ? '' : image.alt.trim() || media?.alt || '';

  return (
    <Image
      src={src}
      alt={alt}
      fill
      unoptimized
      sizes={sizes}
      // Only the hero is above the fold; everything else loads lazily.
      priority={priority}
      loading={priority ? undefined : 'lazy'}
      className={className}
      {...(image.decorative ? { 'aria-hidden': true } : {})}
    />
  );
}

export function hasImage(image: CmsImageRef): boolean {
  return Boolean(image.mediaId || image.url);
}
