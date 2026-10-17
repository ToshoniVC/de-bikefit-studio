import 'server-only';
import { and, asc, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import { getCmsDb, type CmsDatabase } from '@/db/cms';
import { cmsOfferings, cmsOfferingVariants } from '@/db/cms-offering-schema';
import {
  cmsProviderServices,
  cmsProviders,
  cmsServices,
  cmsUsers,
  DEFAULT_LOCALE,
  type CmsUserPublic,
} from '@/db/cms-schema';
import { BOOKING_TAG } from '@/lib/booking/content';
import { slugify } from '@/lib/booking/format';
import { locationExists } from '@/lib/booking/repo-shared';
import { recordAudit, requirePermission } from '@/lib/cms/auth';
import { revalidateContent, type RepoResult } from '@/lib/cms/repo';
import { BOOKING_PAGE_PATH, OFFER_CATEGORIES, OFFER_INDEX_PATH, offerPagePath } from './catalogue';
import {
  AUDIENCE_LABELS,
  resolveOffering,
  validateOfferingInput,
  type OfferingAudience,
  type OfferingServiceInfo,
  type OfferingSettings,
  type ResolvedOffering,
  type VariantServiceInput,
} from './offering';
import {
  validateOfferingContent,
  type OfferingContent,
  type OfferingRecord,
} from './offering-content';
import { OFFERING_TAG, readStoredOfferings } from './offering-store';

/**
 * Beheer → Aanbod: the admin read and write API for offerings (17 Oct 2026:
 * the offering IS the offer; there is no offer page and no separate Diensten
 * screen any more).
 *
 * Same contract as the other repos: permission first (`offering.manage`,
 * admin), then the rows; Dutch `RepoResult` messages; every write audited
 * (`offering.create` / `offering.update` / `offering.delete`) and the caches
 * busted (`cms:offerings`, `cms`, `booking`). Uncached on purpose: the admin
 * sees the database, and the public site reads through `offering-store.ts`.
 *
 * A save writes `cms_offerings` + `cms_offering_variants` and, for every
 * variant that is booked online, its `cms_services` row (created on the
 * first save, kept by id afterwards: name, label, duration, buffer, location
 * and guardian rule follow the offering; slug, price display and existing
 * bookings are never touched). It never writes `cms_provider_services`
 * (providers subscribe themselves) or `cms_bookings`.
 */

export type AdminOfferingService = OfferingServiceInfo & {
  bufferAfterMinutes: number | null;
  locationId: string | null;
  /** Active providers (with an active account) subscribed to it. */
  providerCount: number;
  providerNames: string[];
};

export type AdminOffering = OfferingRecord & {
  path: string;
  resolved: ResolvedOffering;
};

export type AdminOfferingOverview = {
  offerings: AdminOffering[];
  services: AdminOfferingService[];
};

/** What the admin form sends: the copy and the settings, both validated here. */
export type SaveOfferingInput = { content: unknown; settings: unknown };

const err = (message: string) => ({ ok: false as const, message });

async function readOfferingServices(
  db: CmsDatabase,
  locale: string,
): Promise<AdminOfferingService[]> {
  const rows = await db
    .select({
      id: cmsServices.id,
      slug: cmsServices.slug,
      name: cmsServices.name,
      choiceLabel: cmsServices.choiceLabel,
      durationMinutes: cmsServices.durationMinutes,
      bufferAfterMinutes: cmsServices.bufferAfterMinutes,
      locationId: cmsServices.locationId,
      isActive: cmsServices.isActive,
      requiresGuardian: cmsServices.requiresGuardian,
      priceCents: cmsServices.priceCents,
      showPrice: cmsServices.showPrice,
    })
    .from(cmsServices)
    .where(eq(cmsServices.locale, locale))
    .orderBy(asc(cmsServices.sortOrder), asc(cmsServices.name));
  // The public rule (`listPublicServices()`): an active provider with an active account.
  const offered = await db
    .select({ serviceId: cmsProviderServices.serviceId, name: cmsProviders.displayName })
    .from(cmsProviderServices)
    .innerJoin(cmsProviders, eq(cmsProviders.id, cmsProviderServices.providerId))
    .innerJoin(cmsUsers, eq(cmsUsers.id, cmsProviders.userId))
    .where(and(eq(cmsProviders.isActive, true), eq(cmsUsers.isActive, true)))
    .orderBy(asc(cmsProviders.sortOrder), asc(cmsProviders.displayName));
  const names = new Map<string, string[]>();
  for (const row of offered)
    names.set(row.serviceId, [...(names.get(row.serviceId) ?? []), row.name]);
  return rows.map((row) => ({
    ...row,
    providerCount: names.get(row.id)?.length ?? 0,
    providerNames: names.get(row.id) ?? [],
  }));
}

function toAdminOffering(
  record: OfferingRecord,
  services: readonly OfferingServiceInfo[],
  bookable: ReadonlySet<string>,
): AdminOffering {
  return {
    ...record,
    path: offerPagePath(record.content.slug),
    resolved: resolveOffering({
      settings: record.settings,
      source: 'stored',
      services,
      bookableServiceIds: bookable,
    }),
  };
}

/** Every offering (shown or not) with its settings; `offering.manage`. */
export async function listOfferingsForAdmin(
  locale: string = DEFAULT_LOCALE,
): Promise<AdminOfferingOverview> {
  await requirePermission('offering.manage');
  const db = await getCmsDb();
  const [offerings, services] = await Promise.all([
    readStoredOfferings(locale),
    readOfferingServices(db, locale),
  ]);
  const bookable = new Set(
    services.filter((service) => service.isActive && service.providerCount > 0).map((s) => s.id),
  );
  const sorted = [...offerings].sort(
    (a, b) =>
      OFFER_CATEGORIES.indexOf(a.content.category) - OFFER_CATEGORIES.indexOf(b.content.category) ||
      a.content.sortOrder - b.content.sortOrder ||
      a.content.title.localeCompare(b.content.title, 'nl'),
  );
  return {
    offerings: sorted.map((record) => toAdminOffering(record, services, bookable)),
    services,
  };
}

/** One offering by id for the edit screen; `null` when unknown. `offering.manage`. */
export async function getOfferingForAdmin(
  offeringId: string,
  locale: string = DEFAULT_LOCALE,
): Promise<{ offering: AdminOffering; services: AdminOfferingService[] } | null> {
  const overview = await listOfferingsForAdmin(locale);
  const offering = overview.offerings.find((entry) => entry.id === offeringId);
  return offering ? { offering, services: overview.services } : null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

const AUDIENCE_SLUGS: Record<OfferingAudience, string> = {
  all: '',
  adult: 'volwassene',
  youth: 'jeugd',
};

/** A service slug no other service in the locale uses: the base, else `-2`, `-3`, … */
async function freeServiceSlug(db: CmsDatabase, locale: string, base: string): Promise<string> {
  const taken = new Set(
    (
      await db
        .select({ slug: cmsServices.slug })
        .from(cmsServices)
        .where(eq(cmsServices.locale, locale))
    ).map((row) => row.slug),
  );
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error('no free service slug');
}

type ServiceSyncContext = {
  db: CmsDatabase;
  actor: CmsUserPublic;
  locale: string;
  content: OfferingContent;
  direct: boolean;
};

/**
 * The `cms_services` row of one variant: created on the first save with
 * service facts, updated afterwards (by id, so bookings and subscriptions
 * keep pointing at it). Returns the service id, or the existing one unchanged
 * when no facts were given (an enquiry keeps whatever it had).
 */
async function syncVariantService(
  context: ServiceSyncContext,
  audience: OfferingAudience,
  existingServiceId: string | null,
  service: VariantServiceInput | null,
): Promise<RepoResult<string | null>> {
  const { db, actor, locale, content, direct } = context;
  if (!service) return { ok: true, data: existingServiceId };
  if (!(await locationExists(service.locationId))) return err('Deze locatie bestaat niet.');

  const label = AUDIENCE_LABELS[audience];
  const audienceIndex = audience === 'youth' ? 1 : 0;
  const shared = {
    name: label ? `${content.title} – ${label}` : content.title,
    choiceLabel: label,
    description: content.summary,
    durationMinutes: service.durationMinutes,
    bufferAfterMinutes: service.bufferAfterMinutes,
    locationId: service.locationId,
    requiresGuardian: service.requiresGuardian,
    sortOrder:
      OFFER_CATEGORIES.indexOf(content.category) * 1000 + content.sortOrder * 2 + audienceIndex,
    updatedAt: new Date(),
  };

  if (existingServiceId) {
    const [existing] = await db
      .select({ id: cmsServices.id, isActive: cmsServices.isActive })
      .from(cmsServices)
      .where(and(eq(cmsServices.id, existingServiceId), eq(cmsServices.locale, locale)))
      .limit(1);
    if (!existing) return err('Een gekozen dienst bestaat niet (meer).');
    await db
      .update(cmsServices)
      .set({ ...shared, isActive: direct ? true : existing.isActive })
      .where(eq(cmsServices.id, existing.id));
    return { ok: true, data: existing.id };
  }

  const base = slugify(
    AUDIENCE_SLUGS[audience] ? `${content.slug}-${AUDIENCE_SLUGS[audience]}` : content.slug,
  );
  const slug = await freeServiceSlug(db, locale, base || 'dienst');
  const [created] = await db
    .insert(cmsServices)
    .values({
      ...shared,
      locale,
      slug,
      priceCents: null,
      showPrice: false,
      isActive: true,
      createdBy: actor.id,
    })
    .returning({ id: cmsServices.id });
  await recordAudit(db, actor, {
    action: 'service.create',
    entityType: 'cms_service',
    entityId: created.id,
    summary: `${shared.name} (via Aanbod)`,
  });
  return { ok: true, data: created.id };
}

async function slugTaken(
  db: CmsDatabase,
  locale: string,
  slug: string,
  exceptId: string | null,
): Promise<boolean> {
  const [clash] = await db
    .select({ id: cmsOfferings.id })
    .from(cmsOfferings)
    .where(
      and(
        eq(cmsOfferings.locale, locale),
        eq(cmsOfferings.slug, slug),
        exceptId ? ne(cmsOfferings.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return Boolean(clash);
}

function bust(locale: string, slugs: string[]): void {
  revalidateContent({
    tags: [OFFERING_TAG, BOOKING_TAG],
    paths: [OFFER_INDEX_PATH, BOOKING_PAGE_PATH, ...slugs.map((slug) => offerPagePath(slug))],
  });
  void locale;
}

function describeSettings(settings: OfferingSettings): string {
  return `${settings.isListed ? 'getoond' : 'verborgen'}, ${
    settings.bookingMode === 'direct' ? 'online boeken' : 'aanvraag'
  }, ${settings.variants
    .map((variant) =>
      [
        AUDIENCE_LABELS[variant.audience] || 'één optie',
        variant.priceCents != null ? `${variant.priceCents} cent` : 'op aanvraag',
      ].join(' '),
    )
    .join(' / ')}`;
}

/**
 * Creates or updates one offering (`offering.manage`): the copy, the
 * settings, the variant rows and — for every variant with service facts —
 * its `cms_services` row. Variants are rewritten to exactly the mode's
 * audiences; a variant that disappears keeps its service row (deactivated by
 * nothing here, held back by `withheldServiceIds()` while unused).
 */
async function writeOffering(
  existingId: string | null,
  locale: string,
  input: SaveOfferingInput,
): Promise<RepoResult<{ id: string; slug: string }>> {
  const actor = await requirePermission('offering.manage');
  const content = validateOfferingContent(input.content);
  if (!content.ok) return err(content.message);
  const validated = validateOfferingInput(input.settings);
  if (!validated.ok) return err(validated.message);
  const { settings, services } = validated.data;

  const db = await getCmsDb();
  let previousSlug: string | null = null;
  if (existingId) {
    const [existing] = await db
      .select({ id: cmsOfferings.id, slug: cmsOfferings.slug, locale: cmsOfferings.locale })
      .from(cmsOfferings)
      .where(eq(cmsOfferings.id, existingId))
      .limit(1);
    if (!existing || existing.locale !== locale) return err('Dit aanbod bestaat niet (meer).');
    previousSlug = existing.slug;
  }
  if (await slugTaken(db, locale, content.data.slug, existingId)) {
    return err(`Er bestaat al een aanbod met de slug “${content.data.slug}”.`);
  }

  // A service chosen for a variant must exist in this locale.
  const serviceIds = settings.variants
    .map((variant) => variant.serviceId)
    .filter((id): id is string => Boolean(id));
  if (serviceIds.length) {
    const found = await db
      .select({ id: cmsServices.id })
      .from(cmsServices)
      .where(and(inArray(cmsServices.id, serviceIds), eq(cmsServices.locale, locale)));
    if (found.length !== serviceIds.length) return err('Een gekozen dienst bestaat niet (meer).');
  }

  const now = new Date();
  const columns = {
    slug: content.data.slug,
    category: content.data.category,
    sortOrder: content.data.sortOrder,
    title: content.data.title,
    summary: content.data.summary,
    intro: content.data.intro,
    goal: content.data.goal,
    contents: content.data.contents,
    extras: content.data.extras,
    extrasNote: content.data.extrasNote,
    duration: content.data.duration,
    ctaLabel: content.data.ctaLabel,
    image: content.data.image,
    metaDescription: content.data.metaDescription,
    isListed: settings.isListed,
    bookingMode: settings.bookingMode,
    variantMode: settings.variantMode,
    updatedBy: actor.id,
    updatedAt: now,
  };
  let offeringId = existingId;
  if (offeringId) {
    await db.update(cmsOfferings).set(columns).where(eq(cmsOfferings.id, offeringId));
  } else {
    const [row] = await db
      .insert(cmsOfferings)
      .values({ ...columns, locale })
      .returning({ id: cmsOfferings.id });
    offeringId = row.id;
  }

  const sync: ServiceSyncContext = {
    db,
    actor,
    locale,
    content: content.data,
    direct: settings.bookingMode === 'direct',
  };
  const written: string[] = [];
  // Upsert the new variants first, then drop the audiences no longer used, so a
  // failure half-way never leaves the offering without variants (neon-http has
  // no transactions).
  for (const variant of settings.variants) {
    const synced = await syncVariantService(
      sync,
      variant.audience,
      variant.serviceId,
      services[variant.audience] ?? null,
    );
    if (!synced.ok) return synced;
    if (synced.data) written.push(synced.data);
    await db
      .insert(cmsOfferingVariants)
      .values({
        offeringId,
        audience: variant.audience,
        serviceId: synced.data,
        priceCents: variant.priceCents,
      })
      .onConflictDoUpdate({
        target: [cmsOfferingVariants.offeringId, cmsOfferingVariants.audience],
        set: { serviceId: synced.data, priceCents: variant.priceCents },
      });
  }
  await db.delete(cmsOfferingVariants).where(
    and(
      eq(cmsOfferingVariants.offeringId, offeringId),
      notInArray(
        cmsOfferingVariants.audience,
        settings.variants.map((variant) => variant.audience),
      ),
    ),
  );

  await recordAudit(db, actor, {
    action: existingId ? 'offering.update' : 'offering.create',
    entityType: 'cms_offering',
    entityId: offeringId,
    summary: `${content.data.title}: ${describeSettings(settings)}`,
    metadata: { slug: content.data.slug, settings, services: written },
  });
  bust(
    locale,
    previousSlug && previousSlug !== content.data.slug
      ? [previousSlug, content.data.slug]
      : [content.data.slug],
  );
  return { ok: true, data: { id: offeringId, slug: content.data.slug } };
}

export function createOffering(
  input: SaveOfferingInput,
  locale: string = DEFAULT_LOCALE,
): Promise<RepoResult<{ id: string; slug: string }>> {
  return writeOffering(null, locale, input);
}

export function updateOffering(
  offeringId: string,
  input: SaveOfferingInput,
  locale: string = DEFAULT_LOCALE,
): Promise<RepoResult<{ id: string; slug: string }>> {
  return writeOffering(offeringId, locale, input);
}

/**
 * Removes an offering (`offering.manage`). Its variants go by cascade; the
 * services they were booked as are deactivated (soft: existing bookings keep
 * their service, providers keep their rows) unless another offering still uses
 * them.
 */
export async function deleteOffering(offeringId: string): Promise<RepoResult<true>> {
  const actor = await requirePermission('offering.manage');
  const db = await getCmsDb();
  const [existing] = await db
    .select({
      id: cmsOfferings.id,
      slug: cmsOfferings.slug,
      title: cmsOfferings.title,
      locale: cmsOfferings.locale,
    })
    .from(cmsOfferings)
    .where(eq(cmsOfferings.id, offeringId))
    .limit(1);
  if (!existing) return err('Dit aanbod bestaat niet (meer).');

  const variants = await db
    .select({ serviceId: cmsOfferingVariants.serviceId })
    .from(cmsOfferingVariants)
    .where(eq(cmsOfferingVariants.offeringId, offeringId));
  const serviceIds = variants
    .map((variant) => variant.serviceId)
    .filter((id): id is string => Boolean(id));
  if (serviceIds.length) {
    const elsewhere = new Set(
      (
        await db
          .select({ serviceId: cmsOfferingVariants.serviceId })
          .from(cmsOfferingVariants)
          .where(
            and(
              inArray(cmsOfferingVariants.serviceId, serviceIds),
              ne(cmsOfferingVariants.offeringId, offeringId),
            ),
          )
      ).map((row) => row.serviceId),
    );
    const toDeactivate = serviceIds.filter((id) => !elsewhere.has(id));
    if (toDeactivate.length) {
      await db
        .update(cmsServices)
        .set({ isActive: false, updatedAt: new Date() })
        .where(inArray(cmsServices.id, toDeactivate));
    }
  }

  await db.delete(cmsOfferings).where(eq(cmsOfferings.id, offeringId));
  await recordAudit(db, actor, {
    action: 'offering.delete',
    entityType: 'cms_offering',
    entityId: offeringId,
    summary: existing.title,
    metadata: { slug: existing.slug, services: serviceIds },
  });
  bust(existing.locale, [existing.slug]);
  return { ok: true, data: true };
}

// ---------------------------------------------------------------------------
// For the providers' own subscription form (Mijn agenda → Mijn aanbod)
// ---------------------------------------------------------------------------

export type OfferingSubscriptionGroup = {
  id: string;
  title: string;
  /** Shown and booked directly; else the services are not bookable through this offering now. */
  bookable: boolean;
  variants: { serviceId: string; label: string }[];
};

/**
 * The offerings that book through services, for grouping a provider's own
 * subscription form. `service.read` (providers have it): titles, variant
 * labels and service ids only, no prices or settings beyond "online now".
 */
export async function listOfferingSubscriptionGroups(
  locale: string = DEFAULT_LOCALE,
): Promise<OfferingSubscriptionGroup[]> {
  await requirePermission('service.read');
  const offerings = await readStoredOfferings(locale);
  return offerings
    .filter((record) => record.settings.variants.some((variant) => variant.serviceId))
    .sort(
      (a, b) =>
        OFFER_CATEGORIES.indexOf(a.content.category) -
          OFFER_CATEGORIES.indexOf(b.content.category) ||
        a.content.sortOrder - b.content.sortOrder ||
        a.content.title.localeCompare(b.content.title, 'nl'),
    )
    .map((record) => ({
      id: record.id,
      title: record.content.title,
      bookable: record.settings.isListed && record.settings.bookingMode === 'direct',
      variants: record.settings.variants
        .filter((variant) => variant.serviceId)
        .map((variant) => ({
          serviceId: variant.serviceId!,
          label: AUDIENCE_LABELS[variant.audience],
        })),
    }));
}

/** How many offerings exist in a locale (for the empty state of the overview). */
export async function countOfferings(locale: string = DEFAULT_LOCALE): Promise<number> {
  await requirePermission('offering.manage');
  const db = await getCmsDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(cmsOfferings)
    .where(eq(cmsOfferings.locale, locale));
  return Number(row?.count ?? 0);
}
