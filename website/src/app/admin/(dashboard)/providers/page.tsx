import { ForbiddenNotice } from '@/components/admin/forbidden';
import { toLocationOption } from '@/components/admin/booking-rows';
import {
  ProvidersManager,
  type ProviderListRow,
  type UserOption,
} from '@/components/admin/providers-manager';
import { PageHeading } from '@/components/admin/shell';
import { listLocations, listProviders } from '@/lib/booking/repo';
import { listCmsUsers, requireCmsUser } from '@/lib/cms/auth';
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
      <ProvidersManager
        providers={rows}
        users={userOptions}
        locations={locations.map(toLocationOption)}
        canManage={canManage}
      />
    </>
  );
}
