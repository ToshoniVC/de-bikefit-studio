import { SectionCard } from '@/components/admin/form';
import { ForbiddenNotice } from '@/components/admin/forbidden';
import { MfaResetUserForm } from '@/components/admin/mfa/reset-user-form';
import { StepUpPanel } from '@/components/admin/mfa/step-up';
import { UsersManager, type UserRow } from '@/components/admin/users-manager';
import { PageHeading } from '@/components/admin/shell';
import { requireCmsUser } from '@/lib/cms/auth';
import { roleRequiresMfa } from '@/lib/cms/guard';
import { listMfaEnrolledUserIds } from '@/lib/cms/mfa/manage';
import { getStepUpStatus } from '@/lib/cms/mfa/reauth';
import { listCmsUsers } from '@/lib/cms/users';
import { can } from '@/lib/cms/permissions';

export const metadata = { title: 'Gebruikers' };

export default async function AdminUsersPage() {
  const user = await requireCmsUser();
  if (!can(user.role, 'user.read')) return <ForbiddenNotice what="het gebruikersbeheer" />;

  const enrolled = await listMfaEnrolledUserIds();
  const stepUp = await getStepUpStatus();
  const users: UserRow[] = (await listCmsUsers()).map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
    mfaEnrolled: enrolled.has(row.id),
    mfaRequired: roleRequiresMfa(row.role),
    lastLoginAt: row.lastLoginAt ? new Date(row.lastLoginAt).toISOString() : null,
  }));

  return (
    <>
      <PageHeading
        title="Gebruikers"
        description="Beheerders kunnen alles; redacteurs kunnen inhoud bewerken maar niet publiceren; aanbieders beheren hun eigen agenda en afspraken. Beheerders en aanbieders melden zich aan met wachtwoord én tweestapsverificatie."
      />
      <div className="mb-4">
        <SectionCard
          title="Bevestig je identiteit"
          description="Gebruikers aanmaken, rollen wijzigen, (de)activeren en wachtwoorden resetten vraagt een recente bevestiging."
        >
          <StepUpPanel
            until={stepUp.until ? stepUp.until.toISOString() : null}
            needsCode={stepUp.needsCode}
            what="gebruikers beheren"
          />
        </SectionCard>
      </div>
      <UsersManager users={users} currentUserId={user.id} />
      <div className="mt-4">
        <SectionCard
          title="Tweestapsverificatie resetten"
          description="Alleen als iemand zowel de authenticator als de herstelcodes kwijt is. Bevestig met je eigen wachtwoord en code; de gebruiker krijgt een tijdelijk wachtwoord en een beheerder of aanbieder stelt bij de volgende aanmelding een nieuwe authenticator in."
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
