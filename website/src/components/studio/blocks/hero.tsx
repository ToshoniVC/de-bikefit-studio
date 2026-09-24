import { StudioButtonLink, splitArrow } from '../link';
import { StudioImage, hasImage } from '../studio-image';
import { SectionHeading } from './section';
import type { BlockProps } from './types';

/**
 * `hero` — two shapes, one block:
 *
 *  - `variant: 'full'`     the landing hero (`prototype/index.html .hero`)
 *  - `variant: 'pageHead'` the compact header on subpages
 *                          (`prototype/bikefit.html .page-head`)
 *
 * `titleEmphasis` reproduces the `<em>` in "Fiets met *comfort.*" — the italic
 * tagline voice from the brand reference, one tone back from the title.
 *
 * The decorative wash and ring are pseudo-elements on `.studio-hero__media`,
 * so they cost no markup and are invisible to screen readers. When an editor
 * sets a real image it is drawn in the same box, above the wash.
 */
export function HeroBlock({ data, anchor, headingLevel, locale }: BlockProps<'hero'>) {
  const title = (
    <>
      {data.title}
      {data.titleEmphasis ? (
        <>
          {' '}
          <em>{data.titleEmphasis}</em>
        </>
      ) : null}
    </>
  );

  const actions = (
    <>
      {data.primaryCta ? (
        <StudioButtonLink
          href={data.primaryCta.href}
          external={data.primaryCta.external}
          variant="primary"
        >
          {splitArrow(data.primaryCta.label)}
        </StudioButtonLink>
      ) : null}
      {data.secondaryCta ? (
        <StudioButtonLink
          href={data.secondaryCta.href}
          external={data.secondaryCta.external}
          variant="ghost"
          arrow={false}
        >
          {splitArrow(data.secondaryCta.label)}
        </StudioButtonLink>
      ) : null}
    </>
  );

  if (data.variant === 'pageHead') {
    return (
      <section className="studio-pagehead" {...(anchor ? { id: anchor } : {})}>
        <div className="studio-pagehead__inner">
          {data.eyebrow ? <p className="studio-eyebrow">{data.eyebrow}</p> : null}
          <SectionHeading level={headingLevel} className="studio-pagehead__title">
            {title}
          </SectionHeading>
          {data.subtitle ? <p className="studio-pagehead__lede">{data.subtitle}</p> : null}
          {data.primaryCta || data.secondaryCta ? (
            <div className="studio-hero__actions studio-stack">{actions}</div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="studio-hero" {...(anchor ? { id: anchor } : {})}>
      <div className="studio-hero__media" aria-hidden={!hasImage(data.image)}>
        {hasImage(data.image) ? (
          <StudioImage image={data.image} locale={locale} sizes="100vw" priority />
        ) : null}
      </div>
      <div className="studio-hero__content">
        {data.eyebrow ? <p className="studio-hero__eyebrow">{data.eyebrow}</p> : null}
        <SectionHeading level={headingLevel} className="studio-hero__title">
          {title}
        </SectionHeading>
        {data.subtitle ? <p className="studio-hero__sub">{data.subtitle}</p> : null}
        {data.primaryCta || data.secondaryCta ? (
          <div className="studio-hero__actions">{actions}</div>
        ) : null}
      </div>
    </section>
  );
}
