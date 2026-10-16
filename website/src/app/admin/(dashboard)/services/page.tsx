import { ForbiddenNotice } from '@/components/admin/forbidden';
import { toLocationOption, toServiceRow } from '@/components/admin/booking-rows';
import { ServicesManager } from '@/components/admin/services-manager';
import { PageHeading } from '@/components/admin/shell';
import { DEFAULT_LOCALE } from '@/db/cms-schema';
import { listLocations, listServices } from '@/lib/booking/repo';
import { getBookingRules } from '@/lib/booking/settings';
import { requireCmsUser } from '@/lib/cms/auth';
import { can } from '@/lib/cms/permissions';
import { listOfferingSubscriptionGroups, type OfferingSubscriptionGroup } from '@/lib/offers/repo';

export const metadata = { title: 'Diensten' };

export default async function AdminServicesPage() {
  const user = await requireCmsUser();
  if (!can(user.role, 'service.read')) return <ForbiddenNotice what="de diensten" />;

  const [services, locations, rules, offers] = await Promise.all([
    listServices({ includeInactive: true }),
    can(user.role, 'location.read')
      ? listLocations({ includeInactive: true })
      : Promise.resolve([]),
    getBookingRules(),
    // Which offering (Beheer → Aanbod) uses which service as a variant; shown,
    // never required (without migration 0010 the page-derived links).
    listOfferingSubscriptionGroups(DEFAULT_LOCALE).catch((): OfferingSubscriptionGroup[] => {
      console.error('[cms] offering_groups_unavailable');
      return [];
    }),
  ]);
  const canManage = can(user.role, 'service.manage');

  return (
    <>
      <PageHeading
        title="Diensten"
        description={
          canManage
            ? 'De centrale catalogus van wat klanten kunnen boeken: duur, buffer, locatie en ouderregel. Welk aanbod een dienst gebruikt, met welke prijs, stel je in bij Beheer → Aanbod; aanbieders schrijven zich enkel in voor actieve diensten.'
            : 'De centrale catalogus van wat klanten kunnen boeken. Enkel een beheerder past diensten aan.'
        }
      />
      <ServicesManager
        services={services.map((service) => toServiceRow(service, user, offers))}
        locations={locations.map(toLocationOption)}
        defaultBuffer={rules.defaultBufferAfterMinutes}
        canCreate={canManage}
      />
    </>
  );
}
