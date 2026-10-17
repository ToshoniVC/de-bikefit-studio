import Link from 'next/link';

import { ForbiddenNotice } from '@/components/admin/forbidden';
import { toBookingRows } from '@/components/admin/booking-rows';
import {
  BookingFilters,
  BookingsTable,
  type AssignOptions,
  type BookingFilterOption,
  type BookingFilterState,
} from '@/components/admin/bookings-table';
import { PageHeading } from '@/components/admin/shell';
import type { CmsBookingStatus } from '@/db/cms-schema';
import { listBookings, listProviders, listServices } from '@/lib/booking/repo';
import { countPendingAssignments } from '@/lib/booking/repo-assignment';
import { requireCmsUser } from '@/lib/cms/auth';
import { can } from '@/lib/cms/permissions';

export const metadata = { title: 'Afspraken' };

type Search = {
  range?: string;
  provider?: string;
  service?: string;
  status?: string;
  assignment?: string;
};

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
    assignment: readAll && params.assignment === 'pending' ? 'pending' : '',
  };

  const [bookings, providers, services, pendingCount] = await Promise.all([
    listBookings({
      // Providers only ever see their own bookings; the repo enforces it too.
      scope: readAll ? 'all' : 'own',
      range: filters.range,
      providerId: filters.providerId || undefined,
      serviceId: filters.serviceId || undefined,
      status: (filters.status || 'all') as CmsBookingStatus | 'all',
      assignment: filters.assignment === 'pending' ? 'pending' : undefined,
    }),
    readAll && can(user.role, 'provider.read') ? listProviders() : Promise.resolve([]),
    can(user.role, 'service.read') ? listServices({ includeInactive: true }) : Promise.resolve([]),
    readAll ? countPendingAssignments() : Promise.resolve(0),
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

  // Toewijzen: per service, the active providers (with an active login) who offer it.
  let assignOptions: AssignOptions | null = null;
  if (can(user.role, 'booking.manage')) {
    assignOptions = {};
    for (const provider of providers) {
      if (!provider.isActive || !provider.userActive) continue;
      for (const entry of provider.services) {
        (assignOptions[entry.serviceId] ??= []).push({
          value: provider.id,
          label: provider.displayName,
        });
      }
    }
  }

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
      {pendingCount > 0 && filters.assignment !== 'pending' ? (
        <p className="mb-4 border border-border bg-card px-4 py-3 text-sm">
          <strong>
            {pendingCount === 1
              ? '1 afspraak wacht op toewijzing'
              : `${pendingCount} afspraken wachten op toewijzing`}
          </strong>
          : de klant koos “Iedereen”. Wijs ze toe aan een aanbieder.{' '}
          <Link
            href="/admin/bookings?assignment=pending"
            className="underline underline-offset-4 hover:text-primary"
          >
            Toon enkel die
          </Link>
        </p>
      ) : null}
      <BookingFilters filters={filters} providers={providerOptions} services={serviceOptions} />
      <p className="mb-2 text-xs text-muted-foreground">
        {rows.length === 1 ? '1 afspraak' : `${rows.length} afspraken`}
        {rows.length >= 200 ? ' (maximum bereikt, verfijn de filters)' : ''}
      </p>
      <BookingsTable
        bookings={rows}
        canManage={canManage}
        showProvider={readAll}
        assignOptions={assignOptions}
      />
    </>
  );
}
