/**
 * Read-only half of `npm run cms:patch-page-cleanup`: what the review would
 * change on an existing database, what blocks it, and the dry-run printout.
 * Never writes; the dry run runs it against `readOnlyDb()`. The writing half
 * (backup, apply, verify, restore, mode dispatch) is `page-cleanup-patch.mts`.
 */
import { CONTACT_EMAIL } from '@/lib/studio/seed-content/shared';
import {
  cleanupBlocks,
  CONTACT_REDIRECT,
  contactEmailAction,
  PAGE_CLEANUP_SPECS,
  RETIRED_CONTACT_SLUG,
  retargetContactLinks,
  type CleanupNavItem,
  type CleanupResult,
} from '@/lib/studio/seed-content/page-cleanup';
import {
  guardCounts,
  pagePath,
  stable,
  type GuardCounts,
  type PlanDeps,
} from './aanbod-rollout.mjs';

type DraftBlock = { id: string; type: string; data: Record<string, unknown>; sortOrder: number };

export type CleanupPagePlan = {
  slug: string;
  path: string;
  pageId: string | null;
  status: 'draft' | 'published' | null;
  unpublishedDraft: boolean;
  /** Computed on the draft blocks (the apply writes those). */
  result: CleanupResult<DraftBlock> | null;
  /** Changes the live snapshot still needs (differs from `result` only with a draft). */
  liveChanges: number;
  meta: { to: string; conflict: string } | null;
};

export type PageCleanupPlan = {
  locale: string;
  pages: CleanupPagePlan[];
  contact: {
    pageId: string | null;
    published: boolean;
    redirectId: string | null;
    redirect: 'create' | 'enable' | 'unchanged' | 'conflict';
    detail: string;
  };
  menus: { key: 'main' | 'footer'; items: CleanupNavItem[]; changed: string[] }[];
  settings: { contact: Record<string, unknown> | null; action: '' | 'set' | string };
  guards: GuardCounts;
};

function normalized(deps: PlanDeps, input: { type: string; data: unknown }[]): string | null {
  const result = deps.blocks.validateBlocks(input);
  return result.ok ? stable(result.blocks.map((block) => [block.type, block.data])) : null;
}

export async function pageRow(deps: PlanDeps, slug: string) {
  const { and, eq } = deps.orm;
  const [row] = await deps.db
    .select()
    .from(deps.schema.cmsPages)
    .where(and(eq(deps.schema.cmsPages.locale, deps.locale), eq(deps.schema.cmsPages.slug, slug)))
    .limit(1);
  return row ?? null;
}

async function draftBlocks(deps: PlanDeps, pageId: string): Promise<DraftBlock[]> {
  const { asc, eq } = deps.orm;
  const rows = await deps.db
    .select()
    .from(deps.schema.cmsBlocks)
    .where(eq(deps.schema.cmsBlocks.pageId, pageId))
    .orderBy(asc(deps.schema.cmsBlocks.sortOrder));
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    data: (row.data ?? {}) as Record<string, unknown>,
    sortOrder: row.sortOrder,
  }));
}

export async function planPageCleanup(deps: PlanDeps): Promise<PageCleanupPlan> {
  const { db, orm, schema, locale } = deps;
  const { and, eq } = orm;

  const pages: CleanupPagePlan[] = [];
  for (const spec of PAGE_CLEANUP_SPECS) {
    const row = await pageRow(deps, spec.slug);
    const plan: CleanupPagePlan = {
      slug: spec.slug,
      path: pagePath(spec.slug),
      pageId: row?.id ?? null,
      status: row?.status ?? null,
      unpublishedDraft: false,
      result: null,
      liveChanges: 0,
      meta: null,
    };
    if (row) {
      const drafts = await draftBlocks(deps, row.id);
      const live = deps.blocks.parsePublishedSnapshot(row.publishedSnapshot)?.blocks ?? [];
      const draft = normalized(deps, drafts);
      plan.unpublishedDraft =
        row.status === 'published' && (draft === null || draft !== normalized(deps, live));
      plan.result = cleanupBlocks(spec, drafts);
      plan.liveChanges = cleanupBlocks(
        spec,
        live.map((block) => ({ type: block.type, data: block.data as Record<string, unknown> })),
      ).changes.length;
      if (spec.metaDescription && row.metaDescription !== spec.metaDescription.to) {
        plan.meta = {
          to: spec.metaDescription.to,
          conflict:
            row.metaDescription === spec.metaDescription.from
              ? ''
              : `meta description is ${JSON.stringify(row.metaDescription)}, not the rollout text`,
        };
      }
    }
    pages.push(plan);
  }

  const contactRow = await pageRow(deps, RETIRED_CONTACT_SLUG);
  const [redirect] = await db
    .select()
    .from(schema.cmsRedirects)
    .where(eq(schema.cmsRedirects.fromPath, CONTACT_REDIRECT.fromPath))
    .limit(1);
  let redirectAction: PageCleanupPlan['contact']['redirect'] = 'create';
  let detail = `${CONTACT_REDIRECT.fromPath} → ${CONTACT_REDIRECT.toPath} (301)`;
  if (redirect) {
    if (redirect.toPath !== CONTACT_REDIRECT.toPath) {
      redirectAction = 'conflict';
      detail = `${redirect.fromPath} already redirects to ${redirect.toPath}`;
    } else {
      redirectAction = redirect.isEnabled ? 'unchanged' : 'enable';
    }
  }

  const menus: PageCleanupPlan['menus'] = [];
  for (const key of ['main', 'footer'] as const) {
    const [nav] = await db
      .select({ items: schema.cmsNavigation.items })
      .from(schema.cmsNavigation)
      .where(and(eq(schema.cmsNavigation.locale, locale), eq(schema.cmsNavigation.menuKey, key)))
      .limit(1);
    const items = Array.isArray(nav?.items) ? (nav.items as CleanupNavItem[]) : [];
    menus.push({ key, ...retargetContactLinks(items) });
  }

  const [settingsRow] = await db
    .select({ value: schema.cmsSiteSettings.value })
    .from(schema.cmsSiteSettings)
    .where(
      and(eq(schema.cmsSiteSettings.locale, locale), eq(schema.cmsSiteSettings.key, 'contact')),
    )
    .limit(1);
  const contact = (settingsRow?.value ?? null) as Record<string, unknown> | null;
  const email = typeof contact?.email === 'string' ? contact.email : '';

  return {
    locale,
    pages,
    contact: {
      pageId: contactRow?.id ?? null,
      published: contactRow?.status === 'published',
      redirectId: redirect?.id ?? null,
      redirect: redirectAction,
      detail,
    },
    menus,
    settings: { contact, action: contactEmailAction(email) },
    guards: await guardCounts(deps),
  };
}

