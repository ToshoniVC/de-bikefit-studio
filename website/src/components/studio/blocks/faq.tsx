import { StudioSection } from './section';
import type { BlockProps } from './types';

/**
 * `faq` — "Veelgestelde vragen".
 *
 * Both shapes keep the question in a heading, so the list is navigable by
 * heading in a screen reader and every answer stays in the HTML (an answer
 * hidden behind JavaScript is an answer a crawler never sees). `collapsible`
 * uses `<details>`/`<summary>`, which needs no JavaScript at all.
 *
 * Whatever is rendered here is exactly what `faqJsonLd()` emits when
 * `emitStructuredData` is on — the two can never drift, because both read the
 * same `data.items`.
 */
export function FaqBlock({ data, anchor, headingLevel }: BlockProps<'faq'>) {
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
        <div className="studio-faq">
          {data.items.map((item, index) =>
            data.collapsible ? (
              <details className="studio-faq__item" key={`${item.question}-${index}`}>
                <summary>
                  <h3 className="studio-faq__q">{item.question}</h3>
                </summary>
                <p className="studio-faq__a">{item.answer}</p>
              </details>
            ) : (
              <div className="studio-faq__item" key={`${item.question}-${index}`}>
                <h3 className="studio-faq__q">{item.question}</h3>
                <p className="studio-faq__a">{item.answer}</p>
              </div>
            ),
          )}
        </div>
      ) : null}
    </StudioSection>
  );
}
