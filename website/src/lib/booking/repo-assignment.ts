import 'server-only';
import { and, eq, gt, lt, ne, sql } from 'drizzle-orm';
import { getCmsDb } from '@/db/cms';
import {
  cmsBookings,
  cmsProviderServices,
  cmsProviders,
  cmsServices,
  cmsUsers,
  DEFAULT_LOCALE,
  type CmsBooking,
  type CmsProvider,
} from '@/db/cms-schema';
import { recordAudit, requirePermission } from '@/lib/cms/auth';
import type { RepoResult } from '@/lib/cms/repo';
import { isUniqueViolation, logBookingFailure } from './booking-log';
import { sendBookingAssignedEmails } from './notifications';
import { cancelProviderEvent, createProviderEvent, getProviderBusy } from './provider-calendar';
import { bust, err, ok } from './repo-shared';
import { getBookingRules } from './settings';

/**
 * Assigning a booking to a provider (17 Oct 2026, `booking-architecture.md`
 * §16). Split out of `repo.ts` (size limit); same contract: permission check
 * first, audit after the write, cache bust last, Dutch messages.
 *
 * A booking made as "Iedereen" while several providers offer the service is
 * `assignment = 'pending'`: its `provider_id` only holds the slot. Here a
 * beheerder (`booking.manage`, never the own-scope) makes it `assigned`, to
 * the holder or to someone else, or moves an already assigned booking (a
 * provider fell ill). The target must be active, offer the service and be
 * free then: no other non-cancelled booking of theirs overlapping the fit
 * plus its buffer, nothing busy in their Google Calendar. Business hours are
 * NOT required: the beheerder may knowingly plan outside them, and a booking
 * due tomorrow must still be assignable (no notice or horizon rule either).
 *
 * After the row is updated: the previous holder's Google event is removed and
 * one is created for the assignee (the tentative title goes away); the
 * assignee gets "Nieuwe afspraak", the customer "Je fitter is bekend", a
 * previous holder "niet meer bij jou" — only for an upcoming booking.
 */

const MINUTE = 60_000;
/** Bookings this far around the fit are looked at for overlap (buffers are minutes, never hours). */
const OVERLAP_WINDOW_MS = 6 * 60 * MINUTE;

export type AssignBookingResult = RepoResult<{
  bookingId: string;
  providerId: string;
  providerName: string;
  /** `true` when the booking changed provider (not merely confirmed on its holder). */
  moved: boolean;
}>;

/** `booking.read`: how many confirmed bookings still wait for a beheerder. */
export async function countPendingAssignments(): Promise<number> {
  await requirePermission('booking.read');
  const db = await getCmsDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(cmsBookings)
    .where(and(eq(cmsBookings.assignment, 'pending'), eq(cmsBookings.status, 'confirmed')));
  return Number(row?.n ?? 0);
}

async function providerIsFree(
  provider: CmsProvider,
  booking: CmsBooking,
  bufferMinutes: number,
): Promise<string | null> {
  const db = await getCmsDb();
  const start = new Date(booking.startsAt);
  const end = new Date(booking.endsAt);
  const occupiedUntil = new Date(end.getTime() + bufferMinutes * MINUTE);

  const others = await db
    .select({
      startsAt: cmsBookings.startsAt,
      endsAt: cmsBookings.endsAt,
      bufferAfterMinutes: cmsServices.bufferAfterMinutes,
    })
    .from(cmsBookings)
    .innerJoin(cmsServices, eq(cmsServices.id, cmsBookings.serviceId))
    .where(
      and(
        eq(cmsBookings.providerId, provider.id),
        ne(cmsBookings.id, booking.id),
        ne(cmsBookings.status, 'cancelled'),
        lt(cmsBookings.startsAt, new Date(occupiedUntil.getTime() + OVERLAP_WINDOW_MS)),
        gt(cmsBookings.endsAt, new Date(start.getTime() - OVERLAP_WINDOW_MS)),
      ),
    );
  const clash = others.some((other) => {
    const otherStart = new Date(other.startsAt).getTime();
    const otherEnd =
      new Date(other.endsAt).getTime() +
      Math.max(0, other.bufferAfterMinutes ?? bufferMinutes) * MINUTE;
    return start.getTime() < otherEnd && otherStart < occupiedUntil.getTime();
  });
  if (clash) return `${provider.displayName} heeft dan al een andere afspraak.`;

  const busy = await getProviderBusy(provider, start, occupiedUntil);
  const googleClash = busy.some(
    (interval) =>
      start.getTime() < new Date(interval.end).getTime() &&
      new Date(interval.start).getTime() < occupiedUntil.getTime(),
  );
  if (googleClash) return `${provider.displayName} is dan niet vrij volgens Google Agenda.`;
  return null;
}

