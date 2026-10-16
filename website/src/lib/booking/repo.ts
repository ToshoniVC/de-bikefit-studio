import 'server-only';
import { and, asc, desc, eq, gte, inArray, lt, ne, notInArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
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
  type CmsAvailabilityException,
  type CmsBooking,
  type CmsBookingCancelledBy,
  type CmsBookingStatus,
  type CmsBusinessHours,
  type CmsLocation,
  type CmsLocationKind,
  type CmsProvider,
  type CmsRole,
  type CmsUserPublic,
} from '@/db/cms-schema';
import { recordAudit, requireCmsUser, requirePermission } from '@/lib/cms/auth';
import { createUser } from '@/lib/cms/users';
import { can, type CmsPermission } from '@/lib/cms/permissions';
import type { RepoResult } from '@/lib/cms/repo';
import { logBookingFailure } from './booking-log';
import { decryptSecret, encryptSecret, revokeToken } from './google';
import { sendBookingCancelledEmails } from './notifications';
import { cancelProviderEvent } from './provider-calendar';
import { bust, defined, err, forbidden, issuesToMessage, locationExists, ok } from './repo-shared';
import {
  BOOKING_TIMEZONE,
  addDaysYmd,
  isValidTimeZone,
  isValidYmd,
  localMinutesToInstant,
  todayYmd,
} from './time';

/**
 * Booking write API for the admin (Worker B wraps these in `'use server'`
 * actions under `src/lib/cms/actions/{bookings,services,locations,providers,availability}.ts`).
 *
 * Same contract as `src/lib/cms/repo.ts`: permission check first
 * (`requirePermission` / scoped checks that throw `CmsAuthError`), audit entry
 * after the write, cache bust last (`revalidateContent({ tags: [BOOKING_TAG] })`).
 * Results are `RepoResult<T>` with Dutch messages.
 *
 * "Own" scope: a user with a `*.own` / `provider.self` permission may act on the
 * `cms_providers` row whose `user_id` is their own (resolved from
 * `getCurrentCmsUser()`); `*.manage` / `*.read` act on everything.
 *
 * No real transactions on neon-http: multi-statement writes are ordered so a
 * partial failure leaves valid data.
 */

export type { RepoResult };

async function ownProviderRow(userId: string): Promise<CmsProvider | null> {
  const db = await getCmsDb();
  const [row] = await db
    .select()
    .from(cmsProviders)
    .where(eq(cmsProviders.userId, userId))
    .limit(1);
  return row ?? null;
}

/**
 * The actor may act on `providerId` through `manage`, or through `own` when the
 * provider profile is theirs. Throws `CmsAuthError('forbidden')` otherwise.
 */
async function requireProviderScope(
  providerId: string,
  manage: CmsPermission,
  own: CmsPermission,
): Promise<{ actor: CmsUserPublic; provider: CmsProvider | null; viaOwn: boolean }> {
  const actor = await requireCmsUser();
  const db = await getCmsDb();
  const [provider] = await db
    .select()
    .from(cmsProviders)
    .where(eq(cmsProviders.id, providerId))
    .limit(1);
  if (can(actor.role, manage)) return { actor, provider: provider ?? null, viaOwn: false };
  if (can(actor.role, own) && provider && provider.userId === actor.id) {
    return { actor, provider, viaOwn: true };
  }
  return forbidden();
}

// ===========================================================================
// Services — the catalogue lives in `./repo-services.ts`
// ===========================================================================

export {
  createService,
  deleteService,
  getService,
  listServices,
  serviceInputSchema,
  updateService,
  type ServiceInput,
  type ServiceListItem,
} from './repo-services';

// ===========================================================================
// Locations
// ===========================================================================

