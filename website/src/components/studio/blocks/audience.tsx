import { StudioSection } from './section';
import type { BlockProps } from './types';

/**
 * `audience` — "Voor wie is dit?".
 *
 * The prototype writes the heading as "01 · Jonge fietsers"; the numeral is
 * part of the visible heading there, so it stays inside the `<h3>` here too
 * rather than becoming a separate element that a screen reader would announce
 * on its own.
 *
 * Without a section title (the cards follow the page head directly, as on
 * `/voor-wie`) the card headings move up to `<h2>`, so the outline never
 * skips a level.
 */
export function AudienceBlock({ data, anchor, headingLevel }: BlockProps<'audience'>) {
  const CardHeading = data.title ? 'h3' : 'h2';

  return (
    <StudioSection
      variant={data.variant}
      anchor={anchor}
      eyebrow={data.eyebrow}
      title={data.title}
      lede={data.lede}
      headingLevel={headingLevel}
    >
      {data.items.length > 0 ? (
        <div className="studio-cards">
          {data.items.map((item, index) => (
            <article
              key={`${item.title}-${index}`}
              className={`studio-card${item.featured ? ' studio-card--featured' : ''}`}
            >
              <CardHeading className="studio-card__title">
                {item.number ? `${item.number} · ` : ''}
                {item.title}
              </CardHeading>
              {item.body ? <p className="studio-card__body">{item.body}</p> : null}
            </article>
          ))}
        </div>
      ) : null}
    </StudioSection>
  );
}
