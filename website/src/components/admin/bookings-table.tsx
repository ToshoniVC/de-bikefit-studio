'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ActionForm, SubmitButton } from '@/components/admin/form';
import {
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_VARIANTS,
  GOOGLE_SYNC_LABELS,
  GOOGLE_SYNC_VARIANTS,
} from '@/components/admin/booking-labels';
import { badgeTone } from '@/components/admin/tones';
import { cancelBookingAction, setBookingStatusAction } from '@/lib/cms/actions/bookings';
import type { CmsBookingStatus, CmsGoogleSyncStatus } from '@/db/cms-schema';

export type BookingRow = {
  id: string;
  /** Start, already formatted in Europe/Brussels on the server. */
  when: string;
  /** End time "HH:MM", Europe/Brussels. */
  endTime: string;
  isPast: boolean;
  serviceName: string;
  providerName: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  locationName: string | null;
  customerAddress: string | null;
  status: CmsBookingStatus;
  googleSyncStatus: CmsGoogleSyncStatus;
  googleSyncError: string | null;
  /** Optional extras (guardian, age, bike, notes) as label/value pairs. */
  details: Array<{ label: string; value: string }>;
};

export type BookingFilterOption = { value: string; label: string };

export type BookingFilterState = {
  range: 'upcoming' | 'past' | 'all';
  providerId: string;
  serviceId: string;
  status: string;
};

const RANGE_OPTIONS: BookingFilterOption[] = [
  { value: 'upcoming', label: 'Komende' },
  { value: 'past', label: 'Voorbije' },
  { value: 'all', label: 'Alle' },
];

const STATUS_OPTIONS: BookingFilterOption[] = [
  { value: '', label: 'Alle statussen' },
  ...(Object.keys(BOOKING_STATUS_LABELS) as CmsBookingStatus[]).map((status) => ({
    value: status,
    label: BOOKING_STATUS_LABELS[status],
  })),
];

/**
 * Filter bar as a plain GET form: works without JavaScript, and with it the
 * selects submit themselves on change.
 */
