import { Badge } from '@/components/ui/badge';
import { ForbiddenNotice } from '@/components/admin/forbidden';
import { PageHeading } from '@/components/admin/shell';
import { requireCmsUser } from '@/lib/cms/auth';
import { can } from '@/lib/cms/permissions';
import { listAuditLog } from '@/lib/cms/repo';

export const metadata = { title: 'Auditlog' };

export default async function AdminAuditPage() {
  const user = await requireCmsUser();
  if (!can(user.role, 'audit.read')) return <ForbiddenNotice what="het auditlog" />;

  const entries = await listAuditLog(200);

  return (
    <>
      <PageHeading
        title="Auditlog"
        description="Wie deed wat, wanneer. De laatste 200 gebeurtenissen."
      />

      <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border/60 text-xs text-muted-foreground">
            <tr>
              <th className="p-3 font-medium">Tijdstip</th>
              <th className="p-3 font-medium">Gebruiker</th>
              <th className="p-3 font-medium">Actie</th>
              <th className="p-3 font-medium">Object</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-6 text-center text-muted-foreground">
                  Nog geen gebeurtenissen.
                </td>
              </tr>
            ) : null}
            {entries.map((entry) => (
              <tr key={entry.id} className="border-b border-border/40 last:border-0 align-top">
                <td className="p-3 text-xs whitespace-nowrap text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleString('nl-BE')}
                </td>
                <td className="p-3 text-xs break-all">{entry.userEmail ?? 'systeem'}</td>
                <td className="p-3">
                  <Badge variant="outline">{entry.action}</Badge>
                </td>
                <td className="p-3 text-xs text-muted-foreground">
                  <span className="block">{entry.entityType}</span>
                  {entry.summary ? <span className="block">{entry.summary}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
