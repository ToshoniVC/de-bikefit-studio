import 'server-only';
import { and, asc, eq, gt, inArray, lt, ne } from 'drizzle-orm';
import { unstable_cache } from 'next/cache';
import { getCmsDb } from '@/db/cms';
import {
  cmsAvailabilityExceptions,
  cmsBookings,
  cmsBusinessHours,
  cmsLocations,
  cmsProviderServices,
  cmsProviders,
  cmsServices,
  cmsUsers,
  DEFAULT_LOCALE,
  type CmsLocation,
  type CmsLocationKind,
  type CmsProvider,
} from '@/db/cms-schema';
import { CMS_TAGS } from '@/lib/cms/content';
import { computeSlots, type Slot } from './availability';
import { slotLocations } from './slot-locations';
import { formatDuration, formatLocation, formatPrice } from './format';
import { getProviderBusy } from './provider-calendar';
import { getBookingRules, type BookingRules } from './settings';
import {
  addDaysYmd,
  diffDaysYmd,
  eachDayYmd,
  isValidYmd,
  localMinutesToInstant,
  todayYmd,
} from './time';

/**
 * Public booking read API — what the `/afspraak` widget (Worker C) uses.
 *
 * - `listPublicServices()` / `listPublicProviders()` are tag-cached
 *   (`unstable_cache`, tags `cms` + {@link BOOKING_TAG}); every write in
 *   `repo.ts` busts {@link BOOKING_TAG} through `revalidateContent({ tags })`.
 * - `getAvailability()` is NOT cached: it reads live bookings and each
 *   provider's Google free/busy.
 * - Every instant crossing these functions is an ISO string.
 *
 * Only active services offered by at least one active provider (with an active
 * user account) are public.
 *
 * Where a slot is (17 Oct 2026): a business-hours row may carry the location
 * the provider is at during that range. For a (provider, service) pair the
 * location of a slot is the service's pinned location when there is one
 * (provider override → service location, as before), else the hours row's
 * location, else the provider's default, else the studio default. A service
 * pinned to a studio is not offered from hours rows at ANOTHER studio; a
 * service pinned to "bij de klant" is offered from every row (the provider
 * travels from wherever they are). See `booking-architecture.md` §16.
 */

/** Cache tag for everything booking-related (kept local; `CMS_TAGS` is unchanged). */
export const BOOKING_TAG = 'booking';

const REVALIDATE_SECONDS = 300;
/** Upper bound for one availability request, in days. */
export const MAX_AVAILABILITY_RANGE_DAYS = 62;

export type PublicLocation = {
  id: string;
  name: string;
  kind: CmsLocationKind;
  /** "De Bikefit Studio, Ninove" / "Bij jou thuis". */
  label: string;
  addressLines: string[];
};

export type PublicService = {
  id: string;
  slug: string;
  name: string;
  /** Short label under an offer with several services; '' = use `name`. */
  choiceLabel: string;
  description: string;
  durationMinutes: number;
  /** e.g. "1 u 30 min". */
  durationLabel: string;
  /** `null` unless the admin ticked "toon prijs". */
  priceCents: number | null;
  /** "€ 45,00" or '' when hidden. */
  priceLabel: string;
  requiresGuardian: boolean;
  color: string | null;
  /** The service's own location, `null` = depends on the provider. */
  location: PublicLocation | null;
  providerCount: number;
};

export type PublicProvider = {
  id: string;
  displayName: string;
  bio: string;
  /** Services offered, with the location that applies to this provider. */
  services: { serviceId: string; location: PublicLocation | null }[];
  /** Where this provider works: the locations of their hours rows and their default, distinct, in admin order. */
  locations: PublicLocation[];
};

export type AvailabilityQuery = {
  serviceId: string;
  /** `null` = every provider offering the service ("Iedereen"). */
  providerId: string | null;
  fromYmd: string;
  toYmd: string;
  /** For tests; defaults to the current time. */
  now?: Date;
  locale?: string;
};

export type AvailabilityResult =
  | {
      ok: true;
      timezone: string;
      /** The effective (clamped) range. */
      fromYmd: string;
      toYmd: string;
      /** One entry per provider and start, sorted by start. See `mergeSlots()`. */
      slots: Slot[];
    }
  | { ok: false; message: string };

