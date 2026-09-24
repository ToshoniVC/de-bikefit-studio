import { ForbiddenNotice } from '@/components/admin/forbidden';
import { UsersManager, type UserRow } from '@/components/admin/users-manager';
import { PageHeading } from '@/components/admin/shell';
import { listCmsUsers, requireCmsUser } from '@/lib/cms/auth';
import { can } from '@/lib/cms/permissions';

export const metadata = { title: 'Gebruikers' };

export default async function AdminUsersPage() {
  const user = await requireCmsUser();
  if (!can(user.role, 'user.read')) return <ForbiddenNotice what="het gebruikersbeheer" />;

  const users: UserRow[] = (await listCmsUsers()).map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
    lastLoginAt: row.lastLoginAt ? new Date(row.lastLoginAt).toISOString() : null,
  }));

  return (
    <>
      <PageHeading
        title="Gebruikers"
        description="Beheerders kunnen alles; redacteurs kunnen inhoud bewerken maar niet publiceren."
      />
      <UsersManager users={users} currentUserId={user.id} />
    </>
  );
}
