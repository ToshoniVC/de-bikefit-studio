import { ForbiddenNotice } from '@/components/admin/forbidden';
import { RedirectsManager, type RedirectRow } from '@/components/admin/redirects-manager';
import { PageHeading } from '@/components/admin/shell';
import { requireCmsUser } from '@/lib/cms/auth';
import { can } from '@/lib/cms/permissions';
import { listAllRedirects } from '@/lib/cms/repo';

export const metadata = { title: 'Redirects' };

export default async function AdminRedirectsPage() {
  const user = await requireCmsUser();
  if (!can(user.role, 'redirect.read')) return <ForbiddenNotice what="de redirects" />;

  const redirects: RedirectRow[] = (await listAllRedirects()).map((redirect) => ({
    id: redirect.id,
    fromPath: redirect.fromPath,
    toPath: redirect.toPath,
    statusCode: redirect.statusCode,
    isEnabled: redirect.isEnabled,
    notes: redirect.notes,
  }));

  return (
    <>
      <PageHeading
        title="Redirects"
        description="Oude paden doorsturen naar nieuwe. 301 is permanent, 302 tijdelijk."
      />
      <RedirectsManager redirects={redirects} canManage={can(user.role, 'redirect.manage')} />
    </>
  );
}