export const locationInputSchema = z.object({
  name: z.string().trim().max(120, 'De naam is te lang (max. 120 tekens).').default(''),
  kind: z
    .enum(['studio', 'customer'], { error: 'Kies “studio” of “bij de klant”.' })
    .default('studio'),
  addressLines: z
    .array(z.string().trim().max(200, 'Adresregel te lang.'))
    .max(4, 'Maximaal 4 adresregels.')
    .default([]),
  postalCode: z.string().trim().max(20, 'Postcode te lang.').default(''),
  city: z.string().trim().max(120, 'Gemeente te lang.').default(''),
  country: z.string().trim().max(2, 'Gebruik een landcode van 2 letters, bv. BE.').default('BE'),
  notes: z.string().trim().max(1000, 'Notities te lang.').nullable().default(null),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export type LocationInput = z.input<typeof locationInputSchema>;

function locationToInput(location: CmsLocation): z.output<typeof locationInputSchema> {
  return {
    name: location.name,
    kind: location.kind,
    addressLines: location.addressLines,
    postalCode: location.postalCode,
    city: location.city,
    country: location.country,
    notes: location.notes,
    isDefault: location.isDefault,
    isActive: location.isActive,
    sortOrder: location.sortOrder,
  };
}

export async function listLocations(
  options: { includeInactive?: boolean } = {},
): Promise<CmsLocation[]> {
  await requirePermission('location.read');
  const db = await getCmsDb();
  const query = db.select().from(cmsLocations);
  const rows = options.includeInactive
    ? await query.orderBy(asc(cmsLocations.sortOrder), asc(cmsLocations.name))
    : await query
        .where(eq(cmsLocations.isActive, true))
        .orderBy(asc(cmsLocations.sortOrder), asc(cmsLocations.name));
  return rows;
}

async function clearOtherDefaults(keepId: string): Promise<void> {
  const db = await getCmsDb();
  await db
    .update(cmsLocations)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(and(eq(cmsLocations.isDefault, true), ne(cmsLocations.id, keepId)));
}

export async function createLocation(input: LocationInput): Promise<RepoResult<CmsLocation>> {
  const actor = await requirePermission('location.manage');
  const parsed = locationInputSchema.safeParse(input);
  if (!parsed.success) return err(issuesToMessage(parsed.error));
  if (!parsed.data.name) return err('Geef de locatie een naam.');

  const db = await getCmsDb();
  const [location] = await db.insert(cmsLocations).values(parsed.data).returning();
  if (location.isDefault) await clearOtherDefaults(location.id);

  await recordAudit(db, actor, {
    action: 'location.create',
    entityType: 'cms_location',
    entityId: location.id,
    summary: location.name,
  });
  bust();
  return ok(location);
}

export async function updateLocation(
  locationId: string,
  input: Partial<LocationInput>,
): Promise<RepoResult<CmsLocation>> {
  const actor = await requirePermission('location.manage');
  const db = await getCmsDb();
  const [existing] = await db
    .select()
    .from(cmsLocations)
    .where(eq(cmsLocations.id, locationId))
    .limit(1);
  if (!existing) return err('Locatie niet gevonden.');

  const parsed = locationInputSchema.safeParse({ ...locationToInput(existing), ...defined(input) });
  if (!parsed.success) return err(issuesToMessage(parsed.error));
  if (!parsed.data.name) return err('Geef de locatie een naam.');

  const [location] = await db
    .update(cmsLocations)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(cmsLocations.id, locationId))
    .returning();
  if (location.isDefault) await clearOtherDefaults(location.id);

  await recordAudit(db, actor, {
    action: 'location.update',
    entityType: 'cms_location',
    entityId: locationId,
    summary: location.name,
  });
  bust();
  return ok(location);
}

/** Soft delete: `is_active = false` (and no longer the default). */
export async function deleteLocation(locationId: string): Promise<RepoResult<true>> {
  const actor = await requirePermission('location.manage');
  const db = await getCmsDb();
  const [existing] = await db
    .select()
    .from(cmsLocations)
    .where(eq(cmsLocations.id, locationId))
    .limit(1);
  if (!existing) return err('Locatie niet gevonden.');
  await db
    .update(cmsLocations)
    .set({ isActive: false, isDefault: false, updatedAt: new Date() })
    .where(eq(cmsLocations.id, locationId));
  await recordAudit(db, actor, {
    action: 'location.delete',
    entityType: 'cms_location',
    entityId: locationId,
    summary: `${existing.name} (gedeactiveerd)`,
  });
  bust();
  return ok(true);
}

// ===========================================================================
// Providers
// ===========================================================================

export const providerProfileSchema = z.object({
  displayName: z.string().trim().max(120, 'De naam is te lang (max. 120 tekens).').default(''),
  bio: z.string().trim().max(2000, 'De bio is te lang (max. 2000 tekens).').default(''),
  phone: z.string().trim().max(40, 'Telefoonnummer te lang.').nullable().default(null),
  /** Public contact address; may differ from the login e-mail. */
  email: z
    .string()
    .trim()
    .max(200, 'E-mailadres te lang.')
    .refine(
      (value) => value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value),
      'Ongeldig e-mailadres.',
    )
    .nullable()
    .default(null),
  timezone: z
    .string()
    .trim()
    .refine(isValidTimeZone, 'Onbekende tijdzone.')
    .default(BOOKING_TIMEZONE),
  defaultLocationId: z.string().trim().min(1).nullable().default(null),
  /** Google calendar to read/write; `'primary'` once connected. */
  googleCalendarId: z.string().trim().max(200).nullable().default(null),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export type ProviderProfileInput = z.input<typeof providerProfileSchema>;

/** A provider without its Google secrets, plus the fields the admin lists need. */
export type ProviderSummary = Omit<CmsProvider, 'googleRefreshTokenEnc' | 'googleAccessToken'> & {
  userEmail: string;
  userName: string;
  userRole: CmsRole;
  userActive: boolean;
  googleConnected: boolean;
  defaultLocationName: string | null;
  services: {
    serviceId: string;
    serviceName: string;
    serviceActive: boolean;
    locationId: string | null;
  }[];
};

export type ProviderDetail = ProviderSummary & {
  hours: CmsBusinessHours[];
  /** Today and later, sorted. */
  exceptions: CmsAvailabilityException[];
};

function stripSecrets(
  provider: CmsProvider,
): Omit<CmsProvider, 'googleRefreshTokenEnc' | 'googleAccessToken'> {
  const copy: Partial<CmsProvider> = { ...provider };
  delete copy.googleRefreshTokenEnc;
  delete copy.googleAccessToken;
  return copy as Omit<CmsProvider, 'googleRefreshTokenEnc' | 'googleAccessToken'>;
}

async function loadSummaries(
  providerIds?: string[],
  includeInactive = true,
): Promise<ProviderSummary[]> {
  const db = await getCmsDb();
  const conditions: SQL[] = [];
  if (providerIds) {
    if (providerIds.length === 0) return [];
    conditions.push(inArray(cmsProviders.id, providerIds));
  }
  if (!includeInactive) conditions.push(eq(cmsProviders.isActive, true));

  const rows = await db
    .select({
      provider: cmsProviders,
      userEmail: cmsUsers.email,
      userName: cmsUsers.name,
      userRole: cmsUsers.role,
      userActive: cmsUsers.isActive,
      defaultLocationName: cmsLocations.name,
    })
    .from(cmsProviders)
    .innerJoin(cmsUsers, eq(cmsUsers.id, cmsProviders.userId))
    .leftJoin(cmsLocations, eq(cmsLocations.id, cmsProviders.defaultLocationId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(cmsProviders.sortOrder), asc(cmsProviders.displayName));

  const ids = rows.map((row) => row.provider.id);
  const subscriptions = ids.length
    ? await db
        .select({
          providerId: cmsProviderServices.providerId,
          serviceId: cmsProviderServices.serviceId,
          locationId: cmsProviderServices.locationId,
          serviceName: cmsServices.name,
          serviceActive: cmsServices.isActive,
          sortOrder: cmsServices.sortOrder,
        })
        .from(cmsProviderServices)
        .innerJoin(cmsServices, eq(cmsServices.id, cmsProviderServices.serviceId))
        .where(inArray(cmsProviderServices.providerId, ids))
        .orderBy(asc(cmsServices.sortOrder), asc(cmsServices.name))
    : [];

  return rows.map((row) => ({
    ...stripSecrets(row.provider),
    userEmail: row.userEmail,
    userName: row.userName,
    userRole: row.userRole,
    userActive: row.userActive,
    googleConnected: Boolean(row.provider.googleRefreshTokenEnc),
    defaultLocationName: row.defaultLocationName ?? null,
    services: subscriptions
      .filter((s) => s.providerId === row.provider.id)
      .map((s) => ({
        serviceId: s.serviceId,
        serviceName: s.serviceName,
        serviceActive: s.serviceActive,
        locationId: s.locationId,
      })),
  }));
}

async function loadDetail(providerId: string): Promise<ProviderDetail | null> {
  const [summary] = await loadSummaries([providerId]);
  if (!summary) return null;
  const db = await getCmsDb();
  const [hours, exceptions] = await Promise.all([
    db
      .select()
      .from(cmsBusinessHours)
      .where(eq(cmsBusinessHours.providerId, providerId))
      .orderBy(asc(cmsBusinessHours.weekday), asc(cmsBusinessHours.startMinute)),
    db
      .select()
      .from(cmsAvailabilityExceptions)
      .where(
        and(
          eq(cmsAvailabilityExceptions.providerId, providerId),
          gte(
            cmsAvailabilityExceptions.date,
            todayYmd(new Date(), summary.timezone || BOOKING_TIMEZONE),
          ),
        ),
      )
      .orderBy(asc(cmsAvailabilityExceptions.date), asc(cmsAvailabilityExceptions.startMinute)),
  ]);
  return { ...summary, hours, exceptions };
}

/** `provider.read`. */
export async function listProviders(
  options: { includeInactive?: boolean } = {},
): Promise<ProviderSummary[]> {
  await requirePermission('provider.read');
  return loadSummaries(undefined, options.includeInactive ?? true);
}

/** `provider.read`, or `provider.self` for one's own profile. */
export async function getProvider(providerId: string): Promise<ProviderDetail | null> {
  const { provider } = await requireProviderScope(providerId, 'provider.read', 'provider.self');
  if (!provider) return null;
  return loadDetail(providerId);
}

/** The signed-in user's own provider profile (`provider.self`), or null. */
export async function getOwnProvider(): Promise<ProviderDetail | null> {
  const actor = await requirePermission('provider.self');
  const own = await ownProviderRow(actor.id);
  return own ? loadDetail(own.id) : null;
}

export type CreateProviderInput = (
  | { userId: string; newUser?: undefined }
  | { newUser: { email: string; name: string }; userId?: undefined }
) &
  Partial<ProviderProfileInput>;

/**
 * `provider.manage`. Either links an existing user (role unchanged) or creates
 * a new user with role `provider`, `must_change_password` and a temporary
 * password that is returned exactly once.
 */
export async function createProvider(
  input: CreateProviderInput,
): Promise<RepoResult<{ provider: ProviderSummary; temporaryPassword: string | null }>> {
  const actor = await requirePermission('provider.manage');
  const db = await getCmsDb();

  let userId: string;
  let userName: string;
  let temporaryPassword: string | null = null;

  if (input.newUser) {
    const name = input.newUser.name.trim();
    if (!name) return err('Geef de aanbieder een naam.');
    const created = await createUser({ email: input.newUser.email, name, role: 'provider' });
    if (!created.ok) return err(created.message);
    userId = created.data.user.id;
    userName = created.data.user.name;
    temporaryPassword = created.data.temporaryPassword;
  } else if (input.userId) {
    const [user] = await db.select().from(cmsUsers).where(eq(cmsUsers.id, input.userId)).limit(1);
    if (!user) return err('Gebruiker niet gevonden.');
    userId = user.id;
    userName = user.name;
  } else {
    return err('Kies een bestaande gebruiker of maak een nieuwe aan.');
  }

  const [existing] = await db
    .select({ id: cmsProviders.id })
    .from(cmsProviders)
    .where(eq(cmsProviders.userId, userId))
    .limit(1);
  if (existing) return err('Deze gebruiker is al aanbieder.');

  const profile = providerProfileSchema.safeParse({
    ...defined({
      bio: input.bio,
      phone: input.phone,
      email: input.email,
      timezone: input.timezone,
      defaultLocationId: input.defaultLocationId,
      isActive: input.isActive,
      sortOrder: input.sortOrder,
    }),
    displayName: input.displayName?.trim() || userName,
  });
  if (!profile.success) return err(issuesToMessage(profile.error));
  if (!(await locationExists(profile.data.defaultLocationId)))
    return err('Deze locatie bestaat niet.');

  const [provider] = await db
    .insert(cmsProviders)
    .values({ ...profile.data, email: profile.data.email || null, googleCalendarId: null, userId })
    .returning();

  await recordAudit(db, actor, {
    action: 'provider.create',
    entityType: 'cms_provider',
    entityId: provider.id,
    summary: provider.displayName,
  });
  bust();
  const [summary] = await loadSummaries([provider.id]);
  return ok({ provider: summary, temporaryPassword });
}

/**
 * `provider.manage`, or `provider.self` for one's own profile (then
 * `isActive` and `sortOrder` are ignored).
 */
export async function updateProvider(
  providerId: string,
  input: Partial<ProviderProfileInput>,
): Promise<RepoResult<ProviderSummary>> {
  const { actor, provider, viaOwn } = await requireProviderScope(
    providerId,
    'provider.manage',
    'provider.self',
  );
  if (!provider) return err('Aanbieder niet gevonden.');

  const changes = defined(input);
  if (viaOwn) {
    delete changes.isActive;
    delete changes.sortOrder;
  }
  const parsed = providerProfileSchema.safeParse({
    displayName: provider.displayName,
    bio: provider.bio,
    phone: provider.phone,
    email: provider.email,
    timezone: provider.timezone,
    defaultLocationId: provider.defaultLocationId,
    googleCalendarId: provider.googleCalendarId,
    isActive: provider.isActive,
    sortOrder: provider.sortOrder,
    ...changes,
  });
  if (!parsed.success) return err(issuesToMessage(parsed.error));
  if (!parsed.data.displayName) return err('Geef de aanbieder een naam.');
  if (!(await locationExists(parsed.data.defaultLocationId)))
    return err('Deze locatie bestaat niet.');

  const db = await getCmsDb();
  await db
    .update(cmsProviders)
    .set({ ...parsed.data, email: parsed.data.email || null, updatedAt: new Date() })
    .where(eq(cmsProviders.id, providerId));

  await recordAudit(db, actor, {
    action: 'provider.update',
    entityType: 'cms_provider',
    entityId: providerId,
    summary: parsed.data.displayName,
  });
  bust();
  const [summary] = await loadSummaries([providerId]);
  return ok(summary);
}

export type ProviderServiceRow = { serviceId: string; locationId?: string | null };

/**
 * Replaces the provider's service subscriptions (with optional per-service
 * location override). `provider.manage`, or `service.subscribe.own` for one's
 * own profile. Through `own`, a provider may add only **active** services; a
 * subscription to a service that has since been deactivated may be kept or
 * removed, never added again. Nothing here changes a service itself.
 */
export async function setProviderServices(
  providerId: string,
  rows: ProviderServiceRow[],
): Promise<RepoResult<true>> {
  const { actor, provider, viaOwn } = await requireProviderScope(
    providerId,
    'provider.manage',
    'service.subscribe.own',
  );
  if (!provider) return err('Aanbieder niet gevonden.');

  const unique = new Map<string, string | null>();
  for (const row of rows) {
    if (row.serviceId) unique.set(row.serviceId, row.locationId || null);
  }
  const serviceIds = [...unique.keys()];

  const db = await getCmsDb();
  if (serviceIds.length) {
    const found = await db
      .select({ id: cmsServices.id, isActive: cmsServices.isActive })
      .from(cmsServices)
      .where(inArray(cmsServices.id, serviceIds));
    if (found.length !== serviceIds.length) return err('Een of meer diensten bestaan niet.');
    const inactive = found.filter((service) => !service.isActive).map((service) => service.id);
    if (viaOwn && inactive.length) {
      const current = await db
        .select({ serviceId: cmsProviderServices.serviceId })
        .from(cmsProviderServices)
        .where(
          and(
            eq(cmsProviderServices.providerId, providerId),
            inArray(cmsProviderServices.serviceId, inactive),
          ),
        );
      const kept = new Set(current.map((row) => row.serviceId));
      if (inactive.some((id) => !kept.has(id))) {
        return err('Je kunt je enkel inschrijven voor actieve diensten.');
      }
    }
  }
  const locationIds = [...new Set([...unique.values()].filter((id): id is string => Boolean(id)))];
  if (locationIds.length) {
    const found = await db
      .select({ id: cmsLocations.id })
      .from(cmsLocations)
      .where(inArray(cmsLocations.id, locationIds));
    if (found.length !== locationIds.length) return err('Een of meer locaties bestaan niet.');
  }

  // Upsert the new set first, then remove what is no longer in it, so a
  // partial failure never leaves the provider with fewer services than asked.
  for (const [serviceId, locationId] of unique) {
    await db
      .insert(cmsProviderServices)
      .values({ providerId, serviceId, locationId })
      .onConflictDoUpdate({
        target: [cmsProviderServices.providerId, cmsProviderServices.serviceId],
        set: { locationId },
      });
  }
  await db
    .delete(cmsProviderServices)
    .where(
      serviceIds.length
        ? and(
            eq(cmsProviderServices.providerId, providerId),
            notInArray(cmsProviderServices.serviceId, serviceIds),
          )
        : eq(cmsProviderServices.providerId, providerId),
    );

  await recordAudit(db, actor, {
    action: 'provider.services',
    entityType: 'cms_provider',
    entityId: providerId,
    metadata: { services: serviceIds.length },
  });
  bust();
  return ok(true);
}

export const businessHoursRowSchema = z
  .object({
    weekday: z.number().int().min(0, 'Ongeldige weekdag.').max(6, 'Ongeldige weekdag.').default(1),
    startMinute: z
      .number()
      .int()
      .min(0, 'Ongeldig beginuur.')
      .max(1439, 'Ongeldig beginuur.')
      .default(540),
    endMinute: z
      .number()
      .int()
      .min(1, 'Ongeldig einduur.')
      .max(1440, 'Ongeldig einduur.')
      .default(1080),
  })
  .refine((row) => row.startMinute < row.endMinute, 'Het einduur moet na het beginuur liggen.');

export type BusinessHoursInput = z.input<typeof businessHoursRowSchema>;

const WEEKDAY_NAMES = [
  'zondag',
  'maandag',
  'dinsdag',
  'woensdag',
  'donderdag',
  'vrijdag',
  'zaterdag',
];

/**
 * Replaces the provider's weekly hours (several ranges per weekday allowed,
 * but they may not overlap). `provider.manage` or own `provider.self`.
 */
export async function setBusinessHours(
  providerId: string,
  rows: BusinessHoursInput[],
): Promise<RepoResult<CmsBusinessHours[]>> {
  const { actor, provider } = await requireProviderScope(
    providerId,
    'provider.manage',
    'provider.self',
  );
  if (!provider) return err('Aanbieder niet gevonden.');

  const parsed = z.array(businessHoursRowSchema).safeParse(rows);
  if (!parsed.success) return err(issuesToMessage(parsed.error));
  const clean = [...parsed.data].sort(
    (a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute,
  );
  for (let i = 1; i < clean.length; i += 1) {
    const prev = clean[i - 1];
    const cur = clean[i];
    if (prev.weekday === cur.weekday && cur.startMinute < prev.endMinute) {
      return err(`De uren op ${WEEKDAY_NAMES[cur.weekday]} overlappen.`);
    }
  }

  const db = await getCmsDb();
  // Delete first: a partial failure leaves the provider closed, never overbooked.
  await db.delete(cmsBusinessHours).where(eq(cmsBusinessHours.providerId, providerId));
  const inserted = clean.length
    ? await db
        .insert(cmsBusinessHours)
        .values(clean.map((row) => ({ ...row, providerId })))
        .returning()
    : [];

  await recordAudit(db, actor, {
    action: 'provider.hours',
    entityType: 'cms_provider',
    entityId: providerId,
    metadata: { ranges: inserted.length },
  });
  bust();
  return ok(inserted);
}

export const availabilityExceptionRowSchema = z
  .object({
    date: z.string().trim().refine(isValidYmd, 'Ongeldige datum (JJJJ-MM-DD).').default(''),
    kind: z
      .enum(['closed', 'open'], { error: 'Kies “gesloten” of “extra open”.' })
      .default('closed'),
    startMinute: z.number().int().min(0).max(1439).nullable().default(null),
    endMinute: z.number().int().min(1).max(1440).nullable().default(null),
    note: z.string().trim().max(300, 'Notitie te lang.').nullable().default(null),
  })
  .refine((row) => row.date !== '', 'Kies een datum.')
  .refine(
    (row) => (row.startMinute === null) === (row.endMinute === null),
    'Vul zowel een begin- als een einduur in, of geen van beide.',
  )
  .refine(
    (row) => row.startMinute === null || row.endMinute === null || row.startMinute < row.endMinute,
    'Het einduur moet na het beginuur liggen.',
  )
  .refine(
    (row) => row.kind === 'closed' || row.startMinute !== null,
    'Een extra open moment heeft uren nodig.',
  );

export type AvailabilityExceptionInput = z.input<typeof availabilityExceptionRowSchema>;

/**
 * Replaces the provider's exceptions from today onward (past rows are kept
 * as history; past dates in `rows` are ignored). A `closed` row without hours
 * closes the whole day. `provider.manage` or own `provider.self`.
 */
export async function setAvailabilityExceptions(
  providerId: string,
  rows: AvailabilityExceptionInput[],
): Promise<RepoResult<CmsAvailabilityException[]>> {
  const { actor, provider } = await requireProviderScope(
    providerId,
    'provider.manage',
    'provider.self',
  );
  if (!provider) return err('Aanbieder niet gevonden.');

  const parsed = z.array(availabilityExceptionRowSchema).safeParse(rows);
  if (!parsed.success) return err(issuesToMessage(parsed.error));

  const today = todayYmd(new Date(), provider.timezone || BOOKING_TIMEZONE);
  const seen = new Set<string>();
  const clean = parsed.data.filter((row) => {
    if (row.date < today) return false;
    const key = `${row.date}|${row.kind}|${row.startMinute ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const db = await getCmsDb();
  await db
    .delete(cmsAvailabilityExceptions)
    .where(
      and(
        eq(cmsAvailabilityExceptions.providerId, providerId),
        gte(cmsAvailabilityExceptions.date, today),
      ),
    );
  if (clean.length) {
    await db.insert(cmsAvailabilityExceptions).values(clean.map((row) => ({ ...row, providerId })));
  }
  const stored = await db
    .select()
    .from(cmsAvailabilityExceptions)
    .where(
      and(
        eq(cmsAvailabilityExceptions.providerId, providerId),
        gte(cmsAvailabilityExceptions.date, today),
      ),
    )
    .orderBy(asc(cmsAvailabilityExceptions.date), asc(cmsAvailabilityExceptions.startMinute));

  await recordAudit(db, actor, {
    action: 'provider.exceptions',
    entityType: 'cms_provider',
    entityId: providerId,
    metadata: { exceptions: stored.length },
  });
  bust();
  return ok(stored);
}

export type GoogleConnectionTokens = {
  accessToken: string;
  /** Required on the first connection; when absent, an existing one is kept. */
  refreshToken: string | null;
  expiresAt: Date | string;
};

/**
 * Stores a fresh Google connection (called by the OAuth callback route).
 * Tokens are encrypted before they touch the database. `provider.manage` or
 * own `provider.self`.
 */
export async function storeGoogleConnection(
  providerId: string,
  tokens: GoogleConnectionTokens,
  googleEmail: string | null,
): Promise<RepoResult<ProviderSummary>> {
  const { actor, provider } = await requireProviderScope(
    providerId,
    'provider.manage',
    'provider.self',
  );
  if (!provider) return err('Aanbieder niet gevonden.');

  const refreshEnc = tokens.refreshToken
    ? encryptSecret(tokens.refreshToken)
    : provider.googleRefreshTokenEnc;
  if (!refreshEnc) {
    return err(
      'Google gaf geen vernieuwingssleutel terug. Verwijder de toegang van deze app in je Google-account (Beveiliging → Apps van derden) en verbind opnieuw.',
    );
  }

  const db = await getCmsDb();
  const now = new Date();
  await db
    .update(cmsProviders)
    .set({
      googleRefreshTokenEnc: refreshEnc,
      googleAccessToken: encryptSecret(tokens.accessToken),
      googleAccessExpiresAt: new Date(tokens.expiresAt),
      googleEmail: googleEmail ? googleEmail.toLowerCase() : provider.googleEmail,
      googleConnectedAt: now,
      googleCalendarId: provider.googleCalendarId || 'primary',
      googleSyncError: null,
      updatedAt: now,
    })
    .where(eq(cmsProviders.id, providerId));

  await recordAudit(db, actor, {
    action: 'provider.google_connect',
    entityType: 'cms_provider',
    entityId: providerId,
    summary: googleEmail ?? undefined,
  });
  bust();
  const [summary] = await loadSummaries([providerId]);
  return ok(summary);
}

/** Revokes (best effort) and forgets the provider's Google tokens. */
export async function disconnectGoogle(providerId: string): Promise<RepoResult<true>> {
  const { actor, provider } = await requireProviderScope(
    providerId,
    'provider.manage',
    'provider.self',
  );
  if (!provider) return err('Aanbieder niet gevonden.');

  const refreshToken = decryptSecret(provider.googleRefreshTokenEnc);
  if (refreshToken) await revokeToken(refreshToken);

  const db = await getCmsDb();
  await db
    .update(cmsProviders)
    .set({
      googleRefreshTokenEnc: null,
      googleAccessToken: null,
      googleAccessExpiresAt: null,
      googleEmail: null,
      googleConnectedAt: null,
      googleCalendarId: null,
      googleSyncError: null,
      updatedAt: new Date(),
    })
    .where(eq(cmsProviders.id, providerId));

  await recordAudit(db, actor, {
    action: 'provider.google_disconnect',
    entityType: 'cms_provider',
    entityId: providerId,
  });
  bust();
  return ok(true);
}

// ===========================================================================
// Bookings
// ===========================================================================

export type BookingScope = 'all' | 'own';
export type BookingRange = 'upcoming' | 'past' | 'all';

export type BookingListFilters = {
  /** Default: `all` with `booking.read`, otherwise `own`. */
  scope?: BookingScope;
  /** Default `upcoming` (not yet ended), ascending; `past` and `all` are descending. */
  range?: BookingRange;
  providerId?: string;
  serviceId?: string;
  /** Default: every status. */
  status?: CmsBookingStatus | 'all';
  /** Only bookings starting within this many days from now (e.g. 7 for the dashboard). */
  withinDays?: number;
  /** Default 200. */
  limit?: number;
};

/** A booking as the admin sees it. Never carries `cancelTokenHash`. */
export type BookingListItem = Omit<CmsBooking, 'cancelTokenHash'> & {
  serviceName: string;
  providerName: string;
  locationName: string | null;
  locationKind: CmsLocationKind | null;
};

type BookingAccess = { actor: CmsUserPublic; all: boolean; ownProviderId: string | null };

async function bookingAccess(read: 'read' | 'manage'): Promise<BookingAccess> {
  const actor = await requireCmsUser();
  const all = can(actor.role, read === 'read' ? 'booking.read' : 'booking.manage');
  const ownPerm: CmsPermission = read === 'read' ? 'booking.read.own' : 'booking.manage.own';
  const own = can(actor.role, ownPerm) || all ? await ownProviderRow(actor.id) : null;
  if (!all && !can(actor.role, ownPerm)) forbidden();
  return { actor, all, ownProviderId: own?.id ?? null };
}

function bookingSelect() {
  return {
    booking: cmsBookings,
    serviceName: cmsServices.name,
    providerName: cmsProviders.displayName,
    locationName: cmsLocations.name,
    locationKind: cmsLocations.kind,
  };
}

function toListItem(row: {
  booking: CmsBooking;
  serviceName: string;
  providerName: string;
  locationName: string | null;
  locationKind: CmsLocationKind | null;
}): BookingListItem {
  const copy: Partial<CmsBooking> = { ...row.booking };
  delete copy.cancelTokenHash;
  return {
    ...(copy as Omit<CmsBooking, 'cancelTokenHash'>),
    serviceName: row.serviceName,
    providerName: row.providerName,
    locationName: row.locationName ?? null,
    locationKind: row.locationKind ?? null,
  };
}

export async function listBookings(filters: BookingListFilters = {}): Promise<BookingListItem[]> {
  const access = await bookingAccess('read');
  const scope: BookingScope = filters.scope ?? (access.all ? 'all' : 'own');
  if (scope === 'all' && !access.all) forbidden();

  const conditions: SQL[] = [];
  if (scope === 'own') {
    if (!access.ownProviderId) return [];
    conditions.push(eq(cmsBookings.providerId, access.ownProviderId));
  } else if (filters.providerId) {
    conditions.push(eq(cmsBookings.providerId, filters.providerId));
  }
  if (filters.serviceId) conditions.push(eq(cmsBookings.serviceId, filters.serviceId));
  if (filters.status && filters.status !== 'all')
    conditions.push(eq(cmsBookings.status, filters.status));

  const now = new Date();
  const range = filters.range ?? 'upcoming';
  if (range === 'upcoming') conditions.push(gte(cmsBookings.endsAt, now));
  if (range === 'past') conditions.push(lt(cmsBookings.endsAt, now));
  if (filters.withinDays && filters.withinDays > 0) {
    conditions.push(
      lt(cmsBookings.startsAt, new Date(now.getTime() + filters.withinDays * 86_400_000)),
    );
  }

  const db = await getCmsDb();
  const rows = await db
    .select(bookingSelect())
    .from(cmsBookings)
    .innerJoin(cmsServices, eq(cmsServices.id, cmsBookings.serviceId))
    .innerJoin(cmsProviders, eq(cmsProviders.id, cmsBookings.providerId))
    .leftJoin(cmsLocations, eq(cmsLocations.id, cmsBookings.locationId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(range === 'upcoming' ? asc(cmsBookings.startsAt) : desc(cmsBookings.startsAt))
    .limit(Math.min(Math.max(filters.limit ?? 200, 1), 1000));
  return rows.map(toListItem);
}

async function loadBookingItem(bookingId: string): Promise<BookingListItem | null> {
  const db = await getCmsDb();
  const [row] = await db
    .select(bookingSelect())
    .from(cmsBookings)
    .innerJoin(cmsServices, eq(cmsServices.id, cmsBookings.serviceId))
    .innerJoin(cmsProviders, eq(cmsProviders.id, cmsBookings.providerId))
    .leftJoin(cmsLocations, eq(cmsLocations.id, cmsBookings.locationId))
    .where(eq(cmsBookings.id, bookingId))
    .limit(1);
  return row ? toListItem(row) : null;
}

/** One booking, scope-checked (`booking.read`, or own with `booking.read.own`). */
export async function getBooking(bookingId: string): Promise<BookingListItem | null> {
  const access = await bookingAccess('read');
  const item = await loadBookingItem(bookingId);
  if (!item) return null;
  if (!access.all && item.providerId !== access.ownProviderId) return null;
  return item;
}

async function requireBookingManage(
  bookingId: string,
): Promise<{ access: BookingAccess; booking: CmsBooking | null }> {
  const access = await bookingAccess('manage');
  const db = await getCmsDb();
  const [booking] = await db
    .select()
    .from(cmsBookings)
    .where(eq(cmsBookings.id, bookingId))
    .limit(1);
  if (!access.all && (!booking || booking.providerId !== access.ownProviderId)) forbidden();
  return { access, booking: booking ?? null };
}

/**
 * Cancels a booking from the admin: `booking.manage` (any) or
 * `booking.manage.own` (own). Deletes the Google event and e-mails the
 * customer (and the provider when someone else cancelled).
 * `by` defaults to `provider` for one's own booking, else `admin`.
 */
export async function cancelBooking(
  bookingId: string,
  by?: Exclude<CmsBookingCancelledBy, 'customer'>,
): Promise<RepoResult<BookingListItem>> {
  const { access, booking } = await requireBookingManage(bookingId);
  if (!booking) return err('Afspraak niet gevonden.');
  if (booking.status === 'cancelled') return err('Deze afspraak is al geannuleerd.');

  const isOwn = access.ownProviderId !== null && booking.providerId === access.ownProviderId;
  const cancelledBy: CmsBookingCancelledBy = by ?? (isOwn ? 'provider' : 'admin');
  if (cancelledBy === 'admin' && !access.all) forbidden();

  const db = await getCmsDb();
  const now = new Date();
  const [cancelled] = await db
    .update(cmsBookings)
    .set({ status: 'cancelled', cancelledAt: now, cancelledBy, updatedAt: now })
    .where(and(eq(cmsBookings.id, bookingId), ne(cmsBookings.status, 'cancelled')))
    .returning();
  if (!cancelled) return err('Deze afspraak is al geannuleerd.');

  const [provider] = await db
    .select()
    .from(cmsProviders)
    .where(eq(cmsProviders.id, cancelled.providerId))
    .limit(1);
  if (provider) {
    try {
      await cancelProviderEvent(provider, cancelled);
    } catch {
      logBookingFailure('admin_google_delete_failed', cancelled.id);
    }
  }
  // Only upcoming bookings trigger a mail; cancelling history stays silent.
  if (new Date(cancelled.startsAt).getTime() > now.getTime()) {
    try {
      await sendBookingCancelledEmails(cancelled.id, cancelledBy);
    } catch {
      logBookingFailure('admin_cancellation_mail_failed', cancelled.id);
    }
  }

  await recordAudit(db, access.actor, {
    action: 'booking.cancel',
    entityType: 'cms_booking',
    entityId: bookingId,
    summary: `geannuleerd door ${cancelledBy === 'admin' ? 'beheerder' : 'aanbieder'}`,
    metadata: { by: cancelledBy },
  });
  bust();
  const item = await loadBookingItem(bookingId);
  return item ? ok(item) : err('Afspraak niet gevonden.');
}

/**
 * `completed` / `no_show` / back to `confirmed`; `cancelled` delegates to
 * {@link cancelBooking}. A cancelled booking cannot be revived.
 */
export async function setBookingStatus(
  bookingId: string,
  status: CmsBookingStatus,
): Promise<RepoResult<BookingListItem>> {
  if (status === 'cancelled') return cancelBooking(bookingId);
  if (!['confirmed', 'completed', 'no_show'].includes(status)) return err('Onbekende status.');

  const { access, booking } = await requireBookingManage(bookingId);
  if (!booking) return err('Afspraak niet gevonden.');
  if (booking.status === 'cancelled') {
    return err(
      'Een geannuleerde afspraak kan niet opnieuw geactiveerd worden. Maak een nieuwe afspraak.',
    );
  }
  if (booking.status === status) {
    const item = await loadBookingItem(bookingId);
    return item ? ok(item) : err('Afspraak niet gevonden.');
  }

  const db = await getCmsDb();
  await db
    .update(cmsBookings)
    .set({ status, updatedAt: new Date() })
    .where(eq(cmsBookings.id, bookingId));
  await recordAudit(db, access.actor, {
    action: 'booking.status',
    entityType: 'cms_booking',
    entityId: bookingId,
    summary: `${booking.status} → ${status}`,
  });
  bust();
  const item = await loadBookingItem(bookingId);
  return item ? ok(item) : err('Afspraak niet gevonden.');
}

export type BookingStats = {
  /** Which bookings were counted. `none` = the user may not see bookings. */
  scope: BookingScope | 'none';
  /** Confirmed and not yet ended. */
  upcoming: number;
  /** Confirmed, starting today (local). */
  today: number;
  /** Confirmed, starting within the next 7 days. */
  next7Days: number;
  /** Created in the last 30 days (any status). */
  createdLast30Days: number;
  /** Cancelled in the last 30 days. */
  cancelledLast30Days: number;
  /** Upcoming confirmed bookings whose Google event failed. */
  googleFailed: number;
};

/** Dashboard counters, scoped like {@link listBookings}. Never throws for a signed-in user. */
export async function getBookingStats(): Promise<BookingStats> {
  const actor = await requireCmsUser();
  const empty: BookingStats = {
    scope: 'none',
    upcoming: 0,
    today: 0,
    next7Days: 0,
    createdLast30Days: 0,
    cancelledLast30Days: 0,
    googleFailed: 0,
  };

  let scope: BookingScope;
  let providerId: string | null = null;
  if (can(actor.role, 'booking.read')) scope = 'all';
  else if (can(actor.role, 'booking.read.own')) {
    scope = 'own';
    providerId = (await ownProviderRow(actor.id))?.id ?? null;
    if (!providerId) return { ...empty, scope };
  } else return empty;

  const db = await getCmsDb();
  const now = new Date();
  const today = todayYmd(now, BOOKING_TIMEZONE);
  const startToday = localMinutesToInstant(today, 0, BOOKING_TIMEZONE);
  const startTomorrow = localMinutesToInstant(addDaysYmd(today, 1), 0, BOOKING_TIMEZONE);
  const in7Days = new Date(now.getTime() + 7 * 86_400_000);
  const ago30 = new Date(now.getTime() - 30 * 86_400_000);
  const mine = providerId ? eq(cmsBookings.providerId, providerId) : undefined;
  const confirmed = eq(cmsBookings.status, 'confirmed');

  const count = async (where: SQL | undefined) => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(cmsBookings)
      .where(where);
    return Number(row?.n ?? 0);
  };

  const [upcoming, todayCount, next7Days, createdLast30Days, cancelledLast30Days, googleFailed] =
    await Promise.all([
      count(and(mine, confirmed, gte(cmsBookings.endsAt, now))),
      count(
        and(
          mine,
          confirmed,
          gte(cmsBookings.startsAt, startToday),
          lt(cmsBookings.startsAt, startTomorrow),
        ),
      ),
      count(
        and(mine, confirmed, gte(cmsBookings.startsAt, now), lt(cmsBookings.startsAt, in7Days)),
      ),
      count(and(mine, gte(cmsBookings.createdAt, ago30))),
      count(and(mine, eq(cmsBookings.status, 'cancelled'), gte(cmsBookings.cancelledAt, ago30))),
      count(
        and(
          mine,
          confirmed,
          gte(cmsBookings.endsAt, now),
          eq(cmsBookings.googleSyncStatus, 'failed'),
        ),
      ),
    ]);

  return {
    scope,
    upcoming,
    today: todayCount,
    next7Days,
    createdLast30Days,
    cancelledLast30Days,
    googleFailed,
  };
}
