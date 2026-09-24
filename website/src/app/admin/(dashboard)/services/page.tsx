import { ForbiddenNotice } from '@/components/admin/forbidden';
import { toLocationOption, toServiceRow } from '@/components/admin/booking-rows';
import { ServicesManager } from '@/components/admin/services-manager';
import { PageHeading } from '@/components/admin/shell';
import { listLocations, listServices } from '@/lib/booking/repo';
import { getBookingRules } from '@/lib/booking/settings';
import { requireCmsUser } from '@/lib/cms/auth';
import { can } from '@/lib/cms/permissions';

export const metadata = { title: 'Diensten' };

export default async function AdminServicesPage() {
  const user = await requireCmsUser();
  if (!can(user.role, 'service.read')) return <ForbiddenNotice what="de diensten" />;

  const [services, locations, rules] = await Promise.all([
    listServices({ includeInactive: true }),
    can(user.role, 'location.read')
      ? listLocations({ includeInactive: true })
      : Promise.resolve([]),
    getBookingRules(),
  ]);

  return (
    <>
      <PageHeading
        title="Diensten"
        description="Wat klanten kunnen boeken: duur, buffer, locatie en prijs. Aanbieders kiezen zelf welke diensten ze aanbieden."
      />
      <ServicesManager
        services={services.map((service) => toServiceRow(service, user))}
        locations={locations.map(toLocationOption)}
        defaultBuffer={rules.defaultBufferAfterMinutes}
        canCreate={can(user.role, 'service.create')}
      />
    </>
  );
}
