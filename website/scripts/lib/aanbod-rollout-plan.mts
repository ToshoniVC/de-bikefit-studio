/**
 * Planning half of the aanbod rollout (read-only): what would change, why,
 * what blocks an apply and the booking-table guard counts. The writing half (backup, apply, restore) and the full scope
 * description are in `aanbod-rollout.mts`.
 */
import { createHash } from 'node:crypto';
import {
  AANBOD_PAGES,
  AANBOD_REDIRECTS,
  FOOTER_MENU,
  MAIN_MENU,
  RETIRED_PAGE_SLUG,
} from '@/lib/studio/seed-content/aanbod';
import type { SeedPage } from '@/lib/studio/seed-content/shared';

type DrizzleOrm = typeof import('drizzle-orm');
type CmsSchema = typeof import('@/db/cms-schema');
type BlocksModule = typeof import('@/lib/cms/blocks');
export type CmsRepo = typeof import('@/lib/cms/repo');
type CmsAuth = typeof import('@/lib/cms/auth');
type CmsDatabase = import('@/db/cms').CmsDatabase;

/** What planning needs: reads only — no repo, no session, no actor. */
export type PlanDeps = {
  db: CmsDatabase;
  orm: DrizzleOrm;
  schema: CmsSchema;
  blocks: BlocksModule;
  locale: string;
  log: (symbol: string, message: string) => void;
};

/** What apply/restore need on top: the write API and the acting admin. */
export type RolloutDeps = PlanDeps & {
  repo: CmsRepo;
  auth: Pick<CmsAuth, 'recordAudit'>;
  actor: { id: string; email: string };
};

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export type PagePlan = {
  slug: string;
  path: string;
  action: 'create' | 'update' | 'unchanged';
  pageId: string | null;
  status: 'draft' | 'published' | null;
  /** Why an existing page is updated (live/draft blocks, title/SEO, not published). */
  reasons: string[];
  /** Saved draft blocks differ from what is live: unpublished editor work. */
  unpublishedDraft: boolean;
  /** Another page already uses the translation group a new page needs. */
  translationGroupClash: string | null;
};

export type MenuPlan = { key: 'main' | 'footer'; action: 'replace' | 'unchanged' };

export type RetirePlan = {
  slug: string;
  pageId: string | null;
  action: 'unpublish' | 'absent' | 'already-unpublished';
};

export type RedirectPlan = {
  fromPath: string;
  toPath: string;
  redirectId: string | null;
  action: 'create' | 'enable' | 'unchanged' | 'conflict';
  detail: string;
};

export type GuardCounts = {
  bookings: number;
  services: number;
  /** sha256 of every service's id, slug, duration, active flag (sorted). */
  servicesHash: string;
  providerServices: number;
  providers: number;
};

export type RolloutPlan = {
  locale: string;
  pages: PagePlan[];
  menus: MenuPlan[];
  retire: RetirePlan;
  redirects: RedirectPlan[];
  guards: GuardCounts;
};

export const stable = (value: unknown) => JSON.stringify(value);

export function pagePath(slug: string): string {
  return slug ? `/${slug}` : '/';
}

/** `(type, data)` pairs after registry validation, for an order-stable comparison. */
function normalizedBlocks(
  deps: PlanDeps,
  input: ReadonlyArray<{ id?: string; type: string; data: unknown }>,
): string | null {
  const result = deps.blocks.validateBlocks(input);
  return result.ok ? stable(result.blocks.map((block) => [block.type, block.data])) : null;
}

export function seoOf(spec: SeedPage) {
  return {
    title: spec.title,
    metaTitle: spec.metaTitle,
    metaDescription: spec.metaDescription,
    structuredDataType: spec.structuredDataType,
    noIndex: false,
  };
}

export async function guardCounts(deps: PlanDeps): Promise<GuardCounts> {
  const { db, schema } = deps;
  const [bookings, services, providerServices, providers] = await Promise.all([
    db.select({ id: schema.cmsBookings.id }).from(schema.cmsBookings),
    db
      .select({
        id: schema.cmsServices.id,
        slug: schema.cmsServices.slug,
        duration: schema.cmsServices.durationMinutes,
        active: schema.cmsServices.isActive,
      })
      .from(schema.cmsServices),
    db.select({ id: schema.cmsProviderServices.serviceId }).from(schema.cmsProviderServices),
    db.select({ id: schema.cmsProviders.id }).from(schema.cmsProviders),
  ]);
  const fingerprint = services
    .map((row) => `${row.id}:${row.slug}:${row.duration}:${row.active}`)
    .sort()
    .join('\n');
  return {
    bookings: bookings.length,
    services: services.length,
    servicesHash: createHash('sha256').update(fingerprint).digest('hex'),
    providerServices: providerServices.length,
    providers: providers.length,
  };
}

