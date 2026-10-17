/**
 * Serialisable shapes that cross the server → client boundary of the booking
 * widget. Plain data only (strings, numbers, booleans, arrays): the renderer in
 * `blocks/booking.tsx` maps `@/lib/booking/content` results onto these, and
 * the server actions in `@/lib/booking/public-actions.ts` return them.
 *
 * Instants are ISO strings in UTC; every local date is a `YYYY-MM-DD` string in
 * the booking time zone (`Europe/Brussels`).
 */

import type { BookingChoice } from '@/lib/offers/catalogue';

export type { BookingChoice };

/** "Met wie" while the beheerder still has to assign the booking (the customer hears by e-mail). */
export const PENDING_PROVIDER_TEXT = 'Dat laten we je nog per e-mail weten.';

export type BookingLocationKind = 'studio' | 'customer';

export type BookingServiceOption = {
  id: string;
  /** `cms_services.slug` — what `?dienst=` and an offer's `bookingServiceSlugs` match. */
  slug: string;
  name: string;
  /** Its label under an offer with several services ("Volwassene"); '' = `name`. */
  choiceLabel: string;
  description: string;
  durationMinutes: number;
  /** Jeugdfit: contact details move to a parent, child name + age become separate fields. */
  requiresGuardian: boolean;
  /**
   * Where the fit happens when the service itself pins a location. `null`
   * means it depends on the provider (their default or per-service override).
   */
  location: BookingLocationOption | null;
  /** The service's own price ("€ 45,00"), empty unless the admin chose to show it. Never an offer's price. */
  priceLabel: string;
};

export type BookingLocationOption = {
  id: string;
  kind: BookingLocationKind;
  /** e.g. "De Bikefit Studio, Ninove" or "Bij jou thuis". */
  label: string;
};

export type BookingProviderOption = {
  id: string;
  name: string;
  bio: string;
  /** Services this provider offers, with the location that applies for each. */
  services: { serviceId: string; location: BookingLocationOption | null }[];
  /** Where this provider works (their hours' locations), for the "Bij wie?" step. */
  locations: BookingLocationOption[];
};

export type BookingWidgetRules = {
  timezone: string;
  horizonDays: number;
  cancelUntilHours: number;
  showProviderChoice: boolean;
};

export type BookingWidgetCopy = {
  successTitle: string;
  successText: string;
  /** Phone fallback shown in errors ("bel ons"), from the `contact` setting. */
  phoneLabel: string;
  phoneHref: string;
};

/** The offer a visitor came from (`/afspraak?dienst=<offer>`), shown above the steps. */
export type BookingWidgetContext = {
  label: string;
  /** The offer page, e.g. `/aanbod/bikefit-huidige-fiets`. */
  href: string;
};

export type BookingWidgetProps = {
  services: BookingServiceOption[];
  /** Every location a slot may name (`BookingSlot.locationId`). */
  locations: BookingLocationOption[];
  /**
   * The first step: one entry per offer with its services underneath, or a
   * service on its own (`groupBookingChoices()`). Absent = one per service.
   */
  choices?: BookingChoice[];
  providers: BookingProviderOption[];
  rules: BookingWidgetRules;
  copy: BookingWidgetCopy;
  /** Today in the booking time zone, computed on the server (`YYYY-MM-DD`). */
  todayYmd: string;
  /** Preselected service (must be one of `services`); also what "opnieuw" returns to. */
  initialServiceId?: string | null;
  context?: BookingWidgetContext | null;
  /** A short notice above the steps, e.g. when `?dienst=` named nothing we know. */
  notice?: string;
};

export type BookingSlot = {
  startsAt: string;
  endsAt: string;
  providerId: string;
  /** Where the fit is for this slot; `null` when no location is known. */
  locationId: string | null;
};

// --- server action contracts -----------------------------------------------

export type AvailabilityActionInput = {
  serviceId: string;
  /** `null` = "Iedereen": slots of every provider offering the service. */
  providerId: string | null;
  fromYmd: string;
  toYmd: string;
};

export type AvailabilityActionResult =
  { ok: true; slots: BookingSlot[] } | { ok: false; message: string };

export type BookActionInput = {
  serviceId: string;
  /** The chosen provider, or `null` for "Iedereen" (the beheerder assigns). */
  providerId: string | null;
  /** The chosen slot's location (so two locations at one start stay apart). */
  locationId: string | null;
  startsAt: string;
  /** The person being fitted (the child for a jeugdfit). */
  name: string;
  /** Contact e-mail/phone: the customer's own, or the parent's for a jeugdfit. */
  email: string;
  phone: string;
  age: number | null;
  guardianName: string;
  guardianEmail: string;
  guardianPhone: string;
  address: string;
  bikeDetails: string;
  notes: string;
  /** Honeypot. Humans never see it; anything in it means a bot. */
  website: string;
};

export type BookActionErrorCode = 'slot_taken' | 'rate_limited' | 'invalid' | 'error';

export type BookActionResult =
  | {
      ok: true;
      bookingId: string;
      /** What was actually booked, as the server stored it (no contact data). */
      booking: BookingSummary;
      /**
       * `/afspraak/bevestigd?ref=…` (signed, no personal data), or `''` when it
       * could not be signed. The widget swaps it into the address bar so a
       * refresh shows the booking rather than an empty form.
       */
      confirmationPath: string;
    }
  | {
      ok: false;
      code: BookActionErrorCode;
      message: string;
      fieldErrors: Record<string, string>;
    };

/** A booking as the public pages may show it — never any contact data. */
export type BookingSummary = {
  serviceName: string;
  /** Empty while the beheerder still has to assign the booking. */
  providerName: string;
  assignmentPending: boolean;
  startsAt: string;
  endsAt: string;
  timezone: string;
  /** Studio label, or the name of a `customer` location ("Bij jou thuis"). */
  locationLabel: string;
  status: string;
};

export type CancelActionResult = {
  ok: boolean;
  message: string;
  /** The booking after the attempt, when it could be found. */
  booking: BookingSummary | null;
};
