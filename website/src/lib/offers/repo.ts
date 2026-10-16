import 'server-only';
import { and, asc, eq, inArray, like, notInArray, sql } from 'drizzle-orm';
import { getCmsDb, type CmsDatabase } from '@/db/cms';
import { cmsOfferings, cmsOfferingVariants } from '@/db/cms-offering-schema';
import {
  cmsBlocks,
  cmsPages,
  cmsProviderServices,
  cmsProviders,
  cmsServices,
  cmsUsers,
  DEFAULT_LOCALE,
} from '@/db/cms-schema';
import { BOOKING_TAG } from '@/lib/booking/content';
import { recordAudit, requirePermission } from '@/lib/cms/auth';
import { parsePublishedSnapshot } from '@/lib/cms/blocks';
import { publicPathFor, revalidateContent, type RepoResult } from '@/lib/cms/repo';
import {
  isOfferCategory,
  OFFER_PAGE_PREFIX,
  offerSlugFromPageSlug,
  type OfferCategory,
} from './catalogue';
import { legacyFieldsOf } from './offer-catalogue';
import {
  AUDIENCE_LABELS,
  resolveOffering,
  validateOfferingInput,
  type OfferingServiceInfo,
  type OfferingSettings,
  type OfferingSource,
  type ResolvedOffering,
} from './offering';
import { deriveLegacyOffering } from './offering-legacy';
import { OFFERING_TAG, readStoredOfferings } from './offering-store';

/**
 * Beheer → Aanbod: the admin read and write API for offering settings.
 *
 * Same contract as the other repos: permission first (`offering.manage`,
 * editors and admins), then the rows; Dutch `RepoResult` messages; every write
 * audited (`offering.update`) and the caches busted (`cms:offerings`, `cms`,
 * `booking`). Uncached on purpose: the editor sees the database, and the
 * public site reads through `offering-store.ts`.
 *
 * A save writes only `cms_offerings` + `cms_offering_variants`. It never
 * creates, renames, prices or deactivates a `cms_services` row (that stays
 * `service.manage`), never touches `cms_provider_services` (providers subscribe
 * themselves) or `cms_bookings`, and never edits the page's blocks.
 */

export type AdminOfferingService = OfferingServiceInfo & {
  /** Active providers (with an active account) subscribed to it. */
  providerCount: number;
};

export type AdminOffering = {
  pageId: string;
  pageSlug: string;
  offerSlug: string;
  path: string;
  /** The offer block's title (published version, else the draft). */
  title: string;
  category: OfferCategory;
  sortOrder: number;
  pageStatus: 'draft' | 'published';
  source: OfferingSource;
  settings: OfferingSettings;
  resolved: ResolvedOffering;
  /** Why a page-derived setting is not an exact copy (only for `legacy`). */
  legacyNotes: string[];
};

export type AdminOfferingOverview = {
  offerings: AdminOffering[];
  services: AdminOfferingService[];
};

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
      isActive: cmsServices.isActive,
      requiresGuardian: cmsServices.requiresGuardian,
      priceCents: cmsServices.priceCents,
      showPrice: cmsServices.showPrice,
    })
    .from(cmsServices)
    .where(eq(cmsServices.locale, locale))
    .orderBy(asc(cmsServices.sortOrder), asc(cmsServices.name));
  // The public rule (`listPublicServices()`): an active provider with an active account.
  const counts = await db
    .select({ serviceId: cmsProviderServices.serviceId, count: sql<number>`count(*)::int` })
    .from(cmsProviderServices)
    .innerJoin(cmsProviders, eq(cmsProviders.id, cmsProviderServices.providerId))
    .innerJoin(cmsUsers, eq(cmsUsers.id, cmsProviders.userId))
    .where(and(eq(cmsProviders.isActive, true), eq(cmsUsers.isActive, true)))
    .groupBy(cmsProviderServices.serviceId);
  const countBy = new Map(counts.map((row) => [row.serviceId, Number(row.count)]));
  return rows.map((row) => ({ ...row, providerCount: countBy.get(row.id) ?? 0 }));
}

type OfferPageRow = {
  id: string;
  slug: string;
  status: 'draft' | 'published';
  publishedSnapshot: unknown;
};