export function BookingFilters({
  filters,
  providers,
  services,
  action = '/admin/bookings',
}: {
  filters: BookingFilterState;
  /** Empty = no provider filter (a provider only ever sees their own bookings). */
  providers: BookingFilterOption[];
  services: BookingFilterOption[];
  action?: string;
}) {
  const submitOnChange = (event: React.ChangeEvent<HTMLSelectElement>) =>
    event.currentTarget.form?.requestSubmit();

  return (
    <form
      method="get"
      action={action}
      className="mb-4 flex flex-wrap items-end gap-3 border border-border bg-card p-4 text-xs"
    >
      <label className="flex flex-col gap-1">
        <span className="admin-label text-muted-foreground">Periode</span>
        <Select
          name="range"
          defaultValue={filters.range}
          onChange={submitOnChange}
          className="w-32"
        >
          {RANGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </label>
      {providers.length > 0 ? (
        <label className="flex flex-col gap-1">
          <span className="admin-label text-muted-foreground">Aanbieder</span>
          <Select
            name="provider"
            defaultValue={filters.providerId}
            onChange={submitOnChange}
            className="w-44"
          >
            <option value="">Alle aanbieders</option>
            {providers.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      <label className="flex flex-col gap-1">
        <span className="admin-label text-muted-foreground">Dienst</span>
        <Select
          name="service"
          defaultValue={filters.serviceId}
          onChange={submitOnChange}
          className="w-44"
        >
          <option value="">Alle diensten</option>
          {services.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="admin-label text-muted-foreground">Status</span>
        <Select
          name="status"
          defaultValue={filters.status}
          onChange={submitOnChange}
          className="w-40"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value || 'all'} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </label>
      <Button type="submit" size="sm" variant="outline">
        Filteren
      </Button>
    </form>
  );
}

/** Bookings table with row actions. Every action is re-checked on the server. */
export function BookingsTable({
  bookings,
  canManage,
  showProvider = true,
  emptyText = 'Geen afspraken gevonden.',
}: {
  bookings: BookingRow[];
  canManage: boolean;
  showProvider?: boolean;
  emptyText?: string;
}) {
  const columns = 6 + (showProvider ? 1 : 0) + (canManage ? 1 : 0);

  return (
    <div className="overflow-x-auto border border-border bg-card">
      <table className="w-full min-w-[56rem] text-left text-sm">
        <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
          <tr>
            <th className="p-3">Datum en tijd</th>
            <th className="p-3">Dienst</th>
            {showProvider ? <th className="p-3">Aanbieder</th> : null}
            <th className="p-3">Klant</th>
            <th className="p-3">Locatie</th>
            <th className="p-3">Status</th>
            <th className="p-3">Google</th>
            {canManage ? <th className="p-3">Acties</th> : null}
          </tr>
        </thead>
        <tbody>
          {bookings.length === 0 ? (
            <tr>
              <td colSpan={columns} className="p-6 text-center text-muted-foreground">
                {emptyText}
              </td>
            </tr>
          ) : null}
          {bookings.map((booking) => (
            <tr key={booking.id} className="border-b border-border align-top last:border-0">
              <td className="p-3 whitespace-nowrap">
                <span className="font-medium">{booking.when}</span>
                <span className="block text-xs text-muted-foreground">tot {booking.endTime}</span>
              </td>
              <td className="p-3">{booking.serviceName}</td>
              {showProvider ? <td className="p-3">{booking.providerName}</td> : null}
              <td className="p-3">
                <span className="font-medium">{booking.customerName}</span>
                <a
                  href={`mailto:${booking.customerEmail}`}
                  className="block text-xs break-all underline-offset-4 hover:underline"
                >
                  {booking.customerEmail}
                </a>
                {booking.customerPhone ? (
                  <a
                    href={`tel:${booking.customerPhone.replace(/\s+/g, '')}`}
                    className="block text-xs underline-offset-4 hover:underline"
                  >
                    {booking.customerPhone}
                  </a>
                ) : null}
                {booking.details.length > 0 ? (
                  <details className="mt-1 text-xs">
                    <summary className="admin-label cursor-pointer text-primary">Details</summary>
                    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
                      {booking.details.map((detail) => (
                        <div key={detail.label} className="contents">
                          <dt className="text-muted-foreground">{detail.label}</dt>
                          <dd className="whitespace-pre-line">{detail.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ) : null}
              </td>
              <td className="p-3 text-xs">
                {booking.locationName ?? '—'}
                {booking.customerAddress ? (
                  <span className="block whitespace-pre-line text-muted-foreground">
                    {booking.customerAddress}
                  </span>
                ) : null}
              </td>
              <td className="p-3">
                <Badge
                  variant={BOOKING_STATUS_VARIANTS[booking.status]}
                  className={badgeTone(BOOKING_STATUS_VARIANTS[booking.status])}
                >
                  {BOOKING_STATUS_LABELS[booking.status]}
                </Badge>
              </td>
              <td className="p-3">
                <Badge
                  variant={GOOGLE_SYNC_VARIANTS[booking.googleSyncStatus]}
                  className={badgeTone(GOOGLE_SYNC_VARIANTS[booking.googleSyncStatus])}
                  title={booking.googleSyncError ?? undefined}
                >
                  {GOOGLE_SYNC_LABELS[booking.googleSyncStatus]}
                </Badge>
              </td>
              {canManage ? (
                <td className="p-3">
                  {booking.status === 'confirmed' ? (
                    <div className="flex flex-col gap-1.5">
                      {!booking.isPast ? (
                        <ActionForm action={cancelBookingAction} hidden={{ bookingId: booking.id }}>
                          <SubmitButton
                            size="xs"
                            variant="destructive"
                            confirm={`Afspraak van ${booking.customerName} op ${booking.when} annuleren? De klant krijgt een e-mail.`}
                          >
                            Annuleren
                          </SubmitButton>
                        </ActionForm>
                      ) : null}
                      <ActionForm
                        action={setBookingStatusAction}
                        hidden={{ bookingId: booking.id, status: 'completed' }}
                      >
                        <SubmitButton size="xs" variant="outline">
                          Afgerond
                        </SubmitButton>
                      </ActionForm>
                      <ActionForm
                        action={setBookingStatusAction}
                        hidden={{ bookingId: booking.id, status: 'no_show' }}
                      >
                        <SubmitButton
                          size="xs"
                          variant="outline"
                          confirm="Markeren als niet verschenen?"
                        >
                          Niet verschenen
                        </SubmitButton>
                      </ActionForm>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