function toPublicLocation(location: CmsLocation | null | undefined): PublicLocation | null {
  if (!location || !location.isActive) return null;
  const formatted = formatLocation(location);
  return {
    id: location.id,
    name: location.name,
    kind: location.kind,
    label: formatted.label,
    addressLines: formatted.addressLines,
  };
}

/**
 * Location for (provider, service): provider override → service location →
 * provider default → the global default location.
 */
export function resolveLocationId(options: {
  overrideId?: string | null;
  serviceLocationId?: string | null;
  providerDefaultId?: string | null;
  globalDefaultId?: string | null;
}): string | null {
  return (
    options.overrideId ??
    options.serviceLocationId ??
    options.providerDefaultId ??
    options.globalDefaultId ??
    null
  );
}

type Offering = {
  provider: CmsProvider;
  serviceId: string;
  overrideLocationId: string | null;
};

/** Active providers (with an active user) and what they offer. Uncached. */
async function loadOfferings(serviceId?: string): Promise<Offering[]> {
  const db = await getCmsDb();
  const rows = await db
    .select({
      provider: cmsProviders,
      serviceId: cmsProviderServices.serviceId,
      overrideLocationId: cmsProviderServices.locationId,
    })
    .from(cmsProviderServices)
    .innerJoin(cmsProviders, eq(cmsProviders.id, cmsProviderServices.providerId))
    .innerJoin(cmsUsers, eq(cmsUsers.id, cmsProviders.userId))
    .innerJoin(cmsServices, eq(cmsServices.id, cmsProviderServices.serviceId))
    .where(
      and(
        eq(cmsProviders.isActive, true),
        eq(cmsUsers.isActive, true),
        eq(cmsServices.isActive, true),
        serviceId ? eq(cmsProviderServices.serviceId, serviceId) : undefined,
      ),
    )
    .orderBy(asc(cmsProviders.sortOrder), asc(cmsProviders.displayName));
  return rows;
}

async function loadLocations(): Promise<{
  byId: Map<string, CmsLocation>;
  defaultId: string | null;
}> {
  const db = await getCmsDb();
  const rows = await db.select().from(cmsLocations).orderBy(asc(cmsLocations.sortOrder));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const def = rows.find((row) => row.isDefault && row.isActive) ?? null;
  return { byId, defaultId: def?.id ?? null };
}

// ---------------------------------------------------------------------------
// Services + providers (cached)
// ---------------------------------------------------------------------------

/** Bookable services for a locale, in admin sort order. */
export async function listPublicServices(
  locale: string = DEFAULT_LOCALE,
): Promise<PublicService[]> {
  const load = unstable_cache(
    async (): Promise<PublicService[]> => {
      const db = await getCmsDb();
      const services = await db
        .select()
        .from(cmsServices)
        .where(and(eq(cmsServices.locale, locale), eq(cmsServices.isActive, true)))
        .orderBy(asc(cmsServices.sortOrder), asc(cmsServices.name));
      const offerings = await loadOfferings();
      const { byId } = await loadLocations();

      const counts = new Map<string, number>();
      for (const offering of offerings) {
        counts.set(offering.serviceId, (counts.get(offering.serviceId) ?? 0) + 1);
      }

      return services
        .filter((service) => (counts.get(service.id) ?? 0) > 0)
        .map((service) => ({
          id: service.id,
          slug: service.slug,
          name: service.name,
          choiceLabel: service.choiceLabel,
          description: service.description,
          durationMinutes: service.durationMinutes,
          durationLabel: formatDuration(service.durationMinutes),
          priceCents: service.showPrice ? service.priceCents : null,
          priceLabel: service.showPrice ? formatPrice(service.priceCents) : '',
          requiresGuardian: service.requiresGuardian,
          color: service.color,
          location: toPublicLocation(service.locationId ? byId.get(service.locationId) : null),
          providerCount: counts.get(service.id) ?? 0,
        }));
    },
    ['booking-public-services', locale],
    { tags: [CMS_TAGS.all, BOOKING_TAG], revalidate: REVALIDATE_SECONDS },
  );
  return load();
}

