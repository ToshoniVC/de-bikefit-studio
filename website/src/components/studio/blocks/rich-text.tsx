import { sectionClass, SectionHeading } from './section';
import type { BlockProps } from './types';

/**
 * `richText` — free prose.
 *
 * The HTML is sanitised on every write by `repo.updateBlock()` — admin edits
 * and the seed alike — with the allowlist in `src/lib/cms/actions/sanitize.ts`
 * (`p`, `br`, `h2`–`h4`, lists, links, emphasis, `blockquote`; no attributes
 * except on links, no scripts or styles), then frozen into the published
 * snapshot. It is injected as-is so those headings, lists and links survive;
 * `.studio-rich` styles them.
 */
export function RichTextBlock({ data, anchor, headingLevel }: BlockProps<'richText'>) {
  return (
    <section className={sectionClass(data.variant)} {...(anchor ? { id: anchor } : {})}>
      <div className="studio-section__inner">
        {data.eyebrow ? <p className="studio-eyebrow">{data.eyebrow}</p> : null}
        {data.title ? <SectionHeading level={headingLevel}>{data.title}</SectionHeading> : null}
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
