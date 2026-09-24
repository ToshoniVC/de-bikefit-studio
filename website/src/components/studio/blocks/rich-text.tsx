import { sectionClass, SectionHeading } from './section';
import type { BlockProps } from './types';

/**
 * `richText` — free prose.
 *
 * The HTML is sanitised on write (admin side) and then frozen into the
 * published snapshot, so what arrives here has already been through validation
 * at publish time. It is injected as-is to keep the editor's markup —
 * headings, lists, links — intact; `.studio-rich` styles those elements.
 */
export function RichTextBlock({ data, anchor, headingLevel }: BlockProps<'richText'>) {
  return (
    <section className={sectionClass(data.variant)} {...(anchor ? { id: anchor } : {})}>
      <div className="studio-section__inner">
        {data.eyebrow ? <p className="studio-eyebrow">{data.eyebrow}</p> : null}
        {data.title ? (
          <SectionHeading level={headingLevel}>{data.title}</SectionHeading>
        ) : null}
        {data.html ? (
          <div
            className={`studio-rich${data.variant === 'dark' ? ' studio-rich--invert' : ''}`}
            dangerouslySetInnerHTML={{ __html: data.html }}
          />
        ) : null}
      </div>
    </section>
  );
}