/** Active providers (optionally only those offering `serviceId`), with resolved locations. */
export async function listPublicProviders(serviceId?: string | null): Promise<PublicProvider[]> {
  const key = serviceId ?? '*';
  const load = unstable_cache(
    async (): Promise<PublicProvider[]> => {
      const offerings = await loadOfferings();
      const { byId, defaultId } = await loadLocations();
      const db = await getCmsDb();
      const services = await db
        .select({ id: cmsServices.id, locationId: cmsServices.locationId })
        .from(cmsServices);
      const serviceLocation = new Map(services.map((s) => [s.id, s.locationId]));
      const providerIds = [...new Set(offerings.map((offering) => offering.provider.id))];
      const hours = providerIds.length
        ? await db
            .select({
              providerId: cmsBusinessHours.providerId,
              locationId: cmsBusinessHours.locationId,
            })
            .from(cmsBusinessHours)
            .where(inArray(cmsBusinessHours.providerId, providerIds))
            .orderBy(asc(cmsBusinessHours.weekday), asc(cmsBusinessHours.startMinute))
        : [];

      const providers = new Map<string, PublicProvider>();
      for (const offering of offerings) {
        const { provider } = offering;
        let entry = providers.get(provider.id);
        if (!entry) {
          const fallback = provider.defaultLocationId ?? defaultId;
          const worksAt = new Set<string>();
          for (const row of hours) {
            if (row.providerId !== provider.id) continue;
            const id = row.locationId ?? fallback;
            if (id) worksAt.add(id);
          }
          if (worksAt.size === 0 && fallback) worksAt.add(fallback);
          entry = {
            id: provider.id,
            displayName: provider.displayName,
            bio: provider.bio,
            services: [],
            locations: [...worksAt]
              .map((id) => toPublicLocation(byId.get(id)))
              .filter((location): location is PublicLocation => location !== null),
          };
          providers.set(provider.id, entry);
        }
        const locationId = resolveLocationId({
          overrideId: offering.overrideLocationId,
          serviceLocationId: serviceLocation.get(offering.serviceId) ?? null,
          providerDefaultId: provider.defaultLocationId,
          globalDefaultId: defaultId,
        });
        entry.services.push({
          serviceId: offering.serviceId,
          location: toPublicLocation(locationId ? byId.get(locationId) : null),
        });
      }

      const list = [...providers.values()];
      return serviceId
        ? list.filter((p) => p.services.some((s) => s.serviceId === serviceId))
        : list;
    },
    ['booking-public-providers', key],
    { tags: [CMS_TAGS.all, BOOKING_TAG], revalidate: REVALIDATE_SECONDS },
  );
  return load();
}

/**
 * How many active providers (with an active account) offer the service right
 * now. Uncached: `createPublicBooking()` decides with it whether an
 * "Iedereen" booking waits for the beheerder's assignment (more than one).
 */
export async function countEligibleProviders(serviceId: string): Promise<number> {
  return (await loadOfferings(serviceId)).length;
}

/** Booking rules for the public widget (cached through `getSiteSettings`). */
export async function getBookingSettings(locale: string = DEFAULT_LOCALE): Promise<BookingRules> {
  return getBookingRules(locale);
}

// ---------------------------------------------------------------------------
// Availability (live)
// ---------------------------------------------------------------------------

/**
 * Free slots for a service between two local dates (inclusive), per provider.
 * The range is clamped to [today, today + horizonDays] and to at most
 * {@link MAX_AVAILABILITY_RANGE_DAYS} days. Google free/busy is fetched once
 * per provider for the whole range.
 */
