/**
 * Self-test section 14e (17 Oct 2026): several locations per provider and
 * "Iedereen" bookings assigned by the beheerder. On the throwaway PGlite of
 * `cms-selftest.mts`, after section 14 made its locations, services and the
 * first provider:
 *
 *  0. migration 0012: guarded statements only, re-running it twice is a no-op;
 *  1. hours rows carry a location: Thursday at a second studio; the public
 *     provider lists both places; slots say where they are (Thursday at the
 *     second studio, the other days at the studio default); a service pinned
 *     to the first studio is not offered on Thursday; "bij de klant" is
 *     offered from every row, at the customer's;
 *  2. with a second provider offering the same service, a booking made as
 *     "Iedereen" is `pending`, names no provider to the customer, is counted
 *     and listed as such; a booking for a chosen provider, or for a service
 *     only one provider offers, is `assigned` at once;
 *  3. a provider may not assign; the admin assigns the pending booking to the
 *     other provider (row moved, audit, no longer pending), is refused for a
 *     provider who does not offer the service, for one who is busy then, and
 *     for a cancelled booking.
 *
 * Everything it creates is removed again and the first provider's hours and
 * subscriptions are restored, so the sections after it see what they expect.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as orm from 'drizzle-orm';
import type { CmsDatabase } from '@/db/cms';

type Check = (label: string, condition: boolean, detail?: string) => void;

const { and, eq, inArray, sql } = orm;

export async function assignmentSection(ctx: {
  db: CmsDatabase;
  check: Check;
  section: (title: string) => void;
  signInAs: (userId: string) => Promise<void>;
  admin: { id: string };
  provider: { id: string; userId: string };
  studioId: string;
  homeId: string;
  services: { adultFitId: string; youthFitId: string };
  weekHours: { weekday: number; startMinute: number; endMinute: number }[];
  tz: string;
}) {
  const { db, check, section, signInAs, admin, provider, studioId, homeId, services, weekHours } =
    ctx;
  section('14e. several locations per provider + "Iedereen" assigned by the beheerder');

  const schema = await import('@/db/cms-schema');
  const { cmsAuditLog, cmsBookings, cmsBusinessHours, cmsLocations, cmsServices, cmsUsers } =
    schema;
  const { CmsAuthError } = await import('@/lib/cms/auth');
  const repo = await import('@/lib/booking/repo');
  const assignment = await import('@/lib/booking/repo-assignment');
  const content = await import('@/lib/booking/content');
  const publicBooking = await import('@/lib/booking/public-booking');
  const { mergeSlots } = await import('@/lib/booking/availability');
  const { addDaysYmd, todayYmd, instantToLocal } = await import('@/lib/booking/time');

  // --- 0: migration 0012 ------------------------------------------------------
  const file = '0012_cms_provider_locations_assignment.sql';
  const migrationSql = await readFile(resolve(process.cwd(), 'drizzle', file), 'utf8');
  const statements = migrationSql
    .split('--> statement-breakpoint')
    .map((statement) => statement.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
  check(
    'migration 0012: every statement guarded; no INSERT/UPDATE/DELETE/DROP',
    statements.length === 4 &&
      statements.every(
        (statement) =>
          /^ALTER TABLE "cms_(bookings|business_hours)" ADD COLUMN IF NOT EXISTS/.test(statement) ||
          /^DO \$\$ BEGIN\s+ALTER TABLE "cms_business_hours" ADD CONSTRAINT[\s\S]*duplicate_object/.test(
            statement,
          ),
      ) &&
      // ("ON DELETE set null ON UPDATE no action" is the foreign key's clause, not a statement.)
      !/^\s*(INSERT|UPDATE|DELETE|DROP)\b/m.test(statements.join('\n')),
  );
  let rerun = true;
  try {
    for (let i = 0; i < 2; i += 1) {
      for (const statement of statements) await db.execute(sql.raw(statement));
    }
  } catch {
    rerun = false;
  }
  check('migration 0012: re-running it twice is a no-op', rerun);
  const columns = await db.execute(
    sql`select column_name, column_default from information_schema.columns where table_name = 'cms_bookings' and column_name in ('assignment', 'assigned_at')`,
  );
  const columnRows = (Array.isArray(columns) ? columns : (columns as { rows: unknown[] }).rows) as {
    column_name: string;
    column_default: string | null;
  }[];
  check(
    "migration 0012: cms_bookings.assignment defaults to 'assigned' (existing rows keep their provider)",
    columnRows.length === 2 &&
      columnRows.some(
        (row) => row.column_name === 'assignment' && /assigned/.test(row.column_default ?? ''),
      ),
    JSON.stringify(columnRows),
  );

  // --- 1: locations per hours row ------------------------------------------------
  await signInAs(admin.id);
  const aalst = await repo.createLocation({
    name: 'Studio Aalst (test)',
    kind: 'studio',
    city: 'Aalst',
  });
  check('repo: second studio location created', aalst.ok);
  if (!aalst.ok) return;
  const aalstId = aalst.data.id;

  const hoursWithPlace = weekHours.map((row) =>
    row.weekday === 4 ? { ...row, locationId: aalstId } : row,
  );
  const unknownPlace = await repo.setBusinessHours(provider.id, [
    { weekday: 1, startMinute: 540, endMinute: 720, locationId: 'bestaat-niet' },
  ]);
  check('repo: hours at an unknown location are refused', !unknownPlace.ok);
  const hoursSet = await repo.setBusinessHours(provider.id, hoursWithPlace);
  check(
    'repo: setBusinessHours stores the location per row (Thursday at Aalst)',
    hoursSet.ok &&
      hoursSet.data.find((row) => row.weekday === 4)?.locationId === aalstId &&
      hoursSet.data.filter((row) => row.locationId === null).length === 5,
  );

  const publicProviders = await content.listPublicProviders(services.adultFitId);
  const first = publicProviders.find((item) => item.id === provider.id);
  check(
    'content: the public provider lists both places (studio default + Aalst)',
    first?.locations
      .map((location) => location.id)
      .sort()
      .join(',') === [studioId, aalstId].sort().join(','),
    first?.locations.map((location) => location.label).join(' · '),
  );

  const today = todayYmd(new Date(), ctx.tz);
  const window = { fromYmd: addDaysYmd(today, 3), toYmd: addDaysYmd(today, 17) };
  const weekdayOf = (startsAt: string) => instantToLocal(startsAt, ctx.tz).weekday;

  const adultAvail = await content.getAvailability({
    serviceId: services.adultFitId,
    providerId: provider.id,
    ...window,
  });
  const adultSlots = adultAvail.ok ? adultAvail.slots : [];
  const thursdaySlots = adultSlots.filter((slot) => weekdayOf(slot.startsAt) === 4);
  const otherSlots = adultSlots.filter((slot) => weekdayOf(slot.startsAt) !== 4);
  check(
    'availability: Thursday slots are at Aalst, the other days at the studio default',
    thursdaySlots.length > 0 &&
      thursdaySlots.every((slot) => slot.locationId === aalstId) &&
      otherSlots.length > 0 &&
      otherSlots.every((slot) => slot.locationId === studioId),
    `${thursdaySlots.length} Thursday, ${otherSlots.length} other`,
  );

  const pinned = await repo.createService({
    name: 'Studiofit Ninove (test)',
    durationMinutes: 60,
    locationId: studioId,
  });
  check('repo: service pinned to the first studio created', pinned.ok);
  if (!pinned.ok) return;
  // Section 14's "Fit aan huis" is retired by 14d (deactivated), so a fresh
  // customer-kind service stands in for "bij de klant" here.
  const atHome = await repo.createService({
    name: 'Thuisfit (test)',
    durationMinutes: 60,
    locationId: homeId,
  });
  check("repo: service at the customer's created", atHome.ok);
  if (!atHome.ok) return;
  const subscribed = await repo.setProviderServices(provider.id, [
    { serviceId: services.adultFitId },
    { serviceId: services.youthFitId },
    { serviceId: pinned.data.id },
    { serviceId: atHome.data.id },
  ]);
  check('repo: first provider also offers the pinned and the at-home service', subscribed.ok);
  const pinnedAvail = await content.getAvailability({
    serviceId: pinned.data.id,
    providerId: provider.id,
    ...window,
  });
  const pinnedSlots = pinnedAvail.ok ? pinnedAvail.slots : [];
  check(
    'availability: a service pinned to the studio is not offered on Thursday (the provider is in Aalst) and is at the studio otherwise',
    pinnedSlots.length > 0 &&
      !pinnedSlots.some((slot) => weekdayOf(slot.startsAt) === 4) &&
      pinnedSlots.every((slot) => slot.locationId === studioId),
  );
  const homeAvail = await content.getAvailability({
    serviceId: atHome.data.id,
    providerId: provider.id,
    ...window,
  });
  const homeSlots = homeAvail.ok ? homeAvail.slots : [];
  check(
    'availability: "bij de klant" is offered from every row, at the customer\'s',
    homeSlots.some((slot) => weekdayOf(slot.startsAt) === 4) &&
      homeSlots.every((slot) => slot.locationId === homeId),
  );

  // --- 2: "Iedereen" with two providers → pending ----------------------------------
  const second = await repo.createProvider({
    newUser: { email: 'tweede-aanbieder@selftest.local', name: 'Tweede Aanbieder' },
  });
  check('repo: second provider created', second.ok);
  if (!second.ok) return;
  const secondId = second.data.provider.id;
  const secondUserId = second.data.provider.userId;
  const solo = await repo.createService({ name: 'Solo fit (test)', durationMinutes: 60 });
  check('repo: a service only the second provider offers', solo.ok);
  if (!solo.ok) return;
  await repo.setBusinessHours(secondId, weekHours);
  await repo.setProviderServices(secondId, [
    { serviceId: services.adultFitId },
    { serviceId: solo.data.id },
  ]);
  check(
    'content: two providers offer the adult fit, one the solo fit',
    (await content.countEligibleProviders(services.adultFitId)) === 2 &&
      (await content.countEligibleProviders(solo.data.id)) === 1,
  );

  const everyone = await content.getAvailability({
    serviceId: services.adultFitId,
    providerId: null,
    ...window,
  });
  const merged = mergeSlots(everyone.ok ? everyone.slots : []);
  const shared = merged.filter((slot) => slot.providerIds.length === 2);
  check(
    'availability: "Iedereen" has starts where both providers are free',
    shared.length >= 3,
    `${shared.length} shared of ${merged.length}`,
  );
  if (shared.length < 3) return;
  const slotA = shared[0];
  const slotB = shared[shared.length - 1];

  const created: string[] = [];
  const pendingBooking = await publicBooking.createPublicBooking(
    {
      serviceId: services.adultFitId,
      providerId: null,
      locationId: slotA.locationId,
      startsAt: slotA.startsAt,
      customerName: 'Iedereen Klant',
      customerEmail: 'iedereen@example.com',
      customerPhone: '0470 00 00 01',
    },
    { ipAddress: '203.0.113.21' },
  );
  check(
    'public: "Iedereen" with two providers → pending, no provider named to the customer',
    pendingBooking.ok &&
      pendingBooking.booking.assignmentPending &&
      pendingBooking.booking.providerName === '' &&
      pendingBooking.emailSent.admin === false,
    pendingBooking.ok ? '' : pendingBooking.message,
  );
  if (!pendingBooking.ok) return;
  created.push(pendingBooking.bookingId);
  const [pendingRow] = await db
    .select()
    .from(cmsBookings)
    .where(eq(cmsBookings.id, pendingBooking.bookingId));
  check(
    'db: the pending booking is held by the first provider (admin order) with assignment = pending',
    pendingRow?.assignment === 'pending' &&
      pendingRow.providerId === provider.id &&
      pendingRow.assignedAt === null &&
      pendingRow.locationId === slotA.locationId,
  );
  const [createAudit] = await db
    .select()
    .from(cmsAuditLog)
    .where(
      and(
        eq(cmsAuditLog.action, 'booking.create'),
        eq(cmsAuditLog.entityId, pendingBooking.bookingId),
      ),
    );
  check(
    'audit: booking.create says it is still to be assigned',
    /nog toe te wijzen/.test(createAudit?.summary ?? '') &&
      (createAudit?.metadata as { assignment?: string } | null)?.assignment === 'pending',
    createAudit?.summary ?? '',
  );

  const chosen = await publicBooking.createPublicBooking(
    {
      serviceId: services.adultFitId,
      providerId: secondId,
      locationId: slotB.locationId,
      startsAt: slotB.startsAt,
      customerName: 'Kiezende Klant',
      customerEmail: 'kiezend@example.com',
      customerPhone: '0470 00 00 02',
    },
    { ipAddress: '203.0.113.22' },
  );
  check(
    'public: a chosen provider → assigned at once, named to the customer',
    chosen.ok &&
      !chosen.booking.assignmentPending &&
      chosen.booking.providerName === 'Tweede Aanbieder',
    chosen.ok ? '' : chosen.message,
  );
  if (chosen.ok) created.push(chosen.bookingId);

  // On another day than slots A and B, so it never overlaps what the second provider has.
  const dayOf = (startsAt: string) => instantToLocal(startsAt, ctx.tz).dateYmd;
  const takenDays = new Set([dayOf(slotA.startsAt), dayOf(slotB.startsAt)]);
  const soloAvail = await content.getAvailability({
    serviceId: solo.data.id,
    providerId: null,
    ...window,
  });
  const soloSlot = soloAvail.ok
    ? soloAvail.slots.find((slot) => !takenDays.has(dayOf(slot.startsAt)))
    : null;
  const soloBooking = soloSlot
    ? await publicBooking.createPublicBooking(
        {
          serviceId: solo.data.id,
          providerId: null,
          locationId: soloSlot.locationId,
          startsAt: soloSlot.startsAt,
          customerName: 'Solo Klant',
          customerEmail: 'solo@example.com',
          customerPhone: '0470 00 00 03',
        },
        { ipAddress: '203.0.113.23' },
      )
    : null;
  check(
    'public: "Iedereen" for a service one provider offers → assigned at once',
    soloBooking?.ok === true &&
      !soloBooking.booking.assignmentPending &&
      soloBooking.booking.providerName === 'Tweede Aanbieder',
    soloBooking ? (soloBooking.ok ? '' : soloBooking.message) : 'no solo slot',
  );
  if (soloBooking?.ok) created.push(soloBooking.bookingId);

  const pendingList = await repo.listBookings({ assignment: 'pending' });
  check(
    'admin: listBookings({ assignment: "pending" }) lists exactly the pending one; countPendingAssignments = 1',
    pendingList.length === 1 &&
      pendingList[0].id === pendingBooking.bookingId &&
      (await assignment.countPendingAssignments()) === 1,
  );

  // --- 3: assigning ---------------------------------------------------------------
  await signInAs(provider.userId);
  let refused = false;
  try {
    await assignment.assignBooking(pendingBooking.bookingId, secondId);
  } catch (error) {
    refused = error instanceof CmsAuthError && error.code === 'forbidden';
  }
  check('provider: assignBooking is forbidden', refused);

  await signInAs(admin.id);
  const assigned = await assignment.assignBooking(pendingBooking.bookingId, secondId);
  check(
    'admin: assignBooking moves the pending booking to the second provider',
    assigned.ok && assigned.data.moved && assigned.data.providerName === 'Tweede Aanbieder',
    assigned.ok ? '' : assigned.message,
  );
  const [assignedRow] = await db
    .select()
    .from(cmsBookings)
    .where(eq(cmsBookings.id, pendingBooking.bookingId));
  check(
    'db: assigned, provider changed, assigned_at set; no longer counted',
    assignedRow?.assignment === 'assigned' &&
      assignedRow.providerId === secondId &&
      assignedRow.assignedAt !== null &&
      (await assignment.countPendingAssignments()) === 0,
  );
  const summary = await publicBooking.summarizeBooking(pendingBooking.bookingId);
  check(
    'public: the summary now names the provider',
    summary?.providerName === 'Tweede Aanbieder' && summary.assignmentPending === false,
  );
  const [assignAudit] = await db
    .select()
    .from(cmsAuditLog)
    .where(
      and(
        eq(cmsAuditLog.action, 'booking.assign'),
        eq(cmsAuditLog.entityId, pendingBooking.bookingId),
      ),
    );
  check(
    'audit: booking.assign by the admin, from → to',
    assignAudit?.userId === admin.id &&
      /Test Aanbieder → Tweede Aanbieder/.test(assignAudit.summary ?? ''),
    assignAudit?.summary ?? '',
  );
  const again = await assignment.assignBooking(pendingBooking.bookingId, secondId);
  check('admin: assigning to the same provider again is a no-op', again.ok && !again.data.moved);

  const notOffering = soloBooking?.ok
    ? await assignment.assignBooking(soloBooking.bookingId, provider.id)
    : null;
  check(
    'admin: refused for a provider who does not offer the service',
    notOffering?.ok === false && /biedt deze dienst niet aan/.test(notOffering.message),
    notOffering ? (notOffering.ok ? 'moved!' : notOffering.message) : 'no solo booking',
  );

  // Slot A is free again for the first provider; the second now has it.
  const clashing = await publicBooking.createPublicBooking(
    {
      serviceId: services.adultFitId,
      providerId: null,
      locationId: slotA.locationId,
      startsAt: slotA.startsAt,
      customerName: 'Botsende Klant',
      customerEmail: 'botsend@example.com',
      customerPhone: '0470 00 00 04',
    },
    { ipAddress: '203.0.113.24' },
  );
  check(
    'public: the freed start is bookable again as "Iedereen" (held by the first provider)',
    clashing.ok && clashing.booking.assignmentPending,
    clashing.ok ? '' : clashing.message,
  );
  if (clashing.ok) {
    created.push(clashing.bookingId);
    const busy = await assignment.assignBooking(clashing.bookingId, secondId);
    check(
      'admin: refused for a provider who is busy then',
      !busy.ok && /andere afspraak|precies dat uur/.test(busy.message),
      busy.ok ? 'assigned onto a clash!' : busy.message,
    );
  }

  const cancelled = await repo.cancelBooking(pendingBooking.bookingId);
  const onCancelled = await assignment.assignBooking(pendingBooking.bookingId, provider.id);
  check(
    'admin: a cancelled booking cannot be assigned',
    cancelled.ok && !onCancelled.ok && /bevestigde afspraak/.test(onCancelled.message),
    onCancelled.ok ? '' : onCancelled.message,
  );

  // --- cleanup ---------------------------------------------------------------------
  if (created.length) await db.delete(cmsBookings).where(inArray(cmsBookings.id, created));
  await repo.setProviderServices(secondId, []);
  await db.delete(cmsUsers).where(eq(cmsUsers.id, secondUserId)); // cascades to the provider
  await repo.setProviderServices(provider.id, [
    { serviceId: services.adultFitId },
    { serviceId: services.youthFitId },
  ]);
  // `repo.deleteService` only deactivates; the rows go for real so later sections see the catalogue of before.
  await db
    .delete(cmsServices)
    .where(inArray(cmsServices.id, [pinned.data.id, solo.data.id, atHome.data.id]));
  const restored = await repo.setBusinessHours(provider.id, weekHours);
  await db.delete(cmsLocations).where(eq(cmsLocations.id, aalstId));
  const leftover = await db
    .select({ id: cmsBusinessHours.id })
    .from(cmsBusinessHours)
    .where(eq(cmsBusinessHours.locationId, aalstId));
  check(
    'cleanup: bookings, second provider, services and location removed; hours restored',
    restored.ok && restored.data.length === weekHours.length && leftover.length === 0,
  );
}
