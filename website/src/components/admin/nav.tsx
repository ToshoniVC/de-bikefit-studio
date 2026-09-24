'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

export type AdminNavItem = { href: string; label: string };

/**
 * Sidebar links with an active state. Only links the role may use are passed in.
 *
 * Set in the public menu's condensed caps. On the burgundy sidebar the accent
 * is cream, so the active item is a cream tab with burgundy text (the public
 * `.studio-btn--dark`); the rest are rose, cream on hover. Below `lg` the list
 * wraps into a row of tabs above the content.
 */
export function AdminNav({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-1 lg:flex-col lg:flex-nowrap lg:gap-0.5" aria-label="Beheer">
      {items.map((item) => {
        const active =
          item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'px-3 py-1.5 font-ds-display text-[15px] font-semibold tracking-[0.06em] uppercase transition-colors',
              active
                ? 'bg-ds-cream-300 text-ds-burgundy-700'
                : 'text-ds-rose-400 hover:bg-ds-burgundy-600 hover:text-ds-cream-300',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
