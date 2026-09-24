import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { GOOGLE_SYNC_LABELS, GOOGLE_SYNC_VARIANTS } from '@/components/admin/booking-labels';
import { badgeTone } from '@/components/admin/tones';
import type { BookingListItem } from '@/lib/booking/repo';
import { BOOKING_TIMEZONE, formatDateShort, formatTime } from '@/lib/booking/time';

/**
 * Dashboard card: confirmed bookings in the next 7 days, in Brussels time.
 * Server component; the list comes from `listBookings()` already scoped to
 * what the user may see (all, or only their own).
 */
export function UpcomingBookingsCard({
  bookings,
  showProvider,
}: {
  bookings: BookingListItem[];
  showProvider: boolean;
}) {
  return (
    <section className="border border-border bg-card p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl leading-tight">Komende afspraken</h2>
          <p className="mt-1 text-sm text-muted-foreground">De volgende 7 dagen.</p>
        </div>
        <Link
          href="/admin/bookings"
          className="text-sm underline underline-offset-4 hover:text-primary"
        >
          Alle afspraken
        </Link>
      </div>
      {bookings.length === 0 ? (
        <p className="text-sm text-muted-foreground">Geen afspraken in de komende 7 dagen.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border border-y border-border text-sm">
          {bookings.map((booking) => (
            <li key={booking.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <span className="w-36 shrink-0 font-ds-display text-base font-semibold tracking-[0.02em] tabular-nums">
                {formatDateShort(booking.startsAt, BOOKING_TIMEZONE)}{' '}
                {formatTime(booking.startsAt, BOOKING_TIMEZONE)}
              </span>
              <span className="min-w-0 flex-1">
                {booking.serviceName}
                <span className="text-muted-foreground"> · {booking.customerName}</span>
                {showProvider ? (
                  <span className="text-muted-foreground"> · bij {booking.providerName}</span>
                ) : null}
              </span>
              {booking.googleSyncStatus === 'failed' ? (
                <Badge
                  variant={GOOGLE_SYNC_VARIANTS.failed}
                  className={badgeTone(GOOGLE_SYNC_VARIANTS.failed)}
                >
                  Google: {GOOGLE_SYNC_LABELS.failed}
                </Badge>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