/** The `offer` block of a page: the published version, else the draft. */
async function offerBlockOf(
  db: CmsDatabase,
  page: OfferPageRow,
): Promise<{ data: Record<string, unknown> } | null> {
  if (page.status === 'published') {
    const snapshot = parsePublishedSnapshot(page.publishedSnapshot);
    const block = snapshot?.blocks.find((entry) => entry.type === 'offer');
    if (block) return { data: block.data as unknown as Record<string, unknown> };
  }
  const [draft] = await db
    .select({ data: cmsBlocks.data })
    .from(cmsBlocks)
    .where(and(eq(cmsBlocks.pageId, page.id), eq(cmsBlocks.type, 'offer')))
    .orderBy(asc(cmsBlocks.sortOrder))
    .limit(1);
  return draft ? { data: draft.data } : null;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Every offer page (draft or published) with its settings; `offering.manage`. */
export async function listOfferingsForAdmin(
  locale: string = DEFAULT_LOCALE,
): Promise<AdminOfferingOverview> {
  await requirePermission('offering.manage');
  const db = await getCmsDb();
  const [pages, services, stored] = await Promise.all([
    db
      .select({
        id: cmsPages.id,
        slug: cmsPages.slug,
        status: cmsPages.status,
        publishedSnapshot: cmsPages.publishedSnapshot,
      })
      .from(cmsPages)
      .where(and(eq(cmsPages.locale, locale), like(cmsPages.slug, `${OFFER_PAGE_PREFIX}/%`)))
      .orderBy(asc(cmsPages.slug)),
    readOfferingServices(db, locale),
    readStoredOfferings(locale),
  ]);
  const bookable = new Set(
    services.filter((service) => service.isActive && service.providerCount > 0).map((s) => s.id),
  );

  const offerings: AdminOffering[] = [];
  for (const page of pages) {
    const offerSlug = offerSlugFromPageSlug(page.slug);
    if (!offerSlug) continue;
    const block = await offerBlockOf(db, page);
    if (!block) continue; // the gift voucher and other non-offer pages
    const row = stored.find((entry) => entry.pageId === page.id);
    const legacy = row ? null : deriveLegacyOffering(legacyFieldsOf(block.data), services);
    const settings = row?.settings ?? legacy!.settings;
    const source: OfferingSource = row ? 'stored' : 'legacy';
    const category = text(block.data.category, 'bikefit');
    offerings.push({
      pageId: page.id,
      pageSlug: page.slug,
      offerSlug,
      path: publicPathFor(locale, page.slug),
      title: text(block.data.title, offerSlug),
      category: isOfferCategory(category) ? category : 'bikefit',
      sortOrder: typeof block.data.sortOrder === 'number' ? block.data.sortOrder : 0,
      pageStatus: page.status,
      source,
      settings,
      resolved: resolveOffering({ settings, source, services, bookableServiceIds: bookable }),
      legacyNotes: legacy?.notes ?? [],
    });
  }
  return { offerings, services };
}

/**
 * Saves one offering's settings (`offering.manage`). The page must be an
 * offer page with an `offer` block; a service chosen for a variant must exist
 * in the page's locale and, for direct booking, be active. Variants are
 * rewritten to exactly the mode's audiences.
 */
export async function saveOffering(pageId: string, input: unknown): Promise<RepoResult<true>> {
  const actor = await requirePermission('offering.manage');
  const validation = validateOfferingInput(input);
  if (!validation.ok) return { ok: false, message: validation.message };
  const settings = validation.data;

  const db = await getCmsDb();
  const [page] = await db
    .select({
      id: cmsPages.id,
      slug: cmsPages.slug,
      locale: cmsPages.locale,
      status: cmsPages.status,
      publishedSnapshot: cmsPages.publishedSnapshot,
      title: cmsPages.title,
    })
    .from(cmsPages)
    .where(eq(cmsPages.id, pageId))
    .limit(1);
  if (!page || !offerSlugFromPageSlug(page.slug)) {
    return { ok: false, message: 'Dit aanbod bestaat niet (meer).' };
  }
  if (!(await offerBlockOf(db, page))) {
    return { ok: false, message: 'Deze pagina heeft geen blok “Dienst (aanbod)”.' };
  }

  const serviceIds = settings.variants
    .map((variant) => variant.serviceId)
    .filter((id): id is string => Boolean(id));
  if (serviceIds.length) {
    const found = await db
      .select({ id: cmsServices.id, isActive: cmsServices.isActive, locale: cmsServices.locale })
      .from(cmsServices)
      .where(inArray(cmsServices.id, serviceIds));
    if (
      found.length !== serviceIds.length ||
      found.some((service) => service.locale !== page.locale)
    ) {
      return { ok: false, message: 'Een gekozen dienst bestaat niet (meer).' };
    }
    if (settings.bookingMode === 'direct' && found.some((service) => !service.isActive)) {
      return {
        ok: false,
        message: 'Kies een actieve dienst om online te boeken (Beheer → Diensten).',
      };
    }
  }

  const now = new Date();
  const [offering] = await db
    .insert(cmsOfferings)
    .values({
      pageId,
      isListed: settings.isListed,
      bookingMode: settings.bookingMode,
      variantMode: settings.variantMode,
      updatedBy: actor.id,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: cmsOfferings.pageId,
      set: {
        isListed: settings.isListed,
        bookingMode: settings.bookingMode,
        variantMode: settings.variantMode,
        updatedBy: actor.id,
        updatedAt: now,
      },
    })
    .returning({ id: cmsOfferings.id });

  // Upsert the new variants first, then drop the audiences no longer used, so a
  // failure half-way never leaves the offering without variants (neon-http has
  // no transactions).
  for (const variant of settings.variants) {
    await db
      .insert(cmsOfferingVariants)
      .values({
        offeringId: offering.id,
        audience: variant.audience,
        serviceId: variant.serviceId,
        priceCents: variant.priceCents,
      })
      .onConflictDoUpdate({
        target: [cmsOfferingVariants.offeringId, cmsOfferingVariants.audience],
        set: { serviceId: variant.serviceId, priceCents: variant.priceCents },
      });
  }
  await db.delete(cmsOfferingVariants).where(
    and(
      eq(cmsOfferingVariants.offeringId, offering.id),
      notInArray(
        cmsOfferingVariants.audience,
        settings.variants.map((variant) => variant.audience),
      ),
    ),
  );

  await recordAudit(db, actor, {
    action: 'offering.update',
    entityType: 'cms_offering',
    entityId: offering.id,
    summary: `${page.title}: ${settings.isListed ? 'getoond' : 'verborgen'}, ${
      settings.bookingMode === 'direct' ? 'online boeken' : 'aanvraag'
    }, ${settings.variants
      .map((variant) =>
        [
          AUDIENCE_LABELS[variant.audience] || 'één optie',
          variant.priceCents != null ? `${variant.priceCents} cent` : 'op aanvraag',
        ].join(' '),
      )
      .join(' / ')}`,
    metadata: { pageId, settings },
  });
  revalidateContent({
    tags: [OFFERING_TAG, BOOKING_TAG],
    paths: [publicPathFor(page.locale, page.slug)],
  });
  return { ok: true, data: true };
}

// ---------------------------------------------------------------------------
// For the providers' own subscription form (Mijn agenda → Mijn aanbod)
// ---------------------------------------------------------------------------

export type OfferingSubscriptionGroup = {
  title: string;
  /** Saved in Beheer → Aanbod (else derived from the page, as before). */
  stored: boolean;
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
  const db = await getCmsDb();
  const [pages, services, stored] = await Promise.all([
    db
      .select({
        id: cmsPages.id,
        slug: cmsPages.slug,
        status: cmsPages.status,
        publishedSnapshot: cmsPages.publishedSnapshot,
      })
      .from(cmsPages)
      .where(and(eq(cmsPages.locale, locale), like(cmsPages.slug, `${OFFER_PAGE_PREFIX}/%`)))
      .orderBy(asc(cmsPages.slug)),
    readOfferingServices(db, locale),
    readStoredOfferings(locale),
  ]);

  const groups: Array<OfferingSubscriptionGroup & { sort: [number, number, string] }> = [];
  for (const page of pages) {
    const block = await offerBlockOf(db, page);
    if (!block) continue;
    const row = stored.find((entry) => entry.pageId === page.id);
    // Without a row, only a published page linked services before (legacy).
    if (!row && page.status !== 'published') continue;
    const settings =
      row?.settings ?? deriveLegacyOffering(legacyFieldsOf(block.data), services).settings;
    const variants = settings.variants
      .filter((variant) => variant.serviceId)
      .map((variant) => ({
        serviceId: variant.serviceId!,
        label: AUDIENCE_LABELS[variant.audience],
      }));
    if (variants.length === 0) continue;
    const category = text(block.data.category, 'bikefit');
    groups.push({
      title: text(block.data.title, page.slug),
      stored: Boolean(row),
      bookable:
        page.status === 'published' && settings.isListed && settings.bookingMode === 'direct',
      variants,
      sort: [
        ['bikefit', 'begeleiding', 'overige'].indexOf(category),
        typeof block.data.sortOrder === 'number' ? block.data.sortOrder : 0,
        text(block.data.title),
      ],
    });
  }
  return groups
    .sort(
      (a, b) =>
        a.sort[0] - b.sort[0] || a.sort[1] - b.sort[1] || a.sort[2].localeCompare(b.sort[2], 'nl'),
    )
    .map((group) => ({
      title: group.title,
      stored: group.stored,
      bookable: group.bookable,
      variants: group.variants,
    }));
}
