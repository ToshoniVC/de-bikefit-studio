import type { StudioChrome } from '@/lib/studio/site';
import { PRIMARY_CTA } from '@/lib/studio/site';
import { StudioNavBar } from './nav-bar';

/**
 * The utility bar + sticky header from `prototype/index.html`.
 *
 * The utility bar carries the three facts a visitor most often wants on a
 * phone: where we are, the number to call, and the way to make an appointment.
 * All three come from `cms_site_settings.contact`, so an editor can change the
 * number without a deploy.
 */
export function StudioSiteHeader({ chrome }: { chrome: StudioChrome }) {
  const { settings, mainNav } = chrome;
  const { contact } = settings;

  return (
    <>
      <div className="studio-utility">
        <div className="studio-utility__inner">
          {contact.city ? <span>{contact.city}</span> : null}
          {contact.phoneLabel && contact.phoneHref ? (
            <a href={contact.phoneHref}>{contact.phoneLabel}</a>
          ) : null}
          {contact.hours ? <span>{contact.hours}</span> : null}
        </div>
      </div>

      <header className="studio-header">
        <StudioNavBar items={mainNav} cta={PRIMARY_CTA} siteName={settings.site.name} />
      </header>
    </>
  );
}
