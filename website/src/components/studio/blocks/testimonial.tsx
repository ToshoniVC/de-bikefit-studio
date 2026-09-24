import { StudioImage, hasImage } from '../studio-image';
import { StudioSection } from './section';
import type { BlockProps } from './types';

/**
 * `testimonial` — hidden while it is a placeholder.
 *
 * The four reviews in the block registry come from `content/index.html`, which
 * flags them explicitly as illustrative copy to be replaced with real
 * testimonials before launch. Publishing invented reviews would be both a
 * trust problem and a structured-data violation, so the block renders nothing
 * until `isPlaceholder` is cleared — and no `Review` or `AggregateRating` is
 * ever emitted.
 */
export function TestimonialBlock({
  data,
  anchor,
  headingLevel,
  locale,
}: BlockProps<'testimonial'>) {
  if (data.isPlaceholder) return null;

  return (
    <StudioSection
      variant={data.variant}
      anchor={anchor}
      eyebrow={data.eyebrow}
      title={data.title}
      headingLevel={headingLevel}
    >
      <div className="studio-cards">
        {data.items.map((item, index) => (
          <figure className="studio-card" key={`${item.author}-${index}`}>
            {hasImage(item.image) ? (
              <div className="studio-card__media">
                <StudioImage
                  image={item.image}
                  locale={locale}
                  sizes="(max-width: 900px) 100vw, 25vw"
                />
              </div>
            ) : null}
            <blockquote className="studio-card__body">{item.quote}</blockquote>
            {item.author || item.meta ? (
              <figcaption className="studio-card__meta">
                {[item.author, item.meta].filter(Boolean).join(' · ')}
              </figcaption>
            ) : null}
          </figure>
        ))}
      </div>
    </StudioSection>
  );
}
