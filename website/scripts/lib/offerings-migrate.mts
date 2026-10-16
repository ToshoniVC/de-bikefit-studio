/**
 * Core of `npm run cms:migrate-offerings` (and self-test section 14d): writes a
 * `cms_offerings` row for every published offer page that has none yet, with
 * exactly the settings the site already derives from the page's `offer` block
 * (`deriveLegacyOffering()`), so the public site looks the same before and
 * after. Nothing else.
 *
 *   plan   read-only (`readOnlyDb()`): per offer page, `create` (an exact
 *          derivation), `manual` (not exact: an editor decides in Beheer →
 *          Aanbod; the page keeps its derived behaviour meanwhile), `skip`
 *          (draft page, or settings already saved)
 *   apply  writes the `create` rows through the real repo (`saveOffering()`:
 *          `offering.manage`, validation, audit `offering.update`, cache bust)
 *          inside a short-lived admin session, and checks with `guardCounts()`
 *          that bookings, services and provider subscriptions are untouched
 *
 * Idempotent: a second run finds nothing to create. Undo: delete the rows
 * (`DELETE FROM cms_offerings WHERE page_id IN (…)`, variants cascade); the
 * pages then derive the same settings again. No page, block, service,
 * subscription or booking is ever written.
 */
import { offerSlugFromPageSlug } from '@/lib/offers/catalogue';
import { legacyFieldsOf } from '@/lib/offers/offer-catalogue';
import {
  AUDIENCE_LABELS,
  type OfferingServiceInfo,
  type OfferingSettings,
} from '@/lib/offers/offering';
import { deriveLegacyOffering } from '@/lib/offers/offering-legacy';
import { guardCounts, pagePath, type PlanDeps } from './aanbod-rollout.mjs';
import {
  findActor,
  readOnlyDb,
  withAdminSession,
  type RolloutRunContext,
} from './aanbod-rollout-run.mjs';

export type OfferingMigrationEntry = {
  pageId: string;
  path: string;
  title: string;
  action: 'create' | 'manual' | 'skip';
  reason: string;
  settings: OfferingSettings | null;
  notes: string[];
};

export type OfferingMigrationPlan = { locale: string; entries: OfferingMigrationEntry[] };

export async function planOfferingMigration(deps: PlanDeps): Promise<OfferingMigrationPlan> {
  const { db, orm, schema, locale } = deps;
  const { and, asc, eq, like } = orm;
  const offeringSchema = await import('@/db/cms-offering-schema');

  const pages = await db
    .select()
    .from(schema.cmsPages)
    .where(and(eq(schema.cmsPages.locale, locale), like(schema.cmsPages.slug, 'aanbod/%')))
    .orderBy(asc(schema.cmsPages.slug));
  const existing = new Set(
    (
      await db
        .select({ pageId: offeringSchema.cmsOfferings.pageId })
        .from(offeringSchema.cmsOfferings)
    ).map((row) => row.pageId),
  );
  const services: OfferingServiceInfo[] = await db
    .select({
      id: schema.cmsServices.id,
      slug: schema.cmsServices.slug,
      name: schema.cmsServices.name,
      choiceLabel: schema.cmsServices.choiceLabel,
      durationMinutes: schema.cmsServices.durationMinutes,
      isActive: schema.cmsServices.isActive,
      requiresGuardian: schema.cmsServices.requiresGuardian,
      priceCents: schema.cmsServices.priceCents,
      showPrice: schema.cmsServices.showPrice,
    })
    .from(schema.cmsServices)
    .where(eq(schema.cmsServices.locale, locale));

  const entries: OfferingMigrationEntry[] = [];
  for (const page of pages) {
    if (!offerSlugFromPageSlug(page.slug)) continue;
    const snapshot = deps.blocks.parsePublishedSnapshot(page.publishedSnapshot);
    const block = snapshot?.blocks.find((entry) => entry.type === 'offer');
    const base = { pageId: page.id, path: pagePath(page.slug), notes: [] as string[] };
    if (page.status !== 'published' || !block) {
      // The gift voucher (no `offer` block) and drafts: nothing is derived for them today.
      if (page.status !== 'published') {
        entries.push({
          ...base,
          title: page.title,
          action: 'skip',
          reason: 'draft page: set it in Beheer → Aanbod when it is ready',
          settings: null,
        });
      }
      continue;
    }
    const title = (block.data as { title?: string }).title ?? page.title;
    if (existing.has(page.id)) {
      entries.push({
        ...base,
        title,
        action: 'skip',
        reason: 'settings already saved',
        settings: null,
      });
      continue;
    }
    const derived = deriveLegacyOffering(legacyFieldsOf(block.data), services);
    entries.push({
      ...base,
      title,
      action: derived.exact ? 'create' : 'manual',
      reason: derived.exact
        ? 'same settings as the page shows today'
        : 'not an exact copy: decide in Beheer → Aanbod (the page keeps its current behaviour)',
      settings: derived.settings,
      notes: derived.notes,
    });
  }
  return { locale, entries };
}

