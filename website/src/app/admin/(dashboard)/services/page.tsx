import { ForbiddenNotice } from '@/components/admin/forbidden';
import { toLocationOption, toServiceRow } from '@/components/admin/booking-rows';
import { ServicesManager } from '@/components/admin/services-manager';
import { PageHeading } from '@/components/admin/shell';
import { DEFAULT_LOCALE } from '@/db/cms-schema';
import { listLocations, listServices } from '@/lib/booking/repo';
import { getBookingRules } from '@/lib/booking/settings';
import { requireCmsUser } from '@/lib/cms/auth';
import { listPublishedOffers } from '@/lib/cms/offers-content';
import { can } from '@/lib/cms/permissions';
import type { CatalogueOffer } from '@/lib/offers/catalogue';

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
    // Which published offer links to which service (the offer block's
    // "Online boeken via dienst(en)"); shown, never required.
    listPublishedOffers(DEFAULT_LOCALE).catch((): CatalogueOffer[] => {
      console.error('[cms] offer_catalogue_unavailable');
      return [];
    }),
  ]);
  const serviceOffers = offers.filter((offer) => offer.kind === 'service');
  const canManage = can(user.role, 'service.manage');

  return (
    <>
      <PageHeading
        title="Diensten"
        description={
          canManage
            ? 'De centrale catalogus van wat klanten kunnen boeken: duur, buffer, locatie en prijs. Een aanbod koppelt diensten via hun slug; aanbieders schrijven zich enkel in voor actieve diensten.'
            : 'De centrale catalogus van wat klanten kunnen boeken. Enkel een beheerder past diensten aan.'
        }
      />
      <ServicesManager
        services={services.map((service) => toServiceRow(service, user, serviceOffers))}
        locations={locations.map(toLocationOption)}
        defaultBuffer={rules.defaultBufferAfterMinutes}
        canCreate={canManage}
      />
    </>
  );
}