async function planPages(deps: PlanDeps): Promise<PagePlan[]> {
  const { db, orm, schema, locale } = deps;
  const { and, asc, eq } = orm;
  const allPages = await db
    .select({
      id: schema.cmsPages.id,
      slug: schema.cmsPages.slug,
      translationGroup: schema.cmsPages.translationGroup,
    })
    .from(schema.cmsPages)
    .where(eq(schema.cmsPages.locale, locale));

  const plans: PagePlan[] = [];
  for (const spec of AANBOD_PAGES) {
    const [row] = await db
      .select()
      .from(schema.cmsPages)
      .where(and(eq(schema.cmsPages.locale, locale), eq(schema.cmsPages.slug, spec.slug)))
      .limit(1);

    if (!row) {
      const clash = allPages.find((page) => page.translationGroup === spec.translationGroup);
      plans.push({
        slug: spec.slug,
        path: pagePath(spec.slug),
        action: 'create',
        pageId: null,
        status: null,
        reasons: ['new'],
        unpublishedDraft: false,
        translationGroupClash: clash ? pagePath(clash.slug) : null,
      });
      continue;
    }

    const target = normalizedBlocks(deps, spec.blocks);
    if (target === null) throw new Error(`seed blocks for ${pagePath(spec.slug)} do not validate`);
    const snapshot = deps.blocks.parsePublishedSnapshot(row.publishedSnapshot);
    const live = snapshot ? stable(snapshot.blocks.map((block) => [block.type, block.data])) : null;
    const drafts = await db
      .select()
      .from(schema.cmsBlocks)
      .where(eq(schema.cmsBlocks.pageId, row.id))
      .orderBy(asc(schema.cmsBlocks.sortOrder));
    const draft = normalizedBlocks(
      deps,
      drafts.map((block) => ({ id: block.id, type: block.type, data: block.data })),
    );

    const reasons: string[] = [];
    if (row.status !== 'published') reasons.push('not published');
    if (live !== target) reasons.push('live blocks');
    if (draft !== target) reasons.push('draft blocks');
    const seo = seoOf(spec);
    const current = {
      title: row.title,
      metaTitle: row.metaTitle,
      metaDescription: row.metaDescription,
      structuredDataType: row.structuredDataType,
      noIndex: row.noIndex,
    };
    if (stable(current) !== stable(seo)) reasons.push('title/SEO');

    plans.push({
      slug: spec.slug,
      path: pagePath(spec.slug),
      action: reasons.length > 0 ? 'update' : 'unchanged',
      pageId: row.id,
      status: row.status,
      reasons,
      // Unpublished work = saved drafts that differ from what is live AND from the target.
      unpublishedDraft: row.status === 'published' && draft !== live && draft !== target,
      translationGroupClash: null,
    });
  }
  return plans;
}

async function planMenus(deps: PlanDeps): Promise<MenuPlan[]> {
  const { db, orm, schema, locale, blocks } = deps;
  const { and, eq } = orm;
  const targets = [
    ['main', MAIN_MENU],
    ['footer', FOOTER_MENU],
  ] as const;
  const plans: MenuPlan[] = [];
  for (const [key, items] of targets) {
    const [row] = await db
      .select({ items: schema.cmsNavigation.items })
      .from(schema.cmsNavigation)
      .where(and(eq(schema.cmsNavigation.locale, locale), eq(schema.cmsNavigation.menuKey, key)))
      .limit(1);
    const current = row ? blocks.validateNavigationItems(row.items) : null;
    const target = blocks.validateNavigationItems(items);
    const same = current?.ok && target.ok && stable(current.items) === stable(target.items);
    plans.push({ key, action: same ? 'unchanged' : 'replace' });
  }
  return plans;
}

async function planRetire(deps: PlanDeps): Promise<RetirePlan> {
  const { db, orm, schema, locale } = deps;
  const { and, eq } = orm;
  const [row] = await db
    .select({ id: schema.cmsPages.id, status: schema.cmsPages.status })
    .from(schema.cmsPages)
    .where(and(eq(schema.cmsPages.locale, locale), eq(schema.cmsPages.slug, RETIRED_PAGE_SLUG)))
    .limit(1);
  if (!row) return { slug: RETIRED_PAGE_SLUG, pageId: null, action: 'absent' };
  return {
    slug: RETIRED_PAGE_SLUG,
    pageId: row.id,
    action: row.status === 'published' ? 'unpublish' : 'already-unpublished',
  };
}

