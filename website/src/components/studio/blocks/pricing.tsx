import { StudioButtonLink, splitArrow } from '../link';
import { StudioSection } from './section';
import type { BlockProps } from './types';

/**
 * `pricing` — hidden while it is a placeholder.
 *
 * No amount exists anywhere in `prototype/`, `content/` or `brand/`; the copy
 * deck records "prijzen tonen?" as an open question. The block therefore ships
 * with `isPlaceholder: true` and renders **nothing at all** — not an empty
 * section, not a heading, not a "vanaf" — until someone enters real prices and
 * clears the flag. `visibleBlocks()` filters it out before this component is
 * reached; the guard below is the second lock on the same door.
 */
export function PricingBlock({ data, anchor, headingLevel }: BlockProps<'pricing'>) {
  if (data.isPlaceholder) return null;

  const formatter = new Intl.NumberFormat('nl-BE', {
    style: 'currency',
    currency: data.currency || 'EUR',
    maximumFractionDigits: 0,
  });

  return (
    <StudioSection
      variant={data.variant}
      anchor={anchor}
      eyebrow={data.eyebrow}
      title={data.title}
      lede={data.lede}
      headingLevel={headingLevel}
    >
      <div className="studio-cards">
        {data.plans.map((plan, index) => (
          <article
            key={`${plan.title}-${index}`}
            className={`studio-card${plan.highlighted ? ' studio-card--featured' : ''}`}
          >
            <h3 className="studio-card__title">{plan.title}</h3>
            {plan.priceCents !== null ? (
              <p className="studio-contact__value">{formatter.format(plan.priceCents / 100)}</p>
            ) : plan.priceLabel ? (
              <p className="studio-contact__value">{plan.priceLabel}</p>
            ) : null}
            {plan.duration ? <p className="studio-card__meta">{plan.duration}</p> : null}
            {plan.description ? <p className="studio-card__body">{plan.description}</p> : null}
            {plan.features.length > 0 ? (
              <div className="studio-rich">
                <ul>
                  {plan.features.map((feature, featureIndex) => (
                    <li key={featureIndex}>{feature}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {plan.cta ? (
              <p>
                <StudioButtonLink
                  href={plan.cta.href}
                  external={plan.cta.external}
                  variant="outline"
                >
                  {splitArrow(plan.cta.label)}
                </StudioButtonLink>
              </p>
            ) : null}
          </article>
        ))}
      </div>
      {data.footnote ? <p className="studio-card__meta studio-stack">{data.footnote}</p> : null}
    </StudioSection>
  );
}
