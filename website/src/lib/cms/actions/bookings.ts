'use server';

import { revalidatePath } from 'next/cache';
import { cancelBooking, setBookingStatus } from '@/lib/booking/repo';
import { runAction } from './run';
import { actionError, actionOk, field, type ActionState } from './state';

/**
 * Booking server actions. `repo.ts` enforces `booking.manage` (any booking) or
 * `booking.manage.own` (only the signed-in provider's bookings); nothing here
 * decides who may touch which booking.
 */

function revalidateBookingViews(): void {
  revalidatePath('/admin/bookings');
  revalidatePath('/admin/agenda');
  revalidatePath('/admin');
}

export async function cancelBookingAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const bookingId = field(form, 'bookingId');
    if (!bookingId) return actionError('Onbekende afspraak.');

    // `repo.cancelBooking` records who cancelled: `provider` for one's own
    // booking, `admin` otherwise. It also removes the Google event and mails
    // the customer for upcoming bookings.
    const result = await cancelBooking(bookingId);
    if (!result.ok) return actionError(result.message);

    revalidateBookingViews();
    return actionOk('Afspraak geannuleerd.');
  });
}

const STATUS_MESSAGES = {
  completed: 'Afspraak gemarkeerd als afgerond.',
  no_show: 'Afspraak gemarkeerd als niet verschenen.',
  confirmed: 'Afspraak terug op bevestigd gezet.',
} as const;

/** Afgerond / Niet verschenen. Cancelling has its own action (it also clears Google). */
export async function setBookingStatusAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const bookingId = field(form, 'bookingId');
    const status = field(form, 'status');
    if (!bookingId) return actionError('Onbekende afspraak.');
    if (status !== 'completed' && status !== 'no_show' && status !== 'confirmed') {
      return actionError('Onbekende status.');
    }

    const result = await setBookingStatus(bookingId, status);
    if (!result.ok) return actionError(result.message);

    revalidateBookingViews();
    return actionOk(STATUS_MESSAGES[status]);
  });
}
