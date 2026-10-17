'use client';

import { useActionState, useState } from 'react';

import { Select } from '@/components/ui/select';
import { StatusMessage, SubmitButton } from '@/components/admin/form';
import { IDLE_STATE, type ActionState } from '@/lib/cms/actions/state';

type ProviderOption = { value: string; label: string };

/**
 * "Toewijzen" in the bookings table (17 Oct 2026): a select of the providers
 * who offer the booking's service and one button. For a pending booking the
 * holder is preselected (one click confirms them); for an assigned one the
 * form sits behind "Andere aanbieder". The server re-checks everything
 * (`assignBooking()`: permission, offers the service, free at that time).
 */
export function AssignBookingForm({
  bookingId,
  providerId,
  pending,
  providers,
  action,
}: {
  bookingId: string;
  /** The provider who holds or has the booking now. */
  providerId: string;
  pending: boolean;
  providers: ProviderOption[];
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState(action, IDLE_STATE);
  const [open, setOpen] = useState(pending);

  if (!open) {
    return (
      <button
        type="button"
        className="text-left text-xs underline underline-offset-4 hover:text-primary"
        onClick={() => setOpen(true)}
      >
        Andere aanbieder
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <input type="hidden" name="bookingId" value={bookingId} />
      <Select
        name="providerId"
        defaultValue={providers.some((option) => option.value === providerId) ? providerId : ''}
        aria-label="Toewijzen aan"
        className="w-44"
      >
        {providers.some((option) => option.value === providerId) ? null : (
          <option value="">Kies een aanbieder</option>
        )}
        {providers.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      <div className="flex items-center gap-2">
        <SubmitButton size="xs">{pending ? 'Toewijzen' : 'Verplaatsen'}</SubmitButton>
        {!pending ? (
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => setOpen(false)}
          >
            Annuleren
          </button>
        ) : null}
      </div>
      <StatusMessage state={state} />
    </form>
  );
}
