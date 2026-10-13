import { ForbiddenNotice } from '@/components/admin/forbidden';
import { toLocationOption } from '@/components/admin/booking-rows';
import {
  ProvidersManager,
  type ProviderListRow,
  type UserOption,
} from '@/components/admin/providers-manager';
import { SectionCard } from '@/components/admin/form';
import { StepUpPanel } from '@/components/admin/mfa/step-up';
import { PageHeading } from '@/components/admin/shell';
import { listLocations, listProviders } from '@/lib/booking/repo';
import { requireCmsUser } from '@/lib/cms/auth';
import { getStepUpStatus } from '@/lib/cms/mfa/reauth';
import { listCmsUsers } from '@/lib/cms/users';
import { can, ROLE_LABELS } from '@/lib/cms/permissions';

export const metadata = { title: 'Aanbieders' };

export default async function AdminProvidersPage() {
  const user = await requireCmsUser();
  if (!can(user.role, 'provider.read')) return <ForbiddenNotice what="de aanbieders" />;

  const canManage = can(user.role, 'provider.manage');
  const [providers, locations, users] = await Promise.all([
    listProviders(),
    can(user.role, 'location.read') ? listLocations() : Promise.resolve([]),
    // Linking an existing login needs the user list, which is admin-only.
    canManage && can(user.role, 'user.read') ? listCmsUsers() : Promise.resolve([]),
  ]);

  // A provider with a NEW login creates a user account: a sensitive change.
  const stepUp = canManage && can(user.role, 'user.manage') ? await getStepUpStatus() : null;

  const linked = new Set(providers.map((provider) => provider.userId));
  const userOptions: UserOption[] = users
    .filter((candidate) => !linked.has(candidate.id) && candidate.isActive)
    .map((candidate) => ({
      id: candidate.id,
      label: `${candidate.name || candidate.email} — ${candidate.email} (${ROLE_LABELS[candidate.role]})`,
    }));

  const rows: ProviderListRow[] = providers.map((provider) => ({
    id: provider.id,
    displayName: provider.displayName,
    loginEmail: provider.userEmail,
    isActive: provider.isActive && provider.userActive,
    serviceCount: provider.services.filter((service) => service.serviceActive).length,
    googleConnected: provider.googleConnected,
    googleEmail: provider.googleEmail,
    googleSyncError: provider.googleSyncError,
  }));

  return (
    <>
      <PageHeading
        title="Aanbieders"
        description="Mensen bij wie klanten een afspraak kunnen maken, met hun diensten, uren en Google Agenda."
      />
      {stepUp ? (
        <div className="mb-4">
          <SectionCard
            title="Bevestig je identiteit"
            description="Alleen nodig om een aanbieder met een nieuwe login aan te maken; een bestaande gebruiker koppelen kan zonder."
          >
            <StepUpPanel
              until={stepUp.until ? stepUp.until.toISOString() : null}
              needsCode={stepUp.needsCode}
              what="een nieuwe login aanmaken"
            />
          </SectionCard>
        </div>
      ) : null}
      <ProvidersManager
        providers={rows}
        users={userOptions}
        locations={locations.map(toLocationOption)}
        canManage={canManage}
      />
    </>
  );
}