function describe(settings: OfferingSettings, services: Map<string, string>): string {
  const variants = settings.variants
    .map((variant) => {
      const label = AUDIENCE_LABELS[variant.audience] || 'één optie';
      const service = variant.serviceId ? (services.get(variant.serviceId) ?? '?') : 'geen dienst';
      const price = variant.priceCents != null ? `${variant.priceCents} cent` : 'op aanvraag';
      return `${label} = ${service}, ${price}`;
    })
    .join('; ');
  return `${settings.isListed ? 'shown' : 'hidden'}, ${settings.bookingMode}, ${variants}`;
}

export async function printOfferingMigrationPlan(
  plan: OfferingMigrationPlan,
  deps: PlanDeps,
): Promise<void> {
  const rows = await deps.db
    .select({ id: deps.schema.cmsServices.id, slug: deps.schema.cmsServices.slug })
    .from(deps.schema.cmsServices);
  const names = new Map(rows.map((row) => [row.id, row.slug]));
  deps.log('=', `locale ${plan.locale}: ${plan.entries.length} offer page(s)`);
  for (const entry of plan.entries) {
    const symbol = entry.action === 'create' ? '+' : entry.action === 'manual' ? '!' : '=';
    deps.log(symbol, `${entry.path} (${entry.title}) — ${entry.action}: ${entry.reason}`);
    if (entry.settings) deps.log(' ', `  ${describe(entry.settings, names)}`);
    for (const note of entry.notes) deps.log(' ', `  note: ${note}`);
  }
}

export type OfferingMigrationDeps = PlanDeps & {
  saveOffering: (pageId: string, input: unknown) => Promise<{ ok: boolean; message?: string }>;
};

export async function applyOfferingMigration(
  deps: OfferingMigrationDeps,
): Promise<{ created: string[] }> {
  const plan = await planOfferingMigration(deps);
  const targets = plan.entries.filter((entry) => entry.action === 'create' && entry.settings);
  if (targets.length === 0) {
    deps.log('=', 'nothing to create');
    return { created: [] };
  }
  const before = await guardCounts(deps);
  const created: string[] = [];
  for (const entry of targets) {
    const result = await deps.saveOffering(entry.pageId, entry.settings);
    if (!result.ok) throw new Error(`${entry.path}: ${result.message ?? 'refused'}`);
    created.push(entry.pageId);
    deps.log('+', `${entry.path} — settings saved`);
  }
  const after = await guardCounts(deps);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(
      `booking side changed during the migration (before ${JSON.stringify(before)}, after ${JSON.stringify(after)})`,
    );
  }
  deps.log(
    '✓',
    `bookings, services and provider subscriptions unchanged (${after.bookings} booking(s))`,
  );
  return { created };
}

/**
 * Mode dispatch shared by the CLI and the self-test. The dry run plans against
 * `readOnlyDb()` and opens no session; `--apply` acts as the CLIs' admin
 * (`findActor()`) in a short-lived session, revoked afterwards.
 */
export async function runOfferingMigration(
  options: { apply: boolean },
  context: RolloutRunContext,
): Promise<{ created: string[] }> {
  const schema = await import('@/db/cms-schema');
  const planDeps: PlanDeps = {
    db: options.apply ? context.db : readOnlyDb(context.db),
    orm: await import('drizzle-orm'),
    schema,
    blocks: await import('@/lib/cms/blocks'),
    locale: schema.DEFAULT_LOCALE,
    log: context.log,
  };
  const actor = await findActor(planDeps);

  if (!options.apply) {
    context.log('=', `would act as ${actor.email} (no session is created in a dry run)`);
    const plan = await planOfferingMigration(planDeps);
    await printOfferingMigrationPlan(plan, planDeps);
    const creates = plan.entries.filter((entry) => entry.action === 'create').length;
    context.log(
      creates ? '→' : '=',
      creates
        ? `dry run: run again with --apply to save ${creates} offering(s)`
        : 'dry run: nothing to create',
    );
    return { created: [] };
  }

  context.log('=', `acting as ${actor.email}`);
  return withAdminSession(context, actor.id, 'cms-migrate-offerings', async () => {
    const { saveOffering } = await import('@/lib/offers/repo');
    return applyOfferingMigration({ ...planDeps, saveOffering });
  });
}
