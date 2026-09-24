import { StudioButtonLink, splitArrow } from '../link';
import { StudioImage, hasImage } from '../studio-image';
import { StudioSection } from './section';
import type { BlockProps } from './types';

/**
 * `services` — the card grid, in the two shapes the prototype uses:
 *
 *  - every card carries a `label` ("01 / Houding") → the hairline-joined
 *    feature grid from "Vier dingen, één positie";
 *  - otherwise → the outlined cards from "Vier manieren om te boeken".
 *
 * `columns` only sets the *minimum* track width; the grid stays `auto-fit`, so
 * a four-column block becomes two and then one as the viewport narrows instead
 * of scrolling sideways.
 */

const MIN_TRACK: Record<number, string> = { 2: '420px', 3: '320px', 4: '280px' };

export function ServicesBlock({ data, anchor, headingLevel, locale }: BlockProps<'services'>) {
  const asFeatureGrid =
    data.cards.length > 0 && data.cards.every((card) => card.label.trim() !== '');
  const style = { '--studio-card-min': MIN_TRACK[data.columns] ?? '280px' } as React.CSSProperties;

  return (
    <StudioSection
      variant={data.variant}
      anchor={anchor}
      eyebrow={data.eyebrow}
      title={data.title}
      lede={data.lede}
      headingLevel={headingLevel}
    >
      {data.cards.length > 0 ? (
        <div className={asFeatureGrid ? 'studio-feature-grid' : 'studio-cards'} style={style}>
          {data.cards.map((card, index) => (
            <article
              key={`${card.title}-${index}`}
              className={asFeatureGrid ? 'studio-feature' : 'studio-card'}
            >
              {hasImage(card.image) ? (
                <div className="studio-card__media">
                  <StudioImage
                    image={card.image}
                    locale={locale}
                    sizes="(max-width: 900px) 100vw, 25vw"
                  />
                </div>
              ) : null}
              {card.label ? (
                <p className={asFeatureGrid ? 'studio-feature__num' : 'studio-card__meta'}>
                  {card.label}
                </p>
              ) : null}
              <h3 className={asFeatureGrid ? 'studio-feature__title' : 'studio-card__title'}>
                {card.title}
              </h3>
              {card.duration ? <p className="studio-card__meta">{card.duration}</p> : null}
              {card.body ? (
                <p className={asFeatureGrid ? 'studio-feature__body' : 'studio-card__body'}>
                  {card.body}
                </p>
              ) : null}
              {card.cta ? (
                <p>
                  <StudioButtonLink
                    href={card.cta.href}
                    external={card.cta.external}
                    variant="outline"
                  >
                    {splitArrow(card.cta.label)}
                  </StudioButtonLink>
                </p>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </StudioSection>
  );
}
