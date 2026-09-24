import { StudioButtonLink, splitArrow } from '../link';
import { SectionHeading } from './section';
import type { BlockProps } from './types';

/**
 * `cta` — the accent band ("Comfort is een keuze. Maak ze.").
 *
 * `accent` and `dark` are the same burgundy ground in the reference; `gray`
 * is the bone variant for a page that already ends on a dark section. The
 * button skin flips with the ground so the label keeps its 11:1 contrast.
 */
export function CtaBlock({ data, anchor, headingLevel }: BlockProps<'cta'>) {
  const onLight = data.variant === 'gray';

  return (
    <section
      className={`studio-callout${onLight ? ' studio-callout--gray' : ''}`}
      {...(anchor ? { id: anchor } : {})}
    >
      <div className="studio-callout__inner">
        <div>
          <SectionHeading level={headingLevel} className="studio-callout__title">
            {data.title}
          </SectionHeading>
          {data.body ? <p className="studio-callout__body">{data.body}</p> : null}
        </div>
        {data.primaryCta || data.secondaryCta ? (
          <div className="studio-callout__actions">
            {data.primaryCta ? (
              <StudioButtonLink
                href={data.primaryCta.href}
                external={data.primaryCta.external}
                variant={onLight ? 'primary' : 'dark'}
              >
                {splitArrow(data.primaryCta.label)}
              </StudioButtonLink>
            ) : null}
            {data.secondaryCta ? (
              <StudioButtonLink
                href={data.secondaryCta.href}
                external={data.secondaryCta.external}
                variant={onLight ? 'ghost' : 'ghost-on-dark'}
                arrow={false}
              >
                {splitArrow(data.secondaryCta.label)}
              </StudioButtonLink>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
