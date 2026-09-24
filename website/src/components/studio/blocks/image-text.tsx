import { StudioButtonLink, splitArrow } from '../link';
import { StudioImage, hasImage } from '../studio-image';
import { SectionHeading, sectionClass } from './section';
import type { BlockProps } from './types';

/**
 * `imageText` — the two-column split behind `#verhaal`, `#waarom`, `#aan-huis`
 * and `#jeugd`.
 *
 * `imagePosition: 'left'` reverses the visual column with CSS `order`, so the
 * prose stays first in the DOM and is therefore first in the reading and tab
 * order at every width.
 *
 * With no image set, the panel keeps the reference's gradient-and-ring
 * treatment, which is decorative and hidden from assistive technology.
 */
export function ImageTextBlock({ data, anchor, headingLevel, locale }: BlockProps<'imageText'>) {
  const dark = data.variant === 'dark';
  const reverse = data.imagePosition === 'left';

  return (
    <section className={sectionClass(data.variant)} {...(anchor ? { id: anchor } : {})}>
      <div className="studio-section__inner">
        <div className={`studio-split${reverse ? ' studio-split--reverse' : ''}`}>
          <div className={`studio-rich${dark ? ' studio-rich--invert' : ''}`}>
            {data.eyebrow ? <p className="studio-eyebrow">{data.eyebrow}</p> : null}
            {data.title ? (
              <SectionHeading level={headingLevel} className="studio-section__title">
                {data.title}
              </SectionHeading>
            ) : null}
            {data.paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
            {data.bullets.length > 0 ? (
              <ul>
                {data.bullets.map((bullet, index) => (
                  <li key={index}>{bullet}</li>
                ))}
              </ul>
            ) : null}
            {data.quote ? (
              <blockquote>
                {data.quote}
                {data.quoteAttribution ? (
                  <footer>
                    <cite>{data.quoteAttribution}</cite>
                  </footer>
                ) : null}
              </blockquote>
            ) : null}
            {data.facts.length > 0 ? (
              <div className="studio-facts">
                {data.facts.map((fact, index) => (
                  <div key={index}>
                    <span>{fact.label}</span>
                    <span>{fact.value}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {data.cta ? (
              <p className="studio-stack">
                <StudioButtonLink
                  href={data.cta.href}
                  external={data.cta.external}
                  variant={dark ? 'ghost-on-dark' : 'ghost'}
                >
                  {splitArrow(data.cta.label)}
                </StudioButtonLink>
              </p>
            ) : null}
          </div>

          <div
            className={`studio-split__visual${dark ? '' : ' studio-split__visual--alt'}`}
            {...(hasImage(data.image) ? {} : { 'aria-hidden': true })}
          >
            {hasImage(data.image) ? <StudioImage image={data.image} locale={locale} /> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
