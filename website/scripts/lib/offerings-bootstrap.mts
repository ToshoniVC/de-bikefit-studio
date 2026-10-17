/**
 * The default offerings (`src/lib/offers/defaults.ts`) on a database: one
 * `cms_offerings` row per slug that is missing, with its variants linked to
 * the bootstrap services by slug. Shared by `cms-bootstrap.mts` and the
 * self-test. Create-only and idempotent: an existing offering (by locale and
 * slug) is never touched, whatever it holds. Direct database writes, like the
 * rest of the bootstrap (no session, no audit); nothing touches
 * `cms_services`, `cms_provider_services` or `cms_bookings`.
 *
 * Plain imports only: this module runs before any request-context stub.
 */
import type { CmsDatabase } from '@/db/cms';
import { DEFAULT_OFFERINGS, type DefaultOffering } from '@/lib/offers/defaults';

type Orm = typeof import('drizzle-orm');
type OfferingSchema = typeof import('@/db/cms-offering-schema');
type CmsSchema = typeof import('@/db/cms-schema');

export type EnsureOfferingsDeps = {
  db: CmsDatabase;
  orm: Pick<Orm, 'and' | 'eq'>;
  schema: Pick<CmsSchema, 'cmsServices' | 'DEFAULT_LOCALE'>;
  offerings: Pick<OfferingSchema, 'cmsOfferings' | 'cmsOfferingVariants'>;
  log: (symbol: string, message: string) => void;
  locale?: string;
};

export async function ensureDefaultOfferings(
  deps: EnsureOfferingsDeps,
  defaults: readonly DefaultOffering[] = DEFAULT_OFFERINGS,
): Promise<{ created: string[]; kept: string[] }> {
  const { db, orm, schema, offerings, log } = deps;
  const { and, eq } = orm;
  const locale = deps.locale ?? schema.DEFAULT_LOCALE;
  const services = await db
    .select({ id: schema.cmsServices.id, slug: schema.cmsServices.slug })
    .from(schema.cmsServices)
    .where(eq(schema.cmsServices.locale, locale));
  const serviceId = new Map(services.map((row) => [row.slug, row.id]));

  const created: string[] = [];
  const kept: string[] = [];
  for (const entry of defaults) {
    const { content } = entry;
    const [existing] = await db
      .select({ id: offerings.cmsOfferings.id })
      .from(offerings.cmsOfferings)
      .where(
        and(
          eq(offerings.cmsOfferings.locale, locale),
          eq(offerings.cmsOfferings.slug, content.slug),
        ),
      )
      .limit(1);
    if (existing) {
      kept.push(content.slug);
      log('=', `offering ${locale}/${content.slug} already exists — left untouched`);
      continue;
    }
    const [row] = await db
      .insert(offerings.cmsOfferings)
      .values({
        locale,
        slug: content.slug,
        category: content.category,
        sortOrder: content.sortOrder,
        title: content.title,
        summary: content.summary,
        intro: content.intro,
        goal: content.goal,
        contents: content.contents,
        extras: content.extras,
        extrasNote: content.extrasNote,
        duration: content.duration,
        ctaLabel: content.ctaLabel,
        image: content.image,
        metaDescription: content.metaDescription,
        pageId: null,
        isListed: entry.isListed,
        bookingMode: entry.bookingMode,
        variantMode: entry.variantMode,
      })
      .returning({ id: offerings.cmsOfferings.id });
    const linked: string[] = [];
    for (const variant of entry.variants) {
      const id = variant.serviceSlug ? (serviceId.get(variant.serviceSlug) ?? null) : null;
      if (variant.serviceSlug && !id) {
        log(
          '!',
          `offering ${content.slug}: service ${variant.serviceSlug} is missing — variant saved without a service`,
        );
      }
      if (id) linked.push(variant.serviceSlug!);
      await db.insert(offerings.cmsOfferingVariants).values({
        offeringId: row.id,
        audience: variant.audience,
        serviceId: id,
        priceCents: null,
      });
    }
    created.push(content.slug);
    log(
      '+',
      `offering ${locale}/${content.slug} created (${entry.isListed ? 'shown' : 'hidden'}, ${entry.bookingMode}${
        linked.length ? `, services ${linked.join(' + ')}` : ''
      })`,
    );
  }
  return { created, kept };
}
