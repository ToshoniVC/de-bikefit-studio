import 'server-only';

import type { BookingRow } from '@/components/admin/bookings-table';
import type {
  ExceptionRow,
  GoogleStatus,
  HoursRow,
  ProviderProfile,
  ProviderServiceOption,
  ProviderSubscription,
} from '@/components/admin/provider-editor';
import type { LocationOption, ServiceRow } from '@/components/admin/services-manager';
import type { CmsLocation, CmsUserPublic } from '@/db/cms-schema';
import type { BookingListItem, ProviderDetail, ServiceListItem } from '@/lib/booking/repo';
import { BOOKING_TIMEZONE, formatDateLong, formatSlot, formatTime } from '@/lib/booking/time';
import { can } from '@/lib/cms/permissions';

/**
 * Maps `@/lib/booking/repo` results onto the plain, serialisable props the
 * admin client components take. Every displayed time is Europe/Brussels.
 */

export function toBookingRow(item: BookingListItem, now: number = Date.now()): BookingRow {
  const details: BookingRow['details'] = [];
  if (item.customerAge !== null)
    details.push({ label: 'Leeftijd', value: String(item.customerAge) });
  const guardian = [item.guardianName, item.guardianEmail, item.guardianPhone]
    .filter(Boolean)
    .join('\n');
  if (guardian) details.push({ label: 'Ouder/voogd', value: guardian });
  if (item.bikeDetails) details.push({ label: 'Fiets', value: item.bikeDetails });
  if (item.notes) details.push({ label: 'Opmerkingen', value: item.notes });
  if (item.status === 'cancelled' && item.cancelledAt) {
    const by =
      item.cancelledBy === 'customer'
        ? 'klant'
        : item.cancelledBy === 'provider'
          ? 'aanbieder'
          : 'beheerder';
    details.push({
      label: 'Geannuleerd',
      value: `${formatSlot(item.cancelledAt, BOOKING_TIMEZONE)} door ${by}`,
    });
  }
  if (item.googleSyncError) details.push({ label: 'Google-fout', value: item.googleSyncError });

  return {
    id: item.id,
    when: formatSlot(item.startsAt, BOOKING_TIMEZONE),
    endTime: formatTime(item.endsAt, BOOKING_TIMEZONE),
    isPast: new Date(item.startsAt).getTime() < now,
    serviceName: item.serviceName,
    providerName: item.providerName,
    customerName: item.customerName,
    customerEmail: item.customerEmail,
    customerPhone: item.customerPhone,
    locationName: item.locationName,
    customerAddress: item.locationKind === 'customer' ? item.customerAddress : null,
    status: item.status,
    googleSyncStatus: item.googleSyncStatus,
    googleSyncError: item.googleSyncError,
    details,
  };
}

/** Maps a whole list against one "now", so `isPast` is consistent across rows. */
export function toBookingRows(items: BookingListItem[]): BookingRow[] {
  const now = Date.now();
  return items.map((item) => toBookingRow(item, now));
}

export function toLocationOption(location: CmsLocation): LocationOption {
  return {
    id: location.id,
    name: location.name,
    kind: location.kind,
    isActive: location.isActive,
  };
}

export function toServiceRow(service: ServiceListItem, user: CmsUserPublic): ServiceRow {
  return {
    id: service.id,
    name: service.name,
    slug: service.slug,
    description: service.description,
    durationMinutes: service.durationMinutes,
    bufferAfterMinutes: service.bufferAfterMinutes,
    priceCents: service.priceCents,
    showPrice: service.showPrice,
    locationId: service.locationId,
    requiresGuardian: service.requiresGuardian,
    isActive: service.isActive,
    sortOrder: service.sortOrder,
    color: service.color,
    providerCount: service.providerCount,
    // Mirrors `requireServiceEdit()` in the repo, which is the real check.
    editable:
      can(user.role, 'service.manage') ||
      (can(user.role, 'service.create') && service.createdBy === user.id),
  };
}

export function toProviderServiceOption(service: ServiceListItem): ProviderServiceOption {
  return {
    id: service.id,
    name: service.name,
    durationMinutes: service.durationMinutes,
    isActive: service.isActive,
    locationName: service.locationName,
  };
}

/** Everything the provider editor cards need from one `ProviderDetail`. */
export function toProviderEditorProps(provider: ProviderDetail): {
  profile: ProviderProfile;
  subscriptions: ProviderSubscription[];
  hours: HoursRow[];
  exceptions: ExceptionRow[];
  google: GoogleStatus;
} {
  return {
    profile: {
      id: provider.id,
      displayName: provider.displayName,
      bio: provider.bio,
      phone: provider.phone,
      email: provider.email,
      timezone: provider.timezone,
      defaultLocationId: provider.defaultLocationId,
      isActive: provider.isActive,
      sortOrder: provider.sortOrder,
    },
    subscriptions: provider.services.map((row) => ({
      serviceId: row.serviceId,
      locationId: row.locationId,
    })),
    hours: provider.hours.map((row) => ({
      weekday: row.weekday,
      startMinute: row.startMinute,
      endMinute: row.endMinute,
    })),
    exceptions: provider.exceptions.map((row) => ({
      date: row.date,
      kind: row.kind,
      startMinute: row.startMinute,
      endMinute: row.endMinute,
      note: row.note,
    })),
    google: {
      connected: provider.googleConnected,
      email: provider.googleEmail,
      connectedSince: provider.googleConnectedAt
        ? formatDateLong(provider.googleConnectedAt, BOOKING_TIMEZONE)
        : null,
      error: provider.googleSyncError,
    },
  };
}
