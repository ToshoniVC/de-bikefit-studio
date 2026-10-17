import 'server-only';
import { and, eq } from 'drizzle-orm';
import { getCmsDb } from '@/db/cms';
import {
  cmsBookings,
  cmsLocations,
  cmsProviders,
  cmsServices,
  cmsUsers,
  DEFAULT_LOCALE,
  type CmsBooking,
  type CmsBookingCancelledBy,
  type CmsLocation,
  type CmsProvider,
  type CmsService,
} from '@/db/cms-schema';
import { getSiteSettings } from '@/lib/cms/content';
import { siteUrl } from '@/lib/env';
import { buildIcs, icsUidFor } from '@/lib/email/ics';
import { sendEmail, type SendEmailResult } from '@/lib/email/send';
import { loadEmailSettings } from '@/lib/email/settings';
import {
  bookingCancellationEmail,
  bookingConfirmationEmail,
  providerNotificationEmail,
  type BookingEmailData,
} from '@/lib/email/templates';
import {
  assignmentTodoEmail,
  bookingAssignedEmail,
  bookingReassignedEmail,
} from '@/lib/email/templates-assignment';
import { assignmentRecipients } from './assignment-recipients';
import { formatLocation } from './format';
import { parseBookingRules } from './settings';

/**
 * Booking e-mails: loads a booking with everything a template needs and sends
 * the right mails. Used by `public-booking.ts`, `repo.ts` and
 * `repo-assignment.ts`. Never throws for mail problems — see `sendEmail()`.
 *
 * A booking that waits for the beheerder's assignment (`assignment =
 * 'pending'`, 17 Oct 2026) names no provider to the customer: its
 * confirmation says who will be announced later, the provider holding the
 * slot gets no mail, and the beheerder gets a to-do
 * (`assignmentRecipients()`). Assigning sends the provider's notification,
 * tells the customer who, and tells a previous holder the slot is free again.
 */

export type BookingContext = {
  booking: CmsBooking;
  service: CmsService;
  provider: CmsProvider;
  providerLoginEmail: string;
  location: CmsLocation | null;
};

export type BookingMailResults = {
  customer: SendEmailResult | null;
  provider: SendEmailResult | null;
  /** The beheerder's to-do (only for a booking that waits for assignment). */
  admin?: SendEmailResult | null;
  /** The provider who held the slot before a re-assignment. */
  previousProvider?: SendEmailResult | null;
};

export function cancelUrlFor(token: string): string {
  return `${siteUrl()}/afspraak/annuleren/${token}`;
}

export async function loadBookingContext(bookingId: string): Promise<BookingContext | null> {
  const db = await getCmsDb();
  const [row] = await db
    .select({
      booking: cmsBookings,
      service: cmsServices,
      provider: cmsProviders,
      providerLoginEmail: cmsUsers.email,
    })
    .from(cmsBookings)
    .innerJoin(cmsServices, eq(cmsServices.id, cmsBookings.serviceId))
    .innerJoin(cmsProviders, eq(cmsProviders.id, cmsBookings.providerId))
    .innerJoin(cmsUsers, eq(cmsUsers.id, cmsProviders.userId))
    .where(eq(cmsBookings.id, bookingId))
    .limit(1);
  if (!row) return null;
  const [location] = row.booking.locationId
    ? await db
        .select()
        .from(cmsLocations)
        .where(eq(cmsLocations.id, row.booking.locationId))
        .limit(1)
    : [];
  return { ...row, location: location ?? null };
}

async function emailData(
  ctx: BookingContext,
  extra: Partial<BookingEmailData> = {},
): Promise<BookingEmailData> {
  const settings = await getSiteSettings(ctx.service.locale || DEFAULT_LOCALE);
  const rules = parseBookingRules(settings.booking);
  const formatted = formatLocation(ctx.location);
  const { booking } = ctx;
  const pending = booking.assignment === 'pending';
  return {
    siteName: settings.site.name || 'De Bikefit Studio',
    siteUrl: siteUrl(),
    serviceName: ctx.service.name,
    durationMinutes: ctx.service.durationMinutes,
    providerName: pending ? '' : ctx.provider.displayName,
    assignmentPending: pending,
    heldBy: pending ? ctx.provider.displayName : null,
    assignUrl: `${siteUrl()}/admin/bookings?assignment=pending`,
    customerName: booking.customerName,
    customerEmail: booking.customerEmail,
    customerPhone: booking.customerPhone,
    customerAge: booking.customerAge,
    guardianName: booking.guardianName,
    guardianEmail: booking.guardianEmail,
    guardianPhone: booking.guardianPhone,
    bikeDetails: booking.bikeDetails,
    notes: booking.notes,
    customerAddress: booking.customerAddress,
    startsAt: new Date(booking.startsAt).toISOString(),
    endsAt: new Date(booking.endsAt).toISOString(),
    timezone: booking.timezone,
    locationLabel: formatted.label,
    locationKind: ctx.location?.kind ?? null,
    locationAddressLines: formatted.addressLines,
    contactPhoneLabel: settings.contact.phoneLabel || null,
    confirmationText: rules.confirmationText,
    cancelDeadline: new Date(
      new Date(booking.startsAt).getTime() - rules.cancelUntilHours * 60 * 60_000,
    ).toISOString(),
    adminUrl: `${siteUrl()}/admin/bookings`,
    ...extra,
  };
}

function customerRecipients(booking: CmsBooking): string[] {
  const list = [booking.customerEmail];
  if (
    booking.guardianEmail &&
    booking.guardianEmail.toLowerCase() !== booking.customerEmail.toLowerCase()
  ) {
    list.push(booking.guardianEmail);
  }
  return list;
}

