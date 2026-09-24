import type { NavigationItem } from '@/lib/cms/blocks';
import type { StudioChrome } from '@/lib/studio/site';
import { StudioLink } from './link';

/**
 * The burgundy footer from `prototype/index.html`.
 *
 * `logo.svg` is dark ink on a light ground, so the brand column uses the CSS
 * wordmark instead — same text, same meaning for assistive technology.
 *
 * Columns come from the `footer` menu's `group` field, in the order the editor
 * arranged them. The contact column is not a menu: it is rendered from
 * `cms_site_settings.contact`, and every line is omitted when its value is
 * empty (no street address or e-mail is on record yet).
 */
export function StudioSiteFooter({ chrome }: { chrome: StudioChrome }) {
  const { settings, footerNav } = chrome;
  const { contact, site } = settings;
  const groups = groupItems(footerNav);
  const year = new Date().getFullYear();

  return (
    <footer className="studio-footer">
      <div className="studio-footer__grid">
        <div className="studio-footer__col studio-footer__brand">
          <span className="studio-wordmark">{site.name}</span>
          {site.mission ? <p>{site.mission}</p> : null}
        </div>

        {groups.map((group) => (
          <div className="studio-footer__col" key={group.name}>
            <h2>{group.name}</h2>
            <ul>
              {group.items.map((item) => (
                <li key={`${item.href}-${item.label}`}>
                  <StudioLink href={item.href} external={item.external}>
                    {item.label}
                  </StudioLink>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className="studio-footer__col">
          <h2>Contact</h2>
          <ul>
            {contact.phoneLabel && contact.phoneHref ? (
              <li>
                <a href={contact.phoneHref}>{contact.phoneLabel}</a>
              </li>
            ) : null}
            {contact.email ? (
              <li>
                <a href={`mailto:${contact.email}`}>{contact.email}</a>
              </li>
            ) : null}
            {contact.addressLines.filter(Boolean).map((line) => (
              <li key={line}>{line}</li>
            ))}
            {contact.postalCode || contact.city ? (
              <li>{[contact.postalCode, contact.city].filter(Boolean).join(' ')}</li>
            ) : null}
            {contact.website ? <li>{contact.website}</li> : null}
            {contact.hours ? <li>{contact.hours}</li> : null}
          </ul>
        </div>
      </div>

      <div className="studio-footer__bottom">
        <span>
          &copy; {year} {site.name}
        </span>
        <span>{[contact.city, contact.hours].filter(Boolean).join(' · ')}</span>
      </div>
    </footer>
  );
}

type FooterGroup = { name: string; items: NavigationItem[] };

/** Keeps the editor's order; ungrouped items land under the site name. */
function groupItems(items: NavigationItem[]): FooterGroup[] {
  const groups: FooterGroup[] = [];
  for (const item of items) {
    const name = item.group.trim() || 'Studio';
    const existing = groups.find((group) => group.name === name);
    if (existing) existing.items.push(item);
    else groups.push({ name, items: [item] });
  }
  return groups;
}