export async function getAvailability(query: AvailabilityQuery): Promise<AvailabilityResult> {
  const now = query.now ?? new Date();
  const rules = await getBookingRules(query.locale ?? DEFAULT_LOCALE);
  const tz = rules.timezone;

  if (!isValidYmd(query.fromYmd) || !isValidYmd(query.toYmd)) {
    return { ok: false, message: 'Ongeldige periode.' };
  }

  const db = await getCmsDb();
  const [service] = await db
    .select()
    .from(cmsServices)
    .where(and(eq(cmsServices.id, query.serviceId), eq(cmsServices.isActive, true)))
    .limit(1);
  if (!service) return { ok: false, message: 'Deze dienst bestaat niet (meer).' };

  const offerings = (await loadOfferings(service.id)).filter(
    (offering) => !query.providerId || offering.provider.id === query.providerId,
  );
  if (query.providerId && offerings.length === 0) {
    return { ok: false, message: 'Deze aanbieder biedt deze dienst niet (meer) aan.' };
  }

  const today = todayYmd(now, tz);
  const lastBookable = addDaysYmd(today, rules.horizonDays);
  const fromYmd = query.fromYmd < today ? today : query.fromYmd;
  let toYmd = query.toYmd > lastBookable ? lastBookable : query.toYmd;
  if (diffDaysYmd(fromYmd, toYmd) >= MAX_AVAILABILITY_RANGE_DAYS) {
    toYmd = addDaysYmd(fromYmd, MAX_AVAILABILITY_RANGE_DAYS - 1);
  }
  if (fromYmd > toYmd) {
    // Entirely in the past or beyond the horizon.
    return { ok: true, timezone: tz, fromYmd: query.fromYmd, toYmd: query.toYmd, slots: [] };
  }
  if (offerings.length === 0) return { ok: true, timezone: tz, fromYmd, toYmd, slots: [] };

  const providerIds = offerings.map((offering) => offering.provider.id);
  const timeMin = localMinutesToInstant(fromYmd, 0, tz);
  const timeMax = localMinutesToInstant(toYmd, 24 * 60, tz);
  // Bookings that end (plus any buffer) inside the window matter too.
  const bookingWindowStart = new Date(timeMin.getTime() - 24 * 60 * 60_000);

  const [hours, exceptions, bookings, busyByProvider] = await Promise.all([
    db.select().from(cmsBusinessHours).where(inArray(cmsBusinessHours.providerId, providerIds)),
    db
      .select()
      .from(cmsAvailabilityExceptions)
      .where(
        and(
          inArray(cmsAvailabilityExceptions.providerId, providerIds),
          gt(cmsAvailabilityExceptions.date, addDaysYmd(fromYmd, -1)),
          lt(cmsAvailabilityExceptions.date, addDaysYmd(toYmd, 1)),
        ),
      ),
    db
      .select({
        providerId: cmsBookings.providerId,
        startsAt: cmsBookings.startsAt,
        endsAt: cmsBookings.endsAt,
        status: cmsBookings.status,
        bufferAfterMinutes: cmsServices.bufferAfterMinutes,
      })
      .from(cmsBookings)
      .innerJoin(cmsServices, eq(cmsServices.id, cmsBookings.serviceId))
      .where(
        and(
          inArray(cmsBookings.providerId, providerIds),
          ne(cmsBookings.status, 'cancelled'),
          lt(cmsBookings.startsAt, timeMax),
          gt(cmsBookings.endsAt, bookingWindowStart),
        ),
      ),
    Promise.all(
      offerings.map(
        async (offering) =>
          [
            offering.provider.id,
            await getProviderBusy(offering.provider, timeMin, timeMax),
          ] as const,
      ),
    ),
  ]);

  const busyMap = new Map(busyByProvider);
  const { byId: locationsById, defaultId: studioDefaultId } = await loadLocations();
  const days = eachDayYmd(fromYmd, toYmd);
  const slots: Slot[] = [];
  for (const offering of offerings) {
    const pid = offering.provider.id;
    const where = slotLocations({
      pinnedId: offering.overrideLocationId ?? service.locationId,
      pinnedKind: null,
      providerDefaultId: offering.provider.defaultLocationId,
      studioDefaultId,
      hours: hours.filter((h) => h.providerId === pid),
      kindOf: (id) => locationsById.get(id)?.kind ?? null,
    });
    const providerExceptions = exceptions.filter((e) => e.providerId === pid);
    const providerBookings = bookings.filter((b) => b.providerId === pid);
    const busy = busyMap.get(pid) ?? [];
    for (const date of days) {
      slots.push(
        ...computeSlots({
          date,
          hours: where.hours,
          exceptions: providerExceptions,
          busy,
          bookings: providerBookings,
          service,
          rules,
          now,
          tz,
          providerId: pid,
          defaultLocationId: where.defaultLocationId,
        }),
      );
    }
  }

  // Ties keep the admin's provider order, so "Iedereen" prefers the first provider.
  const rank = new Map(offerings.map((offering, index) => [offering.provider.id, index]));
  slots.sort(
    (a, b) =>
      a.startsAt.localeCompare(b.startsAt) ||
      (rank.get(a.providerId) ?? 0) - (rank.get(b.providerId) ?? 0),
  );
  return { ok: true, timezone: tz, fromYmd, toYmd, slots };
}