/**
 * `booking.manage`. Assigns (or moves) a confirmed booking to `providerId`.
 * Refuses with a Dutch message when the provider is inactive, does not offer
 * the service, or is not free at that time.
 */
export async function assignBooking(
  bookingId: string,
  providerId: string,
): Promise<AssignBookingResult> {
  const actor = await requirePermission('booking.manage');
  const db = await getCmsDb();

  const [booking] = await db
    .select()
    .from(cmsBookings)
    .where(eq(cmsBookings.id, bookingId))
    .limit(1);
  if (!booking) return err('Afspraak niet gevonden.');
  if (booking.status !== 'confirmed') {
    return err('Alleen een bevestigde afspraak kan toegewezen worden.');
  }

  const [target] = await db
    .select({ provider: cmsProviders, userActive: cmsUsers.isActive })
    .from(cmsProviders)
    .innerJoin(cmsUsers, eq(cmsUsers.id, cmsProviders.userId))
    .where(eq(cmsProviders.id, providerId))
    .limit(1);
  if (!target) return err('Aanbieder niet gevonden.');
  if (!target.provider.isActive || !target.userActive) {
    return err(`${target.provider.displayName} is niet actief.`);
  }
  const [offers] = await db
    .select({ serviceId: cmsProviderServices.serviceId })
    .from(cmsProviderServices)
    .where(
      and(
        eq(cmsProviderServices.providerId, providerId),
        eq(cmsProviderServices.serviceId, booking.serviceId),
      ),
    )
    .limit(1);
  if (!offers) return err(`${target.provider.displayName} biedt deze dienst niet aan.`);

  const [service] = await db
    .select({ name: cmsServices.name, bufferAfterMinutes: cmsServices.bufferAfterMinutes })
    .from(cmsServices)
    .where(eq(cmsServices.id, booking.serviceId))
    .limit(1);
  const rules = await getBookingRules(DEFAULT_LOCALE);
  const buffer = Math.max(0, service?.bufferAfterMinutes ?? rules.defaultBufferAfterMinutes);

  const moved = booking.providerId !== providerId;
  if (!moved && booking.assignment === 'assigned') {
    return ok({
      bookingId,
      providerId,
      providerName: target.provider.displayName,
      moved: false,
    });
  }
  if (moved) {
    const problem = await providerIsFree(target.provider, booking, buffer);
    if (problem) return err(problem);
  }

  const [previous] = await db
    .select()
    .from(cmsProviders)
    .where(eq(cmsProviders.id, booking.providerId))
    .limit(1);

  const now = new Date();
  let updated: CmsBooking | undefined;
  try {
    [updated] = await db
      .update(cmsBookings)
      .set({ providerId, assignment: 'assigned', assignedAt: now, updatedAt: now })
      .where(and(eq(cmsBookings.id, bookingId), eq(cmsBookings.status, 'confirmed')))
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      return err(`${target.provider.displayName} heeft dan al een afspraak op precies dat uur.`);
    }
    throw error;
  }
  if (!updated) return err('Deze afspraak is intussen geannuleerd.');

  // Google: the holder's (tentative) event goes, the assignee gets a clean one.
  if (previous && booking.googleEventId) {
    try {
      await cancelProviderEvent(previous, booking);
    } catch {
      logBookingFailure('assign_google_failed', bookingId);
    }
  }
  try {
    await createProviderEvent(target.provider, { ...updated, googleEventId: null });
  } catch {
    logBookingFailure('assign_google_failed', bookingId);
  }

  if (new Date(updated.startsAt).getTime() > now.getTime()) {
    try {
      await sendBookingAssignedEmails(bookingId, moved ? (previous ?? null) : null);
    } catch {
      logBookingFailure('assign_mail_failed', bookingId);
    }
  }

  await recordAudit(db, actor, {
    action: 'booking.assign',
    entityType: 'cms_booking',
    entityId: bookingId,
    summary: moved
      ? `${previous?.displayName ?? '?'} → ${target.provider.displayName}`
      : `bevestigd bij ${target.provider.displayName}`,
    metadata: { from: booking.providerId, to: providerId, wasPending: booking.assignment },
  });
  bust();
  return ok({ bookingId, providerId, providerName: target.provider.displayName, moved });
}
