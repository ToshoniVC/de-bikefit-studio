import 'server-only';
import { and, asc, eq, ne, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { getCmsDb } from '@/db/cms';
import {
  cmsLocations,
  cmsProviderServices,
  cmsProviders,
  cmsServices,
  DEFAULT_LOCALE,
  type CmsService,
  type CmsUserPublic,
} from '@/db/cms-schema';
import { recordAudit, requirePermission } from '@/lib/cms/auth';
import type { RepoResult } from '@/lib/cms/repo';
import { slugify } from './format';
import { bust, defined, err, issuesToMessage, locationExists, ok } from './repo-shared';

/**
 * The service catalogue (`cms_services`): the one place a bookable service's
 * name, choice label, duration, buffer, price, location and guardian rule are
 * kept. Re-exported by `./repo.ts`, which stays the booking write API's entry
 * point; split out on 16 Oct 2026 (that file is past the size limit).
 *
 * Reading needs `service.read`; every write needs `service.manage` (admin).
 * Offers link to a service by slug (the offer block's `bookingServiceSlugs`),
 * providers subscribe to it (`setProviderServices()` in `./repo.ts`); neither
 * copies or overrides what is stored here.
 */

export const serviceInputSchema = z.object({
  locale: z.string().trim().min(2, 'Ongeldige taal.').default(DEFAULT_LOCALE),
  name: z.string().trim().max(120, 'De naam is te lang (max. 120 tekens).').default(''),
  /** Label under an offer with several services ("Volwassene"); empty → the name. */
  choiceLabel: z.string().trim().max(40, 'Het keuzelabel is te lang (max. 40 tekens).').default(''),
  /** Empty → derived from the name. */
  slug: z.string().trim().max(80, 'De slug is te lang.').default(''),
  description: z
    .string()
    .trim()
    .max(2000, 'De beschrijving is te lang (max. 2000 tekens).')
    .default(''),
  durationMinutes: z
    .number()
    .int('De duur moet een geheel aantal minuten zijn.')
    .min(5, 'De duur is minstens 5 minuten.')
    .max(720, 'De duur is maximaal 12 uur.')
    .default(60),
  /** `null` → the `booking` setting's default buffer. */
  bufferAfterMinutes: z
    .number()
    .int('De buffer moet een geheel aantal minuten zijn.')
    .min(0, 'De buffer kan niet negatief zijn.')
    .max(240, 'De buffer is maximaal 4 uur.')
    .nullable()
    .default(15),
  priceCents: z
    .number()
    .int('Ongeldige prijs.')
    .min(0, 'De prijs kan niet negatief zijn.')
    .nullable()
    .default(null),
  showPrice: z.boolean().default(false),
  /** `null` → the provider's default location. */
  locationId: z.string().trim().min(1).nullable().default(null),
  requiresGuardian: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  color: z.string().trim().max(32, 'Ongeldige kleur.').nullable().default(null),
});

export type ServiceInput = z.input<typeof serviceInputSchema>;

export type ServiceListItem = CmsService & {
  locationName: string | null;
  providerCount: number;
};

function serviceToInput(service: CmsService): z.output<typeof serviceInputSchema> {
  return {
    locale: service.locale,
    name: service.name,
    choiceLabel: service.choiceLabel,
    slug: service.slug,
    description: service.description,
    durationMinutes: service.durationMinutes,
    bufferAfterMinutes: service.bufferAfterMinutes,
    priceCents: service.priceCents,
    showPrice: service.showPrice,
    locationId: service.locationId,
    requiresGuardian: service.requiresGuardian,
    isActive: service.isActive,
    sortOrder: service.sortOrder,
    color: service.color,
  };
}

export async function listServices(
  options: { includeInactive?: boolean; locale?: string } = {},
): Promise<ServiceListItem[]> {
  await requirePermission('service.read');
  const db = await getCmsDb();
  const conditions: SQL[] = [eq(cmsServices.locale, options.locale ?? DEFAULT_LOCALE)];
  if (!options.includeInactive) conditions.push(eq(cmsServices.isActive, true));

  const rows = await db
    .select({ service: cmsServices, locationName: cmsLocations.name })
    .from(cmsServices)
    .leftJoin(cmsLocations, eq(cmsLocations.id, cmsServices.locationId))
    .where(and(...conditions))
    .orderBy(asc(cmsServices.sortOrder), asc(cmsServices.name));

  const counts = await db
    .select({ serviceId: cmsProviderServices.serviceId, count: sql<number>`count(*)::int` })
    .from(cmsProviderServices)
    .innerJoin(cmsProviders, eq(cmsProviders.id, cmsProviderServices.providerId))
    .where(eq(cmsProviders.isActive, true))
    .groupBy(cmsProviderServices.serviceId);
  const countBy = new Map(counts.map((c) => [c.serviceId, Number(c.count)]));

  return rows.map((row) => ({
    ...row.service,
    locationName: row.locationName ?? null,
    providerCount: countBy.get(row.service.id) ?? 0,
  }));
}

export async function getService(serviceId: string): Promise<CmsService | null> {
  await requirePermission('service.read');
  const db = await getCmsDb();
  const [row] = await db.select().from(cmsServices).where(eq(cmsServices.id, serviceId)).limit(1);
  return row ?? null;
}

/**
 * The service catalogue is central and admin-managed (16 Oct 2026): creating,
 * editing, pricing, deactivating and reactivating all need `service.manage`.
 * `service.create` stays in the permission list for the admin only; a
 * provider has neither, and `created_by` grants nothing, so a provider who
 * created a service before this rule cannot edit it either. Providers only
 * subscribe to active services ({@link setProviderServices}).
 */
async function requireServiceManage(): Promise<CmsUserPublic> {
  return requirePermission('service.manage');
}

/** `service.manage` (admin). */
export async function createService(input: ServiceInput): Promise<RepoResult<CmsService>> {
  const actor = await requireServiceManage();
  const parsed = serviceInputSchema.safeParse(input);
  if (!parsed.success) return err(issuesToMessage(parsed.error));
  const data = parsed.data;
  if (!data.name) return err('Geef de dienst een naam.');

  const slug = slugify(data.slug || data.name);
  if (!slug) return err('Kies een geldige slug (letters en cijfers).');
  if (!(await locationExists(data.locationId))) return err('Deze locatie bestaat niet.');

  const db = await getCmsDb();
  const [clash] = await db
    .select({ id: cmsServices.id })
    .from(cmsServices)
    .where(and(eq(cmsServices.locale, data.locale), eq(cmsServices.slug, slug)))
    .limit(1);
  if (clash) return err(`Er bestaat al een dienst met de slug “${slug}”.`);

  const [service] = await db
    .insert(cmsServices)
    .values({ ...data, slug, createdBy: actor.id })
    .returning();

  await recordAudit(db, actor, {
    action: 'service.create',
    entityType: 'cms_service',
    entityId: service.id,
    summary: service.name,
  });
  bust();
  return ok(service);
}

/** The permission first, then the row: a refused caller learns nothing about it. */
async function requireServiceEdit(
  serviceId: string,
): Promise<{ actor: CmsUserPublic; existing: CmsService | null }> {
  const actor = await requireServiceManage();
  const db = await getCmsDb();
  const [existing] = await db
    .select()
    .from(cmsServices)
    .where(eq(cmsServices.id, serviceId))
    .limit(1);
  return { actor, existing: existing ?? null };
}

/** `service.manage` (admin); also how a service is reactivated. */
export async function updateService(
  serviceId: string,
  input: Partial<ServiceInput>,
): Promise<RepoResult<CmsService>> {
  const { actor, existing } = await requireServiceEdit(serviceId);
  if (!existing) return err('Dienst niet gevonden.');

  const parsed = serviceInputSchema.safeParse({ ...serviceToInput(existing), ...defined(input) });
  if (!parsed.success) return err(issuesToMessage(parsed.error));
  const data = parsed.data;
  if (!data.name) return err('Geef de dienst een naam.');

  const slug = slugify(data.slug || data.name);
  if (!slug) return err('Kies een geldige slug (letters en cijfers).');
  if (!(await locationExists(data.locationId))) return err('Deze locatie bestaat niet.');

  const db = await getCmsDb();
  if (slug !== existing.slug || data.locale !== existing.locale) {
    const [clash] = await db
      .select({ id: cmsServices.id })
      .from(cmsServices)
      .where(
        and(
          eq(cmsServices.locale, data.locale),
          eq(cmsServices.slug, slug),
          ne(cmsServices.id, serviceId),
        ),
      )
      .limit(1);
    if (clash) return err(`Er bestaat al een dienst met de slug “${slug}”.`);
  }

  const [service] = await db
    .update(cmsServices)
    .set({ ...data, slug, updatedAt: new Date() })
    .where(eq(cmsServices.id, serviceId))
    .returning();

  await recordAudit(db, actor, {
    action: 'service.update',
    entityType: 'cms_service',
    entityId: serviceId,
    summary: service.name,
  });
  bust();
  return ok(service);
}

/** Soft delete: `is_active = false`. Existing bookings keep their service. */
export async function deleteService(serviceId: string): Promise<RepoResult<true>> {
  const { actor, existing } = await requireServiceEdit(serviceId);
  if (!existing) return err('Dienst niet gevonden.');
  const db = await getCmsDb();
  await db
    .update(cmsServices)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(cmsServices.id, serviceId));
  await recordAudit(db, actor, {
    action: 'service.delete',
    entityType: 'cms_service',
    entityId: serviceId,
    summary: `${existing.name} (gedeactiveerd)`,
  });
  bust();
  return ok(true);
}
