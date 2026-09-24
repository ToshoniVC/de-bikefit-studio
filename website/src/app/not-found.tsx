import type { Metadata } from 'next';
import Link from 'next/link';

/**
 * Application-level 404, rendered inside the bare root layout.
 *
 * Almost every unknown URL is claimed by the Studio catch-all
 * (`src/app/(studio)/[...slug]/page.tsx`), which renders the richer
 * `(studio)/not-found.tsx` with the full site chrome. This file is the
 * fallback for a `notFound()` thrown inside a route that has no closer
 * boundary — a missing product or blog post, for instance — so it offers a way
 * back into both sites.
 */
export const metadata: Metadata = {
  title: { absolute: 'Pagina niet gevonden · De Bikefit Studio' },
  robots: { index: false, follow: false },
};

export default function RootNotFound() {
  return (
    <div className="studio-root flex min-h-full flex-1 flex-col">
      <div className="studio-notfound">
        <p className="studio-eyebrow">Foutmelding 404</p>
        <h1 className="studio-pagehead__title">Pagina niet gevonden</h1>
        <div className="studio-rich studio-stack">
          <p>Deze pagina bestaat niet (meer).</p>
          <ul>
            <li>
              <Link href="/">De Bikefit Studio — homepagina</Link>
            </li>
            <li>
              <Link href="/shop">Qarakter webshop</Link>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
