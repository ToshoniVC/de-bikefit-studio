import Link from 'next/link';
import { Suspense } from 'react';

import { AnalyticsPanel } from '@/components/admin/analytics-panel';
import { PageHeading } from '@/components/admin/shell';
import { UpcomingBookingsCard } from '@/components/admin/upcoming-bookings-card';
import { Badge } from '@/components/ui/badge';
import { listBookings } from '@/lib/booking/repo';
import { requireCmsUser } from '@/lib/cms/auth';
import { can, type CmsPermission } from '@/lib/cms/permissions';
import { getAdminStats, listAuditLog } from '@/lib/cms/repo';

export const metadata = { title: 'Overzicht' };

export default async function AdminHomePage() {
  const user = await requireCmsUser();
  const canSeeContent = can(user.role, 'page.read');
  const readAllBookings = can(user.role, 'booking.read');
  const canSeeBookings = readAllBookings || can(user.role, 'booking.read.own');

  const [stats, recent, upcoming] = await Promise.all([
    getAdminStats(),
    can(user.role, 'audit.read') ? listAuditLog(8) : Promise.resolve([]),
    canSeeBookings
      ? // Scoped by the repo: everything with `booking.read`, else only one's own.
        listBookings({ range: 'upcoming', withinDays: 7, status: 'confirmed', limit: 12 })
      : Promise.resolve([]),
  ]);

  const tiles: Array<{ label: string; value: number; href: string; permission: CmsPermission }> = [
    { label: 'Pagina’s', value: stats.pages, href: '/admin/pages', permission: 'page.read' },
    {
      label: 'Gepubliceerd',
      value: stats.published,
      href: '/admin/pages?status=published',
      permission: 'page.read',
    },
    { label: 'Media', value: stats.media, href: '/admin/media', permission: 'media.read' },
    {
      label: 'Redirects',
      value: stats.redirects,
      href: '/admin/redirects',
      permission: 'redirect.read',
    },
  ];
  const visibleTiles = tiles.filter((tile) => can(user.role, tile.permission));

  return (
    <>
      <PageHeading
        title={`Dag ${user.name || user.email}`}
        description={
          canSeeContent
            ? 'Beheer de inhoud van de publieke website.'
            : 'Je afspraken en agenda in één oogopslag.'
        }
      />

      <div className="flex flex-col gap-6">
        {can(user.role, 'analytics.read') ? (
          <Suspense
            fallback={
              <section className="border border-border bg-card p-5 text-sm text-muted-foreground sm:p-6">
                Google Analytics laden…
              </section>
            }
          >
            <AnalyticsPanel />
          </Suspense>
        ) : null}

        {canSeeBookings ? (
          <UpcomingBookingsCard bookings={upcoming} showProvider={readAllBookings} />
        ) : null}

        {visibleTiles.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-px border border-border bg-border">
            {visibleTiles.map((tile) => (
              <Link
                key={tile.label}
                href={tile.href}
                className="border-t-2 border-transparent bg-card p-5 transition-colors hover:border-primary hover:bg-muted"
              >
                <p className="admin-label text-xs text-muted-foreground">{tile.label}</p>
                <p className="mt-1 font-ds-display text-4xl leading-none font-semibold tabular-nums">
                  {tile.value}
                </p>
              </Link>
            ))}
          </div>
        ) : null}

        {recent.length > 0 ? (
          <section className="border border-border bg-card p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl leading-tight">Recente wijzigingen</h2>
              <Link
                href="/admin/audit"
                className="text-sm underline underline-offset-4 hover:text-primary"
              >
                Volledig auditlog
              </Link>
            </div>
            <ul className="flex flex-col divide-y divide-border border-y border-border text-xs">
              {recent.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center gap-2 py-2">
                  <Badge variant="outline">{entry.action}</Badge>
                  <span className="text-muted-foreground">{entry.userEmail ?? 'systeem'}</span>
                  {entry.summary ? <span className="truncate">{entry.summary}</span> : null}
                  <span className="ml-auto text-muted-foreground">
                    {new Date(entry.createdAt).toLocaleString('nl-BE', {
                      timeZone: 'Europe/Brussels',
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}
