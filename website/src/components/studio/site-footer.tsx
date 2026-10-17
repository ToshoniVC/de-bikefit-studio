import type { NavigationItem } from '@/lib/cms/blocks';
import { LEGAL_LINKS } from '@/lib/studio/legal';
import type { StudioChrome } from '@/lib/studio/site';
import { studioMeasurementId } from './analytics';
import { ConsentSettingsLink } from './consent-banner';
import { StudioLink } from './link';
import { StudioLogo } from './logo';

/**
 * The burgundy footer from `prototype/index.html`.
 *
 * The brand column shows the lockup in its inverted colours (the cream mark
 * and the wordmark in the display face, `./logo.tsx`): the same text and
 * meaning for assistive technology as the header.
 *
 * Columns come from the `footer` menu's `group` field, in the order the editor
 * arranged them. The contact column is not a menu: it is rendered from
 * `cms_site_settings.contact`, and every line is omitted when its value is
 * empty (no street address or e-mail is on record yet).
 *
 * The legal row under the bottom bar is not a menu either, so it exists on
 * every deployment whatever the menu rows say:
 *  - hard links to the privacy statement and the terms, skipped when the
 *    footer menu already links the same path (the seed's "Juridisch" group);
 *  - "Cookies", which reopens the consent banner — only where analytics can
 *    load at all (same guard as the banner), otherwise there is no choice.
 * The row is left out when it would be empty.
 *
 * The company identity line (Qarakter BV, registered office, BTW, RPR) and
 * the "city · hours" note in the bottom bar were removed at Toshoni's request
 * (review 13 Oct 2026). The identity stays on `/privacy` and
 * `/algemene-voorwaarden`, linked from every page, and in `LEGAL_IDENTITY`
 * for the e-mails; the public e-mail address is in the contact column.
 */
export function StudioSiteFooter({ chrome }: { chrome: StudioChrome }) {
  const { settings, footerNav } = chrome;
  const { contact, site } = settings;
  const groups = groupItems(footerNav);
  const year = new Date().getFullYear();

  const menuHrefs = new Set(
    footerNav
      .flatMap((item) => [item.href, ...item.children.map((child) => child.href)])
      .map(pathKey),
  );
  const legalLinks = [
    { label: 'Privacyverklaring', href: LEGAL_LINKS.privacy },
    { label: 'Algemene voorwaarden', href: LEGAL_LINKS.terms },
  ].filter((link) => !menuHrefs.has(pathKey(link.href)));
  const showCookies = studioMeasurementId(settings) !== null;

  return (
    <footer className="studio-footer">
      <div className="studio-footer__grid">
        <div className="studio-footer__col studio-footer__brand">
          <StudioLogo siteName={site.name} tone="dark" />
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
      </div>

      {legalLinks.length > 0 || showCookies ? (
        <div className="studio-footer__bottom studio-footer__legal">
          <ul className="studio-footer__legal-links">
            {legalLinks.map((link) => (
              <li key={link.href}>
                <StudioLink href={link.href}>{link.label}</StudioLink>
              </li>
            ))}
            {showCookies ? (
              <li>
                <ConsentSettingsLink className="studio-footer__cookies" />
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </footer>
  );
}

/** `/privacy/` and `/privacy` count as the same destination. */
function pathKey(href: string): string {
  return href.trim().replace(/\/+$/, '') || '/';
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
