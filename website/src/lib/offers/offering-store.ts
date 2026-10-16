import 'server-only';
import { asc, eq, inArray } from 'drizzle-orm';
import { unstable_cache } from 'next/cache';
import { getCmsDb } from '@/db/cms';
import { cmsOfferings, cmsOfferingVariants } from '@/db/cms-offering-schema';
import { cmsPages, cmsServices, DEFAULT_LOCALE } from '@/db/cms-schema';
import { BOOKING_TAG } from '@/lib/booking/content';
import { CMS_TAGS } from '@/lib/cms/content';
import { settingsFromRows, type OfferingServiceInfo, type OfferingSettings } from './offering';

/**
 * Cached read of the offering settings (`cms_offerings` + variants) and of the
 * service facts they need, for the public site. The admin screen reads the
 * same tables through `./repo.ts` (uncached, permission-checked).
 *
 * Tags: `cms` (every CMS write), {@link OFFERING_TAG} (Beheer → Aanbod) and
 * `booking` (a service edited in Beheer → Diensten). Values crossing the cache
 * boundary are plain JSON.
 *
 * Read failures are separate on purpose: without migration 0010 the offering
 * tables are missing, and every offer page then simply derives its settings
 * from its block as before (`storeAvailable: false`).
 */

export const OFFERING_TAG = 'cms:offerings';

const REVALIDATE_SECONDS = 300;

export type StoredOffering = {
  pageId: string;
  pageSlug: string;
  pagePublished: boolean;
  settings: OfferingSettings;
};

export type OfferingStore = {
  stored: StoredOffering[];
  services: OfferingServiceInfo[];
  /** `false` when the offering tables could not be read (e.g. before migration 0010). */
  storeAvailable: boolean;
};

async function readServices(locale: string): Promise<OfferingServiceInfo[]> {
  const db = await getCmsDb();
  return db
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
}

/** Every stored offering of a locale (draft and published pages), uncached. */
export async function readStoredOfferings(locale: string): Promise<StoredOffering[]> {
  const db = await getCmsDb();
  const rows = await db
    .select({
      id: cmsOfferings.id,
      pageId: cmsOfferings.pageId,
      isListed: cmsOfferings.isListed,
      bookingMode: cmsOfferings.bookingMode,
      variantMode: cmsOfferings.variantMode,
      pageSlug: cmsPages.slug,
      pageStatus: cmsPages.status,
    })
    .from(cmsOfferings)
    .innerJoin(cmsPages, eq(cmsPages.id, cmsOfferings.pageId))
    .where(eq(cmsPages.locale, locale));
  if (rows.length === 0) return [];
  const variants = await db
    .select()
    .from(cmsOfferingVariants)
    .where(
      inArray(
        cmsOfferingVariants.offeringId,
        rows.map((row) => row.id),
      ),
    );
  return rows.map((row) => ({
    pageId: row.pageId,
    pageSlug: row.pageSlug,
    pagePublished: row.pageStatus === 'published',
    settings: settingsFromRows(
      row,
      variants.filter((variant) => variant.offeringId === row.id),
    ),
  }));
}

export async function getOfferingStore(locale: string = DEFAULT_LOCALE): Promise<OfferingStore> {
  const load = unstable_cache(
    async (): Promise<OfferingStore> => {
      const services = await readServices(locale);
      try {
        return { stored: await readStoredOfferings(locale), services, storeAvailable: true };
      } catch {
        // A fixed code, never the error: a failed query's message holds its SQL.
        console.error('[aanbod] offerings_unavailable');
        return { stored: [], services, storeAvailable: false };
      }
    },
    ['cms-offering-store', locale],
    {
      tags: [CMS_TAGS.all, OFFERING_TAG, BOOKING_TAG],
      revalidate: REVALIDATE_SECONDS,
    },
  );
  return load();
}
