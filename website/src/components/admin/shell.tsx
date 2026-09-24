import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AdminNav, type AdminNavItem } from '@/components/admin/nav';
import { logoutAction } from '@/lib/cms/actions/auth';
import { can, ROLE_LABELS, type CmsPermission } from '@/lib/cms/permissions';
import type { CmsUserPublic } from '@/db/cms-schema';

/**
 * Admin chrome: sidebar, role badge, sign-out.
 *
 * Navigation entries are filtered with `can()`, but that is only cosmetic —
 * every server action and every repo call re-checks the same permission on the
 * server, so a hidden link is never the protection.
 */

const NAV: Array<AdminNavItem & { permission?: CmsPermission }> = [
  { href: '/admin', label: 'Overzicht' },
  { href: '/admin/pages', label: 'Pagina’s', permission: 'page.read' },
  { href: '/admin/media', label: 'Media', permission: 'media.read' },
  { href: '/admin/navigation', label: 'Menu’s', permission: 'navigation.read' },
  { href: '/admin/redirects', label: 'Redirects', permission: 'redirect.read' },
  { href: '/admin/settings', label: 'Instellingen', permission: 'settings.read' },
  { href: '/admin/users', label: 'Gebruikers', permission: 'user.read' },
  { href: '/admin/audit', label: 'Auditlog', permission: 'audit.read' },
  { href: '/admin/account', label: 'Mijn account' },
];

export function AdminShell({
  user,
  children,
}: {
  user: CmsUserPublic;
  children: React.ReactNode;
}) {
  const items = NAV.filter((item) => !item.permission || can(user.role, item.permission)).map(
    ({ href, label }) => ({ href, label }),
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:flex-row">
        <aside className="lg:w-56 lg:shrink-0">
          <div className="mb-4">
            <Link href="/admin" className="font-heading text-lg font-semibold tracking-tight">
              De Bikefit Studio
            </Link>
            <p className="text-xs text-muted-foreground">Beheer</p>
          </div>

          <AdminNav items={items} />

          <div className="mt-6 rounded-lg bg-muted/40 p-2.5 text-xs">
            <p className="font-medium break-all">{user.name || user.email}</p>
            <p className="text-muted-foreground break-all">{user.email}</p>
            <Badge variant={user.role === 'admin' ? 'default' : 'secondary'} className="mt-1.5">
              {ROLE_LABELS[user.role]}
            </Badge>
            <form action={logoutAction} className="mt-2">
              <Button type="submit" size="xs" variant="outline" className="w-full">
                Afmelden
              </Button>
            </form>
          </div>
        </aside>

        <main className="min-w-0 flex-1 pb-12">{children}</main>
      </div>
    </div>
  );
}

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
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
