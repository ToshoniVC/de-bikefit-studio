import 'server-only';
import { asc, eq, inArray } from 'drizzle-orm';
import { unstable_cache } from 'next/cache';
import { getCmsDb } from '@/db/cms';
import { cmsOfferings, cmsOfferingVariants } from '@/db/cms-offering-schema';
import { cmsServices, DEFAULT_LOCALE } from '@/db/cms-schema';
import { BOOKING_TAG } from '@/lib/booking/content';
import { CMS_TAGS } from '@/lib/cms/content';
import { settingsFromRows, type OfferingServiceInfo } from './offering';
import { contentFromRow, type OfferingRecord } from './offering-content';

/**
 * Cached read of the offerings (`cms_offerings` + variants: copy and
 * settings) and of the service facts they need, for the public site. The
 * admin screen reads the same tables through `./repo.ts` (uncached,
 * permission-checked).
 *
 * Tags: `cms` (every CMS write), {@link OFFERING_TAG} (Beheer → Aanbod) and
 * `booking` (a provider changing what they offer). Values crossing the cache
 * boundary are plain JSON.
 *
 * A failed read is reported with a fixed code and answered with an empty
 * catalogue (`storeAvailable: false`): the overviews then list nothing and the
 * booking actions refuse every service (fail closed), which is what a missing
 * migration 0010/0011 should look like, never a crash of the page.
 */

export const OFFERING_TAG = 'cms:offerings';

const REVALIDATE_SECONDS = 300;

export type OfferingStore = {
  offerings: OfferingRecord[];
  services: OfferingServiceInfo[];
  /** `false` when the offering tables could not be read (e.g. before migration 0011). */
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

/** Every offering of a locale (shown or not), uncached. */
export async function readStoredOfferings(locale: string): Promise<OfferingRecord[]> {
  const db = await getCmsDb();
  const rows = await db
    .select()
    .from(cmsOfferings)
    .where(eq(cmsOfferings.locale, locale))
    .orderBy(asc(cmsOfferings.sortOrder), asc(cmsOfferings.title));
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
    id: row.id,
    locale: row.locale,
    content: contentFromRow(row),
    settings: settingsFromRows(
      row,
      variants.filter((variant) => variant.offeringId === row.id),
    ),
    updatedAt: new Date(row.updatedAt).toISOString(),
  }));
}

export async function getOfferingStore(locale: string = DEFAULT_LOCALE): Promise<OfferingStore> {
  const load = unstable_cache(
    async (): Promise<OfferingStore> => {
      try {
        const [offerings, services] = await Promise.all([
          readStoredOfferings(locale),
          readServices(locale),
        ]);
        return { offerings, services, storeAvailable: true };
      } catch {
        // A fixed code, never the error: a failed query's message holds its SQL.
        console.error('[aanbod] offerings_unavailable');
        return { offerings: [], services: [], storeAvailable: false };
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