async function planRedirects(deps: PlanDeps): Promise<RedirectPlan[]> {
  const { db, orm, schema } = deps;
  const plans: RedirectPlan[] = [];
  for (const redirect of AANBOD_REDIRECTS) {
    const [row] = await db
      .select()
      .from(schema.cmsRedirects)
      .where(orm.eq(schema.cmsRedirects.fromPath, redirect.fromPath))
      .limit(1);
    const base = { fromPath: redirect.fromPath, toPath: redirect.toPath };
    if (!row) {
      plans.push({ ...base, redirectId: null, action: 'create', detail: 'new' });
    } else if (row.toPath !== redirect.toPath) {
      plans.push({
        ...base,
        redirectId: row.id,
        action: 'conflict',
        detail: `already exists, pointing at ${row.toPath} — left untouched`,
      });
    } else if (!row.isEnabled || row.statusCode !== redirect.statusCode) {
      plans.push({
        ...base,
        redirectId: row.id,
        action: 'enable',
        detail: 'exists; will be enabled as 301',
      });
    } else {
      plans.push({ ...base, redirectId: row.id, action: 'unchanged', detail: 'already in place' });
    }
  }
  return plans;
}

export async function planAanbodRollout(deps: PlanDeps): Promise<RolloutPlan> {
  return {
    locale: deps.locale,
    pages: await planPages(deps),
    menus: await planMenus(deps),
    retire: await planRetire(deps),
    redirects: await planRedirects(deps),
    guards: await guardCounts(deps),
  };
}

export function planHasChanges(plan: RolloutPlan): boolean {
  return (
    plan.pages.some((page) => page.action !== 'unchanged') ||
    plan.menus.some((menu) => menu.action !== 'unchanged') ||
    plan.retire.action === 'unpublish' ||
    plan.redirects.some((redirect) => redirect.action === 'create' || redirect.action === 'enable')
  );
}

/** Reasons the apply must refuse; empty = safe to apply. */
export function planBlockers(
  plan: RolloutPlan,
  options: { allowDraftOverwrite: boolean },
): string[] {
  const blockers: string[] = [];
  for (const redirect of plan.redirects) {
    if (redirect.action === 'conflict') {
      blockers.push(`redirect ${redirect.fromPath}: ${redirect.detail}`);
    }
  }
  for (const page of plan.pages) {
    if (page.translationGroupClash) {
      blockers.push(
        `page ${page.path}: translation group already used by ${page.translationGroupClash}`,
      );
    }
    if (page.unpublishedDraft && page.action === 'update' && !options.allowDraftOverwrite) {
      blockers.push(
        `page ${page.path}: has unpublished draft edits (pass --allow-draft-overwrite to replace them; the backup keeps them)`,
      );
    }
  }
  return blockers;
}

export function printPlan(plan: RolloutPlan, log: PlanDeps['log']): void {
  log('→', `locale ${plan.locale}`);
  for (const page of plan.pages) {
    const symbol = page.action === 'create' ? '+' : page.action === 'update' ? '~' : '=';
    const extra = [
      page.reasons.length > 0 && page.action !== 'create' ? page.reasons.join(', ') : '',
      page.unpublishedDraft ? 'WARNING: unpublished draft edits' : '',
      page.translationGroupClash
        ? `CONFLICT translation group (${page.translationGroupClash})`
        : '',
    ]
      .filter(Boolean)
      .join(' · ');
    log(symbol, `page ${page.path} — ${page.action}${extra ? ` (${extra})` : ''}`);
  }
  for (const menu of plan.menus) {
    log(menu.action === 'replace' ? '~' : '=', `menu ${menu.key} — ${menu.action}`);
  }
  const retire = plan.retire;
  log(
    retire.action === 'unpublish' ? '~' : '=',
    `page /${retire.slug} — ${retire.action === 'unpublish' ? 'unpublish (row and snapshot are kept)' : retire.action}`,
  );
  for (const redirect of plan.redirects) {
    const symbol =
      redirect.action === 'conflict' ? '!' : redirect.action === 'unchanged' ? '=' : '+';
    log(symbol, `redirect ${redirect.fromPath} → ${redirect.toPath} — ${redirect.detail}`);
  }
  const g = plan.guards;
  log(
    '→',
    `bookings ${g.bookings}, services ${g.services}, providers ${g.providers}, provider-services ${g.providerServices} — not touched`,
  );
}
