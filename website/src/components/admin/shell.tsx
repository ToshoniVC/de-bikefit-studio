import Link from 'next/link';
import { ExternalLink } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AdminNav, type AdminNavItem } from '@/components/admin/nav';
import { logoutAction } from '@/lib/cms/actions/auth';
import { can, ROLE_LABELS, type CmsPermission } from '@/lib/cms/permissions';
import { cn } from '@/lib/utils';
import type { CmsUserPublic } from '@/db/cms-schema';

/**
 * Admin chrome: sidebar, role badge, sign-out.
 *
 * Navigation entries are filtered with `can()`, but that is only cosmetic —
 * every server action and every repo call re-checks the same permission on the
 * server, so a hidden link is never the protection.
 *
 * Styling: `studio-root admin-root` puts the whole admin on the public site's
 * design system (see the "Worker F" block at the end of `globals.css`). The
 * sidebar is the burgundy of the public footer, with the same CSS wordmark;
 * on small screens it stacks above the content, so "Bekijk website" stays the
 * first visible control top left at every width.
 */

/** `permission` must be held; `anyOf` needs at least one of the listed permissions. */
const NAV: Array<AdminNavItem & { permission?: CmsPermission; anyOf?: CmsPermission[] }> = [
  { href: '/admin', label: 'Overzicht' },
  { href: '/admin/bookings', label: 'Afspraken', anyOf: ['booking.read', 'booking.read.own'] },
  { href: '/admin/agenda', label: 'Mijn agenda', permission: 'provider.self' },
  { href: '/admin/services', label: 'Diensten', permission: 'service.read' },
  { href: '/admin/locations', label: 'Locaties', permission: 'location.read' },
  { href: '/admin/providers', label: 'Aanbieders', permission: 'provider.read' },
  { href: '/admin/pages', label: 'Pagina’s', permission: 'page.read' },
  { href: '/admin/media', label: 'Media', permission: 'media.read' },
  { href: '/admin/navigation', label: 'Menu’s', permission: 'navigation.read' },
  { href: '/admin/redirects', label: 'Redirects', permission: 'redirect.read' },
  { href: '/admin/settings', label: 'Instellingen', permission: 'settings.read' },
  { href: '/admin/users', label: 'Gebruikers', permission: 'user.read' },
  { href: '/admin/audit', label: 'Auditlog', permission: 'audit.read' },
  { href: '/admin/account', label: 'Mijn account' },
];

export function AdminShell({ user, children }: { user: CmsUserPublic; children: React.ReactNode }) {
  const items = NAV.filter(
    (item) =>
      (!item.permission || can(user.role, item.permission)) &&
      (!item.anyOf || item.anyOf.some((permission) => can(user.role, permission))),
  ).map(({ href, label }) => ({ href, label }));

  return (
    <div className="studio-root admin-root flex min-h-screen flex-col lg:flex-row">
      {/* Same pattern as the public layout: off-screen until it takes focus. */}
      <a className="studio-skip" href="#inhoud">
        Ga naar inhoud
      </a>

      <aside className="admin-sidebar bg-ds-surface-inverse text-ds-rose-400 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col lg:overflow-y-auto">
        <div className="flex flex-col gap-6 px-5 py-5 lg:flex-1 lg:py-8">
          <div className="flex flex-col items-start gap-4">
            <div>
              <p className="mb-2 font-ds-display text-xs tracking-[0.22em] text-ds-mauve-400 uppercase">
                Beheer
              </p>
              <span className="studio-wordmark">De Bikefit Studio</span>
            </div>

            <Link
              href="/"
              target="_blank"
              rel="noopener noreferrer"
              prefetch={false}
              aria-label="Bekijk website (opent in nieuw tabblad)"
              className="studio-btn studio-btn--ghost-on-dark gap-2 px-3 py-2 text-sm"
            >
              <ExternalLink aria-hidden="true" className="size-4" />
              Bekijk website
            </Link>
          </div>

          <AdminNav items={items} />

          <div className="border-t border-ds-burgundy-500 pt-4 text-xs lg:mt-auto">
            <p className="font-medium break-all text-ds-cream-300">{user.name || user.email}</p>
            <p className="break-all">{user.email}</p>
            <Badge
              variant={user.role === 'admin' ? 'default' : 'secondary'}
              className={cn(
                'mt-2',
                user.role === 'admin'
                  ? 'bg-ds-cream-300 text-ds-burgundy-700'
                  : 'bg-ds-burgundy-600 text-ds-cream-250',
              )}
            >
              {ROLE_LABELS[user.role]}
            </Badge>
            <form action={logoutAction} className="mt-3">
              <Button
                type="submit"
                size="xs"
                variant="outline"
                className="w-full border-ds-cream-300/60 bg-transparent text-ds-cream-300 hover:bg-ds-cream-300 hover:text-ds-burgundy-700"
              >
                Afmelden
              </Button>
            </form>
          </div>
        </div>
      </aside>

      <main
        id="inhoud"
        tabIndex={-1}
        className="min-w-0 flex-1 px-4 py-8 outline-none sm:px-8 lg:px-12 lg:py-10"
      >
        <div className="mx-auto w-full max-w-6xl pb-12">{children}</div>
      </main>
    </div>
  );
}

/** Title + lede for every admin screen, in the shape of the public `.studio-pagehead`. */
export function PageHeading({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
      <div className="min-w-0">
        <h1 className="text-3xl leading-none break-words sm:text-4xl">{title}</h1>
        {description ? (
          <p className="mt-3 max-w-[65ch] text-base text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}

/**
 * Centred card for the screens outside the dashboard (sign in, forced password
 * change, sign out): burgundy band with the wordmark, then the title and form.
 */
export function AdminAuthFrame({
  title,
  description,
  wide = false,
  centered = false,
  children,
}: {
  title: string;
  description?: string;
  wide?: boolean;
  centered?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="studio-root admin-root flex min-h-screen flex-col">
      <a className="studio-skip" href="#inhoud">
        Ga naar inhoud
      </a>
      <main
        id="inhoud"
        tabIndex={-1}
        className="flex flex-1 items-center justify-center px-4 py-12 outline-none"
      >
        <div
          className={cn(
            'w-full border border-border bg-card',
            wide ? 'max-w-md' : 'max-w-sm',
            centered && 'text-center',
          )}
        >
          <div className="bg-ds-surface-inverse px-6 py-5">
            <span className="studio-wordmark">De Bikefit Studio</span>
          </div>
          <div className="p-6">
            <h1 className="text-3xl leading-none">{title}</h1>
            {description ? (
              <p className="mt-3 mb-5 text-sm text-muted-foreground">{description}</p>
            ) : (
              <div className="mb-5" />
            )}
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
