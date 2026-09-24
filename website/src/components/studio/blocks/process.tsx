import { StudioSection } from './section';
import type { BlockProps } from './types';

/**
 * `process` — "Hoe verloopt een bikefit?".
 *
 * The big numerals are content, not decoration: they are the order of the
 * steps, so they stay in the DOM and are read out with the step they belong
 * to. An ordered list carries that meaning to assistive technology as well.
 */
export function ProcessBlock({ data, anchor, headingLevel }: BlockProps<'process'>) {
  return (
    <StudioSection
      variant={data.variant}
      anchor={anchor}
      eyebrow={data.eyebrow}
      title={data.title}
      lede={data.lede}
      headingLevel={headingLevel}
    >
      {data.steps.length > 0 ? (
        <ol className="studio-steps">
          {data.steps.map((step, index) => (
            <li className="studio-step" key={`${step.title}-${index}`}>
              {step.number ? <p className="studio-step__num">{step.number}</p> : null}
              <h3 className="studio-step__title">{step.title}</h3>
              {step.body ? <p className="studio-step__body">{step.body}</p> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </StudioSection>
  );
}
