import { SiteHeader } from '@/components/layout/header';
import { SiteFooter } from '@/components/layout/footer';

/**
 * The Qarakter webshop's page chrome.
 *
 * It used to live in `src/app/layout.tsx`, which meant every route in the app
 * got it. Now that `/` is the Dutch Bikefit Studio site, the root layout is a
 * bare document shell and this component is mounted by the layout of each
 * webshop route group instead — `(shop)`, `(auth)`, `(content)`, `(webshop)`
 * and `/account`.
 *
 * Nothing about the markup changed: same header, same `<main>`, same footer,
 * same `hasAuth` behaviour. Webshop pages render byte-identically to before.
 */
export function WebshopChrome({ children }: { children: React.ReactNode }) {
  // Auth UI is only mounted once Clerk is configured, so the app runs key-free.
  const hasClerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  return (
    <>
      <SiteHeader hasAuth={hasClerk} />
      <main className="flex-1">{children}</main>
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
