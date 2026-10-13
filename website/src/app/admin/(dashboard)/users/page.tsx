import { SectionCard } from '@/components/admin/form';
import { ForbiddenNotice } from '@/components/admin/forbidden';
import { MfaResetUserForm } from '@/components/admin/mfa/reset-user-form';
import { UsersManager, type UserRow } from '@/components/admin/users-manager';
import { PageHeading } from '@/components/admin/shell';
import { requireCmsUser } from '@/lib/cms/auth';
import { listMfaEnrolledUserIds } from '@/lib/cms/mfa/manage';
import { listCmsUsers } from '@/lib/cms/users';
import { can } from '@/lib/cms/permissions';

export const metadata = { title: 'Gebruikers' };

export default async function AdminUsersPage() {
  const user = await requireCmsUser();
  if (!can(user.role, 'user.read')) return <ForbiddenNotice what="het gebruikersbeheer" />;

  const enrolled = await listMfaEnrolledUserIds();
  const users: UserRow[] = (await listCmsUsers()).map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
    mfaEnrolled: enrolled.has(row.id),
    lastLoginAt: row.lastLoginAt ? new Date(row.lastLoginAt).toISOString() : null,
  }));

  return (
    <>
      <PageHeading
        title="Gebruikers"
        description="Beheerders kunnen alles; redacteurs kunnen inhoud bewerken maar niet publiceren; aanbieders beheren hun eigen agenda en afspraken."
      />
      <UsersManager users={users} currentUserId={user.id} />
      <div className="mt-4">
        <SectionCard
          title="Tweestapsverificatie resetten"
          description="Alleen als iemand zowel de authenticator als de herstelcodes kwijt is. Bevestig met je eigen wachtwoord en code; de gebruiker krijgt een tijdelijk wachtwoord en stelt bij de volgende aanmelding een nieuwe authenticator in."
        >
          <MfaResetUserForm
            users={users
              .filter((row) => row.id !== user.id)
              .map((row) => ({
                id: row.id,
                label: `${row.name} (${row.email})${row.mfaEnrolled ? '' : ' — geen authenticator'}`,
              }))}
          />
        </SectionCard>
      </div>
    </>
  );
}