function providerRecipient(ctx: BookingContext): string {
  return ctx.provider.email || ctx.providerLoginEmail;
}

function icsFor(ctx: BookingContext, data: BookingEmailData, method: 'PUBLISH' | 'CANCEL'): string {
  const where =
    data.locationKind === 'customer'
      ? (data.customerAddress ?? '')
      : formatLocation(ctx.location).singleLine;
  return buildIcs({
    uid: icsUidFor(ctx.booking.id, new URL(siteUrl()).hostname || 'debikefitstudio.be'),
    startsAt: data.startsAt,
    endsAt: data.endsAt,
    summary: `${data.serviceName} — ${data.siteName}`,
    description: [
      data.providerName ? `${data.serviceName} bij ${data.providerName}.` : `${data.serviceName}.`,
      data.cancelUrl ? `Annuleren: ${data.cancelUrl}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    location: where || undefined,
    url: `${data.siteUrl}/afspraak`,
    method,
    sequence: method === 'CANCEL' ? 1 : 0,
    reminderMinutes: method === 'PUBLISH' ? 24 * 60 : 0,
  });
}

/** Customer confirmation (with .ics + cancel link) and provider notification. */
export async function sendBookingCreatedEmails(
  bookingId: string,
  cancelToken: string,
): Promise<BookingMailResults> {
  const ctx = await loadBookingContext(bookingId);
  if (!ctx) return { customer: null, provider: null };

  const data = await emailData(ctx, { cancelUrl: cancelUrlFor(cancelToken) });
  const confirmation = bookingConfirmationEmail(data);
  const customer = await sendEmail({
    to: customerRecipients(ctx.booking),
    ...confirmation,
    attachments: [
      {
        filename: 'afspraak.ics',
        content: icsFor(ctx, data, 'PUBLISH'),
        contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
      },
    ],
  });

  // The holder of a pending booking is not told: the beheerder decides first.
  if (ctx.booking.assignment === 'pending') {
    const todo = assignmentTodoEmail({ ...data, cancelUrl: null });
    const recipients = await todoRecipients();
    const admin = recipients.length
      ? await sendEmail({ to: recipients, ...todo, replyTo: ctx.booking.customerEmail })
      : ({ sent: false, reason: 'no_recipient' } as const);
    return { customer, provider: null, admin };
  }

  const notification = providerNotificationEmail({ ...data, cancelUrl: null });
  const provider = await sendEmail({
    to: providerRecipient(ctx),
    ...notification,
    replyTo: ctx.booking.customerEmail,
  });

  return { customer, provider };
}

/** The beheerder's to-do inbox: the enquiry recipient, else every active admin's login. */
async function todoRecipients(): Promise<string[]> {
  const settings = await loadEmailSettings();
  const db = await getCmsDb();
  const admins = await db
    .select({ email: cmsUsers.email })
    .from(cmsUsers)
    .where(and(eq(cmsUsers.role, 'admin'), eq(cmsUsers.isActive, true)));
  return assignmentRecipients({
    inbox: settings.recipient.address,
    adminEmails: admins.map((row) => row.email),
  });
}

/**
 * After a beheerder assigned the booking: the provider's "Nieuwe afspraak",
 * the customer's "Je fitter is bekend" and, when the booking moved, a note to
 * the provider who held it before.
 */
export async function sendBookingAssignedEmails(
  bookingId: string,
  previousProvider: CmsProvider | null,
): Promise<BookingMailResults> {
  const ctx = await loadBookingContext(bookingId);
  if (!ctx) return { customer: null, provider: null };

  const data = await emailData(ctx, { cancelUrl: null });
  const customer = await sendEmail({
    to: customerRecipients(ctx.booking),
    ...bookingAssignedEmail(data),
  });
  const provider = await sendEmail({
    to: providerRecipient(ctx),
    ...providerNotificationEmail(data),
    replyTo: ctx.booking.customerEmail,
  });

  let previous: SendEmailResult | null = null;
  if (previousProvider && previousProvider.id !== ctx.provider.id) {
    const db = await getCmsDb();
    const [login] = await db
      .select({ email: cmsUsers.email })
      .from(cmsUsers)
      .where(eq(cmsUsers.id, previousProvider.userId))
      .limit(1);
    const to = previousProvider.email || login?.email;
    if (to) {
      previous = await sendEmail({
        to,
        ...bookingReassignedEmail(data, previousProvider.displayName),
      });
    }
  }
  return { customer, provider, previousProvider: previous };
}

/**
 * Cancellation mails. The customer is always told; the provider is told unless
 * they cancelled it themselves.
 */
export async function sendBookingCancelledEmails(
  bookingId: string,
  cancelledBy: CmsBookingCancelledBy,
): Promise<BookingMailResults> {
  const ctx = await loadBookingContext(bookingId);
  if (!ctx) return { customer: null, provider: null };

  const data = await emailData(ctx, { cancelledBy, cancelUrl: null });
  const customerMail = bookingCancellationEmail(data, 'customer');
  const customer = await sendEmail({
    to: customerRecipients(ctx.booking),
    ...customerMail,
    attachments: [
      {
        filename: 'afspraak.ics',
        content: icsFor(ctx, data, 'CANCEL'),
        contentType: 'text/calendar; charset=utf-8; method=CANCEL',
      },
    ],
  });

  let provider: SendEmailResult | null = null;
  if (cancelledBy !== 'provider') {
    const providerMail = bookingCancellationEmail(data, 'provider');
    provider = await sendEmail({ to: providerRecipient(ctx), ...providerMail });
  }
  return { customer, provider };
}
