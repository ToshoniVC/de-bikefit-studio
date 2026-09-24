import type { SectionVariant } from '@/lib/cms/blocks';

/**
 * The shared section shell: background variant, container, eyebrow, heading and
 * lede, exactly as `prototype/design-system/components.css` defines them.
 *
 * `headingLevel` is passed down from the page so a document has exactly one
 * `<h1>`: the first hero (or, if a page has no hero, the first section) owns
 * it, and every other section is an `<h2>`.
 */

export type HeadingLevel = 1 | 2;

export function sectionClass(variant: SectionVariant): string {
  const suffix = variant === 'default' ? '' : ` studio-section--${variant}`;
  return `studio-section${suffix}`;
}

export function SectionHeading({
  level,
  children,
  className = 'studio-section__title',
}: {
  level: HeadingLevel;
  children: React.ReactNode;
  className?: string;
}) {
  const Tag = level === 1 ? 'h1' : 'h2';
  return <Tag className={className}>{children}</Tag>;
}

export function StudioSection({
  variant,
  anchor,
  eyebrow,
  title,
  lede,
  headingLevel,
  children,
}: {
  variant: SectionVariant;
  anchor?: string;
  eyebrow?: string;
  title?: string;
  lede?: string;
  headingLevel: HeadingLevel;
  children?: React.ReactNode;
}) {
  return (
    <section className={sectionClass(variant)} {...(anchor ? { id: anchor } : {})}>
      <div className="studio-section__inner">
        {eyebrow ? <p className="studio-eyebrow">{eyebrow}</p> : null}
        {title ? <SectionHeading level={headingLevel}>{title}</SectionHeading> : null}
        {lede ? <p className="studio-section__lede">{lede}</p> : null}
        {children}
      </div>
    </section>
  );
}
