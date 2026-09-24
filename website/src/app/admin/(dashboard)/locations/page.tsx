import { ForbiddenNotice } from '@/components/admin/forbidden';
import { LocationsManager, type LocationRow } from '@/components/admin/locations-manager';
import { PageHeading } from '@/components/admin/shell';
import { listLocations } from '@/lib/booking/repo';
import { requireCmsUser } from '@/lib/cms/auth';
import { can } from '@/lib/cms/permissions';

export const metadata = { title: 'Locaties' };

export default async function AdminLocationsPage() {
  const user = await requireCmsUser();
  if (!can(user.role, 'location.read')) return <ForbiddenNotice what="de locaties" />;

  const locations: LocationRow[] = (await listLocations({ includeInactive: true })).map(
    (location) => ({
      id: location.id,
      name: location.name,
      kind: location.kind,
      addressLines: location.addressLines,
      postalCode: location.postalCode,
      city: location.city,
      country: location.country,
      notes: location.notes,
      isDefault: location.isDefault,
      isActive: location.isActive,
      sortOrder: location.sortOrder,
    }),
  );

  return (
    <>
      <PageHeading
        title="Locaties"
        description="Waar een afspraak plaatsvindt. Een dienst of aanbieder zonder eigen locatie gebruikt de standaardlocatie."
      />
      <LocationsManager locations={locations} canManage={can(user.role, 'location.manage')} />
    </>
  );
}
