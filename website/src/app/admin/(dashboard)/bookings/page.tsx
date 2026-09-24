import { ForbiddenNotice } from '@/components/admin/forbidden';
import { toBookingRows } from '@/components/admin/booking-rows';
import {
  BookingFilters,
  BookingsTable,
  type BookingFilterOption,
  type BookingFilterState,
} from '@/components/admin/bookings-table';
import { PageHeading } from '@/components/admin/shell';
import type { CmsBookingStatus } from '@/db/cms-schema';
import { listBookings, listProviders, listServices } from '@/lib/booking/repo';
import { requireCmsUser } from '@/lib/cms/auth';
import { can } from '@/lib/cms/permissions';

export const metadata = { title: 'Afspraken' };

type Search = { range?: string; provider?: string; service?: string; status?: string };

const STATUSES: CmsBookingStatus[] = ['confirmed', 'cancelled', 'completed', 'no_show'];

export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const user = await requireCmsUser();
  const readAll = can(user.role, 'booking.read');
  if (!readAll && !can(user.role, 'booking.read.own')) {
    return <ForbiddenNotice what="de afspraken" />;
  }

  const params = await searchParams;
  const filters: BookingFilterState = {
    range: params.range === 'past' || params.range === 'all' ? params.range : 'upcoming',
    providerId: readAll ? (params.provider ?? '') : '',
    serviceId: params.service ?? '',
    status: STATUSES.includes(params.status as CmsBookingStatus) ? (params.status as string) : '',
  };

  const [bookings, providers, services] = await Promise.all([
    listBookings({
      // Providers only ever see their own bookings; the repo enforces it too.
      scope: readAll ? 'all' : 'own',
      range: filters.range,
      providerId: filters.providerId || undefined,
      serviceId: filters.serviceId || undefined,
      status: (filters.status || 'all') as CmsBookingStatus | 'all',
    }),
    readAll && can(user.role, 'provider.read') ? listProviders() : Promise.resolve([]),
    can(user.role, 'service.read') ? listServices({ includeInactive: true }) : Promise.resolve([]),
  ]);

  const providerOptions: BookingFilterOption[] = providers.map((provider) => ({
    value: provider.id,
    label: provider.isActive ? provider.displayName : `${provider.displayName} (inactief)`,
  }));
  const serviceOptions: BookingFilterOption[] = services.map((service) => ({
    value: service.id,
    label: service.isActive ? service.name : `${service.name} (inactief)`,
  }));

  const rows = toBookingRows(bookings);
  const canManage = can(user.role, 'booking.manage') || can(user.role, 'booking.manage.own');

  return (
    <>
      <PageHeading
        title="Afspraken"
        description={
          readAll
            ? 'Alle afspraken, in Belgische tijd. Standaard zie je de komende.'
            : 'Jouw afspraken, in Belgische tijd. Standaard zie je de komende.'
        }
      />
      <BookingFilters filters={filters} providers={providerOptions} services={serviceOptions} />
      <p className="mb-2 text-xs text-muted-foreground">
        {rows.length === 1 ? '1 afspraak' : `${rows.length} afspraken`}
        {rows.length >= 200 ? ' (maximum bereikt, verfijn de filters)' : ''}
      </p>
      <BookingsTable bookings={rows} canManage={canManage} showProvider={readAll} />
    </>
  );
}
