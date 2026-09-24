import { SiteHeader } from '@/components/layout/header';
import { SiteFooter } from '@/components/layout/footer';
import { features } from '@/lib/env';

/**
 * The Qarakter webshop's page chrome.
 *
 * It used to live in `src/app/layout.tsx`, which meant every route in the app
 * got it. Now that `/` is the Dutch Bikefit Studio site, the root layout is a
 * bare document shell and this component is mounted by the layout of each
 * webshop route group instead — `(shop)`, `(auth)`, `(content)`, `(webshop)`
 * and `/account`.
 *
 * Same header, `<main>`, footer and `hasAuth` behaviour as before; the only
 * addition is a skip link to `<main id="inhoud">` (CLAUDE.md §6: a skip link
 * in every shell).
 */
export function WebshopChrome({ children }: { children: React.ReactNode }) {
  // Auth UI is only mounted once Clerk is configured, so the app runs key-free.
  const hasClerk = features.clerkUi;

  return (
    <>
      {/* Skip link: first focusable element, visible on focus (same pattern as the Studio shell). */}
      <a
        href="#inhoud"
        className="sr-only focus:not-sr-only focus:absolute focus:left-0 focus:top-0 focus:z-50 focus:bg-primary focus:px-4 focus:py-2 focus:font-display focus:text-sm focus:font-semibold focus:uppercase focus:tracking-wide focus:text-primary-foreground"
      >
        Direct naar de inhoud
      </a>
      <SiteHeader hasAuth={hasClerk} />
      <main id="inhoud" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}

/**
 * Title defaults for the webshop. The root layout's metadata now belongs to the
 * Studio site, so each webshop group layout re-declares these to keep its
 * `%s · Qarakter` titles exactly as they were.
 */
export const webshopMetadata = {
  title: {
    default: 'Qarakter — Boutique Bike Store',
    template: '%s · Qarakter',
  },
  description:
    'Qarakter is a boutique bike store: road, gravel and hand-picked accessories for riders with character.',
} as const;
