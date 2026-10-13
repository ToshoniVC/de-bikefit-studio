import type { StudioChrome } from '@/lib/studio/site';
import { PRIMARY_CTA } from '@/lib/studio/site';
import { StudioNavBar } from './nav-bar';

/**
 * The sticky header from `prototype/index.html`: logo, main menu and the
 * "Afspraak maken" button.
 *
 * The prototype's utility bar above it (city, phone, hours) was removed at
 * Toshoni's request (13 Oct 2026); the footer still shows the phone number,
 * place and hours from `cms_site_settings.contact`.
 */
export function StudioSiteHeader({ chrome }: { chrome: StudioChrome }) {
  const { settings, mainNav } = chrome;

  return (
    <header className="studio-header">
      <StudioNavBar items={mainNav} cta={PRIMARY_CTA} siteName={settings.site.name} />
    </header>
  );
}
