import Link from 'next/link';

/**
 * One link component for every href the CMS can produce: internal paths
 * (`/bikefit`), in-page anchors (`#vragen`), `tel:` URIs (the studio's main
 * call-to-action dials the phone) and absolute URLs.
 *
 * Internal paths go through `next/link` for client-side navigation; everything
 * else is a plain anchor. External http(s) links get `rel="noopener noreferrer"`.
 */

export type StudioLinkProps = {
  href: string;
  external?: boolean;
  className?: string;
  children: React.ReactNode;
  'aria-current'?: 'page';
  'aria-label'?: string;
};

/**
 * `true` for a site-relative path (`/bikefit`). Browsers drop tabs and line
 * breaks from URLs and read `\` as `/`, so `/\evil.example`, `\evil.example`
 * and `/<tab>/evil.example` all leave the site like `//evil.example` does;
 * those count as external.
 */
export function isInternalPath(href: string): boolean {
  if (href.startsWith('\\')) return false;
  const normalized = href.replace(/[\t\n\r]/g, '').replace(/\\/g, '/');
  return normalized.startsWith('/') && !normalized.startsWith('//');
}

export function StudioLink({ href, external, children, ...rest }: StudioLinkProps) {
  const absolute = /^https?:\/\//i.test(href);

  if (isInternalPath(href) && !external && !absolute) {
    return (
      <Link href={href} {...rest}>
        {children}
      </Link>
    );
  }

  return (
    <a
      href={href}
      {...(absolute ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      {...rest}
    >
      {children}
    </a>
  );
}

/**
 * A call-to-action in the design system's button skin. The arrow is decorative
 * — the label always says where the link goes, so screen readers are not told
 * about a "right arrow".
 */
export function StudioButtonLink({
  href,
  external,
  variant = 'primary',
  arrow = true,
  className,
  children,
}: StudioLinkProps & {
  variant?: 'primary' | 'outline' | 'ghost' | 'ghost-on-dark' | 'dark';
  arrow?: boolean;
}) {
  return (
    <StudioLink
      href={href}
      external={external}
      className={`studio-btn studio-btn--${variant}${className ? ` ${className}` : ''}`}
    >
      {children}
      {arrow ? (
        <span className="studio-btn__arrow" aria-hidden="true">
          &rarr;
        </span>
      ) : null}
    </StudioLink>
  );
}

/**
 * CTA labels in the copy deck already end in an arrow ("Boek je bikefit →").
 * The arrow is styling, not content, so it is stripped from the label and
 * re-added as the decorative `.studio-btn__arrow` span.
 */
export function splitArrow(label: string): string {
  return label.replace(/\s*(→|->|&rarr;)\s*$/u, '').trim() || label;
}
