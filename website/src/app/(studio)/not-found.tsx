import Link from 'next/link';

/**
 * 404 inside the Studio site. It renders inside `(studio)/layout.tsx`, so the
 * visitor keeps the header, the navigation and the footer and can carry on
 * instead of hitting a dead end.
 */
export default function StudioNotFound() {
  return (
    <div className="studio-notfound">
      <p className="studio-eyebrow">Foutmelding 404</p>
      <h1 className="studio-pagehead__title">Deze pagina bestaat niet</h1>
      <div className="studio-rich studio-stack">
        <p>
          Misschien is de link verouderd of is er een tikfout geslopen in het adres. Onderstaande
          pagina&apos;s helpen je verder.
        </p>
        <ul>
          <li>
            <Link href="/">Naar de homepagina</Link>
          </li>
          <li>
            <Link href="/bikefit">Wat is een bikefit?</Link>
          </li>
          <li>
            <Link href="/contact">Contact opnemen</Link>
          </li>
        </ul>
      </div>
    </div>
  );
}