export function pageHasWork(page: CleanupPagePlan): boolean {
  return Boolean(
    (page.result && (page.result.updated.length > 0 || page.result.removed.length > 0)) ||
    (page.meta && !page.meta.conflict),
  );
}

export function pageCleanupHasChanges(plan: PageCleanupPlan): boolean {
  return (
    plan.pages.some(pageHasWork) ||
    plan.contact.published ||
    ['create', 'enable'].includes(plan.contact.redirect) ||
    plan.menus.some((menu) => menu.changed.length > 0) ||
    plan.settings.action === 'set'
  );
}

export function pageCleanupBlockers(plan: PageCleanupPlan): string[] {
  const blockers: string[] = [];
  for (const page of plan.pages) {
    if (page.status !== 'published') {
      blockers.push(`page ${page.path}: ${page.status ? 'not published' : 'missing'}`);
      continue;
    }
    for (const conflict of page.result?.conflicts ?? []) {
      blockers.push(`page ${page.path}: ${conflict}`);
    }
    if (page.meta?.conflict) blockers.push(`page ${page.path}: ${page.meta.conflict}`);
    if (page.unpublishedDraft && (pageHasWork(page) || page.liveChanges > 0)) {
      blockers.push(
        `page ${page.path}: has unpublished draft edits; publish or discard them in /admin first (this tool never publishes an editor's draft)`,
      );
    }
  }
  if (plan.contact.redirect === 'conflict') blockers.push(`redirect: ${plan.contact.detail}`);
  if (!['', 'set'].includes(plan.settings.action)) blockers.push(plan.settings.action);
  return blockers;
}

export function pageChanges(page: CleanupPagePlan): string[] {
  return [
    ...(page.result?.changes ?? []),
    ...(page.meta && !page.meta.conflict ? ['meta description: "junioren" → "de jeugd"'] : []),
  ];
}

export function printPageCleanupPlan(plan: PageCleanupPlan, log: PlanDeps['log']): void {
  log('=', `locale ${plan.locale}`);
  for (const page of plan.pages) {
    const changes = pageChanges(page);
    log(
      changes.length > 0 ? '~' : '=',
      `page ${page.path} — ${changes.length > 0 ? `${changes.length} change(s), then publish` : 'nothing to change'}`,
    );
    for (const change of changes) log(' ', `  ${change}`);
  }
  log(
    plan.contact.published ? '~' : '=',
    `page /${RETIRED_CONTACT_SLUG} — ${plan.contact.published ? 'unpublish (row, draft and snapshot kept)' : plan.contact.pageId ? 'already unpublished' : 'absent'}`,
  );
  log(
    ['create', 'enable'].includes(plan.contact.redirect) ? '+' : '=',
    `redirect ${plan.contact.detail} — ${plan.contact.redirect}`,
  );
  for (const menu of plan.menus) {
    log(
      menu.changed.length > 0 ? '~' : '=',
      `menu ${menu.key} — ${menu.changed.length > 0 ? menu.changed.join('; ') : 'no link to /contact'}`,
    );
  }
  log(
    plan.settings.action === 'set' ? '~' : '=',
    `settings contact.email — ${plan.settings.action === 'set' ? `"" → ${CONTACT_EMAIL}` : plan.settings.action || `already ${CONTACT_EMAIL}`}`,
  );
  log('=', `guards: ${stable(plan.guards)}`);
}
