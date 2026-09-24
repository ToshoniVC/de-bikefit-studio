'use client';

import { useEffect, useId, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavigationItem } from '@/lib/cms/blocks';
import { StudioLink, splitArrow } from './link';

/**
 * Primary navigation.
 *
 * Desktop: a horizontal list with the active item underlined.
 * ≤900px: the same list collapses behind a hamburger disclosure — one button
 * that owns `aria-expanded` and `aria-controls`, 48px tap targets, closes on
 * Escape, on outside navigation and whenever the route changes.
 *
 * The menu is in the DOM at every width (CSS hides it), so it is always
 * crawlable and it degrades to a plain list if hydration never happens.
 */
export function StudioNavBar({
  items,
  cta,
  siteName,
}: {
  items: NavigationItem[];
  cta: { label: string; href: string };
  siteName: string;
}) {
  const menuId = useId();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  function isActive(href: string): boolean {
    if (!href.startsWith('/')) return false;
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav className="studio-nav" aria-label="Hoofdnavigatie">
      <Link href="/" className="studio-nav__logo" aria-label={`${siteName} — naar de homepagina`}>
        <Image src="/logo.svg" alt={siteName} width={64} height={48} priority />
      </Link>

      <button
        type="button"
        className="studio-nav__toggle"
        aria-controls={menuId}
        aria-expanded={open}
        aria-label={open ? 'Menu sluiten' : 'Menu openen'}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="studio-nav__bars" aria-hidden="true" />
      </button>

      {/* Following a link — including an in-page anchor, which does not change
          the route — has done what the panel was opened for, so it closes.
          The handler sits on the list rather than on every item so it also
          covers links an editor adds later. */}
      <ul
        className="studio-nav__menu"
        id={menuId}
        data-open={open ? 'true' : 'false'}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('a')) setOpen(false);
        }}
      >
        {items.map((item) => (
          <li key={`${item.href}-${item.label}`}>
            <StudioLink
              href={item.href}
              external={item.external}
              {...(isActive(item.href) ? { 'aria-current': 'page' as const } : {})}
            >
              {item.label}
            </StudioLink>
          </li>
        ))}
      </ul>

      <StudioLink href={cta.href} className="studio-btn studio-btn--primary studio-nav__cta">
        {splitArrow(cta.label)}
        <span className="studio-btn__arrow" aria-hidden="true">
          &rarr;
        </span>
      </StudioLink>
    </nav>
  );
}
