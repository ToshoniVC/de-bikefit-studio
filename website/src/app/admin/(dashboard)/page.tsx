import Link from 'next/link';

import { PageHeading } from '@/components/admin/shell';
import { Badge } from '@/components/ui/badge';
import { requireCmsUser } from '@/lib/cms/auth';
import { can } from '@/lib/cms/permissions';
import { getAdminStats, listAuditLog } from '@/lib/cms/repo';

export const metadata = { title: 'Overzicht' };

export default async function AdminHomePage() {
  const user = await requireCmsUser();
  const stats = await getAdminStats();
  const recent = can(user.role, 'audit.read') ? await listAuditLog(8) : [];

  const tiles = [
    { label: 'Pagina’s', value: stats.pages, href: '/admin/pages' },
    { label: 'Gepubliceerd', value: stats.published, href: '/admin/pages?status=published' },
    { label: 'Media', value: stats.media, href: '/admin/media' },
    { label: 'Redirects', value: stats.redirects, href: '/admin/redirects' },
  ];

  return (
    <>
      <PageHeading
        title={`Dag ${user.name || user.email}`}
        description="Beheer de inhoud van de publieke website."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <Link
            key={tile.label}
            href={tile.href}
            className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-colors hover:bg-muted/40"
          >
            <p className="text-xs text-muted-foreground">{tile.label}</p>
            <p className="font-heading text-2xl font-semibold">{tile.value}</p>
          </Link>
        ))}
      </div>

      {recent.length > 0 ? (
        <section className="mt-6 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-heading text-base font-semibold">Recente wijzigingen</h2>
            <Link href="/admin/audit" className="text-xs underline underline-offset-4">
              Volledig auditlog
            </Link>
          </div>
          <ul className="flex flex-col gap-1.5 text-xs">
            {recent.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{entry.action}</Badge>
                <span className="text-muted-foreground">{entry.userEmail ?? 'systeem'}</span>
                {entry.summary ? <span className="truncate">{entry.summary}</span> : null}
                <span className="ml-auto text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleString('nl-BE')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
