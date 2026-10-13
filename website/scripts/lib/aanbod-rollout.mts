/**
 * Core of `npm run cms:rollout-aanbod` (and self-test section 15): brings an
 * EXISTING database to the 13 Oct 2026 redesign — and nothing else.
 *
 * Scope (from `src/lib/studio/seed-content/aanbod.ts`):
 *   pages     /, /aanbod, /aanbod/<7 offers>, /voor-wie, /bikefit, /ons-team
 *   menus     main, footer
 *   retired   /over-ons → unpublished (row and snapshot kept) + 301 → /ons-team
 *
 * Never touched: any other page, site settings (contact, privacy/terms texts,
 * SEO switches), media, users, credentials, and every booking table
 * (`cms_services`, `cms_providers`, `cms_provider_services`, `cms_bookings`,
 * hours, exceptions). `guardCounts()` is taken before and after an apply and
 * the apply fails loudly if any of those changed.
 *
 * Three steps:
 *   plan     read-only: what would change, why, and the offer ↔ booking
 *            catalogue report (which offer is online bookable)
 *   apply    writes a JSON backup of every row it will overwrite FIRST, then
 *            writes through the real repo (permission checks, sanitising,
 *            validation, audit), publishing each page last
 *   restore  puts the backed-up rows back; pages and redirects the rollout
 *            created are unpublished / disabled, never deleted
 *
 * The caller installs the request-context stubs and an admin session, then
 * passes the dynamically imported modules in as {@link RolloutDeps}.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
  AANBOD_PAGES,
  AANBOD_REDIRECTS,
  FOOTER_MENU,
  MAIN_MENU,
} from '@/lib/studio/seed-content/aanbod';
import {
  guardCounts,
  pagePath,
  planAanbodRollout,
  planBlockers,
  planHasChanges,
  seoOf,
  stable,
  type CmsRepo,
  type RolloutDeps,
  type RolloutPlan,
} from './aanbod-rollout-plan.mjs';

export * from './aanbod-rollout-plan.mjs';

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

const backupRowSchema = z.record(z.string(), z.unknown());

export const rolloutBackupSchema = z.object({
  kind: z.literal('aanbod-rollout-backup'),
  version: z.literal(1),
  createdAt: z.string(),
  locale: z.string(),
  driver: z.string(),
  pages: z.array(z.object({ row: backupRowSchema, blocks: z.array(backupRowSchema) })),
  menus: z.array(z.object({ key: z.string(), items: z.array(z.unknown()).nullable() })),
  redirects: z.array(backupRowSchema),
  created: z.object({ pageSlugs: z.array(z.string()), redirectPaths: z.array(z.string()) }),
  guards: z.record(z.string(), z.unknown()),
});
export type RolloutBackup = z.infer<typeof rolloutBackupSchema>;

async function buildBackup(deps: RolloutDeps, plan: RolloutPlan, driver: string) {
  const { db, orm, schema, locale } = deps;
  const { and, asc, eq } = orm;

  const pageIds = [
    ...plan.pages.filter((page) => page.action === 'update').map((page) => page.pageId!),
    ...(plan.retire.action === 'unpublish' ? [plan.retire.pageId!] : []),
  ];
  const pages: RolloutBackup['pages'] = [];
  for (const pageId of pageIds) {
    const [row] = await db.select().from(schema.cmsPages).where(eq(schema.cmsPages.id, pageId));
    const blocks = await db
      .select()
      .from(schema.cmsBlocks)
      .where(eq(schema.cmsBlocks.pageId, pageId))
      .orderBy(asc(schema.cmsBlocks.sortOrder));
    pages.push({ row: toJson(row), blocks: blocks.map(toJson) });
  }

  const menus: RolloutBackup['menus'] = [];
  for (const menu of plan.menus.filter((entry) => entry.action === 'replace')) {
    const [row] = await db
      .select({ items: schema.cmsNavigation.items })
      .from(schema.cmsNavigation)
      .where(
        and(eq(schema.cmsNavigation.locale, locale), eq(schema.cmsNavigation.menuKey, menu.key)),
      )
      .limit(1);
    menus.push({ key: menu.key, items: row ? (row.items as unknown[]) : null });
  }

  const redirects: RolloutBackup['redirects'] = [];
  for (const redirect of plan.redirects.filter((entry) => entry.action === 'enable')) {
    const [row] = await db
      .select()
      .from(schema.cmsRedirects)
      .where(eq(schema.cmsRedirects.id, redirect.redirectId!));
    if (row) redirects.push(toJson(row));
  }

  return rolloutBackupSchema.parse({
    kind: 'aanbod-rollout-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    locale,
    driver,
    pages,
    menus,
    redirects,
    created: {
      pageSlugs: plan.pages.filter((page) => page.action === 'create').map((page) => page.slug),
      redirectPaths: plan.redirects
        .filter((redirect) => redirect.action === 'create')
        .map((redirect) => redirect.fromPath),
    },
    guards: plan.guards,
  });
}

function toJson(row: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

export async function writeBackup(backup: RolloutBackup, dir: string): Promise<string> {
  const target = resolve(dir);
  await mkdir(target, { recursive: true });
  const file = join(target, `aanbod-rollout-${backup.createdAt.replace(/[:.]/g, '-')}.json`);
  // `wx`: never overwrite an earlier backup.
  await writeFile(file, `${JSON.stringify(backup, null, 2)}\n`, { flag: 'wx' });
  return file;
}

export async function readBackup(file: string): Promise<RolloutBackup> {
  return rolloutBackupSchema.parse(JSON.parse(await readFile(file, 'utf8')));
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export type ApplyResult = { changed: boolean; backupPath: string | null; plan: RolloutPlan };

export async function applyAanbodRollout(
  deps: RolloutDeps,
  options: { backupDir: string; driver: string; allowDraftOverwrite: boolean },
): Promise<ApplyResult> {
  const { repo, log } = deps;
  const plan = await planAanbodRollout(deps);
  const blockers = planBlockers(plan, options);
  if (blockers.length > 0) {
    throw new Error(`rollout refused:\n  - ${blockers.join('\n  - ')}`);
  }
  if (!planHasChanges(plan)) {
    log('=', 'nothing to do: everything is already as the rollout wants it');
    return { changed: false, backupPath: null, plan };
  }

  // 1. Backup FIRST. No backup, no write.
  const backup = await buildBackup(deps, plan, options.driver);
  const backupPath = await writeBackup(backup, options.backupDir);
  const backupFile = backupPath.split(/[\\/]/).pop() ?? backupPath;
  log('✓', `backup written: ${backupPath}`);

  // 2. Pages. Each page is published last, so a failure halfway leaves the
  //    live snapshot of that page as it was (neon-http has no transactions).
  for (const pagePlan of plan.pages) {
    if (pagePlan.action === 'unchanged') continue;
    const spec = AANBOD_PAGES.find((page) => page.slug === pagePlan.slug)!;
    let pageId = pagePlan.pageId;
    if (!pageId) {
      const created = await repo.createPage({
        locale: deps.locale,
        slug: spec.slug,
        title: spec.title,
        translationGroup: spec.translationGroup,
      });
      if (!created.ok) throw new Error(`page ${pagePlan.path}: ${created.message}`);
      pageId = created.data.id;
    }
    const updated = await repo.updatePage(pageId, seoOf(spec));
    if (!updated.ok) throw new Error(`page ${pagePlan.path}: ${updated.message}`);

    const current = await repo.getPageForEdit(pageId);
    if (pagePlan.action === 'update' && current) {
      // One audit entry per overwritten page, next to the per-block
      // `block.delete` entries the repo writes: what was replaced, and where
      // the full previous content is kept.
      const live = deps.blocks.parsePublishedSnapshot(current.page.publishedSnapshot);
      await deps.auth.recordAudit(deps.db, deps.actor, {
        action: 'rollout.aanbod.overwrite',
        entityType: 'cms_page',
        entityId: pageId,
        summary: `${deps.locale}/${spec.slug}`,
        metadata: {
          backup: backupFile,
          reasons: pagePlan.reasons,
          draftBlocks: current.blocks.map((block) => `${block.id}:${block.type}`),
          liveBlocks: live?.blocks.map((block) => block.type) ?? [],
        },
      });
    }
    for (const block of current?.blocks ?? []) {
      const removed = await repo.deleteBlock(block.id);
      if (!removed.ok) throw new Error(`page ${pagePlan.path}: ${removed.message}`);
    }
    for (const blockSpec of spec.blocks) {
      const added = await repo.addBlock(
        pageId,
        blockSpec.type as Parameters<CmsRepo['addBlock']>[1],
      );
      if (!added.ok) throw new Error(`page ${pagePlan.path} (${blockSpec.type}): ${added.message}`);
      const written = await repo.updateBlock(added.data.id, blockSpec.data);
      if (!written.ok) {
        throw new Error(`page ${pagePlan.path} (${blockSpec.type}): ${written.message}`);
      }
    }
    const published = await repo.publishPage(pageId);
    if (!published.ok) throw new Error(`page ${pagePlan.path}: ${published.message}`);
    log(pagePlan.action === 'create' ? '+' : '~', `page ${pagePlan.path} — published`);
  }

  // 3. Menus.
  for (const menu of plan.menus) {
    if (menu.action === 'unchanged') continue;
    const items = menu.key === 'main' ? MAIN_MENU : FOOTER_MENU;
    const result = await repo.updateNavigation(deps.locale, menu.key, items);
    if (!result.ok) throw new Error(`menu ${menu.key}: ${result.message}`);
    log('~', `menu ${menu.key} — ${items.length} items`);
  }

  // 4. Redirect before unpublishing, so /over-ons never answers 404.
  for (const redirectPlan of plan.redirects) {
    const spec = AANBOD_REDIRECTS.find((entry) => entry.fromPath === redirectPlan.fromPath)!;
    if (redirectPlan.action === 'create') {
      const result = await repo.createRedirect(spec);
      if (!result.ok) throw new Error(`redirect ${spec.fromPath}: ${result.message}`);
      log('+', `redirect ${spec.fromPath} → ${spec.toPath} (301)`);
    } else if (redirectPlan.action === 'enable') {
      const result = await repo.updateRedirect(redirectPlan.redirectId!, {
        isEnabled: true,
        statusCode: spec.statusCode,
      });
      if (!result.ok) throw new Error(`redirect ${spec.fromPath}: ${result.message}`);
      log('~', `redirect ${spec.fromPath} → ${spec.toPath} — enabled (301)`);
    }
  }
  if (plan.retire.action === 'unpublish') {
    const result = await repo.unpublishPage(plan.retire.pageId!);
    if (!result.ok) throw new Error(`page /${plan.retire.slug}: ${result.message}`);
    log('~', `page /${plan.retire.slug} — unpublished (row and snapshot kept)`);
  }

  // 5. Prove the booking tables were not touched.
  const after = await guardCounts(deps);
  if (stable(after) !== stable(plan.guards)) {
    throw new Error(
      `booking tables changed during the rollout! before ${stable(plan.guards)} after ${stable(after)}`,
    );
  }
  log('✓', 'bookings, services and providers unchanged');
  await deps.auth.recordAudit(deps.db, deps.actor, {
    action: 'rollout.aanbod.apply',
    entityType: 'cms_rollout',
    summary: 'aanbod-rollout 2026-10-13',
    metadata: {
      backup: backupFile,
      created: backup.created,
      overwritten: plan.pages.filter((page) => page.action === 'update').map((page) => page.path),
      menus: plan.menus.filter((menu) => menu.action === 'replace').map((menu) => menu.key),
      unpublished: plan.retire.action === 'unpublish' ? [`/${plan.retire.slug}`] : [],
    },
  });
  return { changed: true, backupPath, plan };
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

const PAGE_RESTORE_COLUMNS = [
  'slug',
  'translationGroup',
  'title',
  'kind',
  'status',
  'publishedAt',
  'publishedSnapshot',
  'metaTitle',
  'metaDescription',
  'canonicalOverride',
  'ogTitle',
  'ogDescription',
  'ogImageMediaId',
  'noIndex',
  'structuredDataType',
  'structuredDataOverrides',
] as const;

function asDate(value: unknown): Date | null {
  return typeof value === 'string' ? new Date(value) : null;
}

export async function restoreAanbodRollout(
  deps: RolloutDeps,
  backup: RolloutBackup,
): Promise<void> {
  const { db, orm, schema, repo, log, locale } = deps;
  const { and, eq } = orm;
  if (backup.locale !== locale) throw new Error(`backup is for locale ${backup.locale}`);

  // Pages the rollout created: unpublish (kept, never deleted).
  for (const slug of backup.created.pageSlugs) {
    const [row] = await db
      .select({ id: schema.cmsPages.id, status: schema.cmsPages.status })
      .from(schema.cmsPages)
      .where(and(eq(schema.cmsPages.locale, locale), eq(schema.cmsPages.slug, slug)))
      .limit(1);
    if (row?.status === 'published') {
      const result = await repo.unpublishPage(row.id);
      if (!result.ok) throw new Error(`page ${pagePath(slug)}: ${result.message}`);
      log('~', `page ${pagePath(slug)} — unpublished (created by the rollout)`);
    }
  }

  // Pages the rollout overwrote: row fields + draft blocks back as they were.
  for (const entry of backup.pages) {
    const id = String(entry.row.id);
    const values: Record<string, unknown> = {};
    for (const column of PAGE_RESTORE_COLUMNS) values[column] = entry.row[column] ?? null;
    values.publishedAt = asDate(entry.row.publishedAt);
    values.updatedBy = deps.actor.id;
    values.updatedAt = new Date();
    const [existing] = await db
      .select({ id: schema.cmsPages.id })
      .from(schema.cmsPages)
      .where(eq(schema.cmsPages.id, id));
    if (!existing) throw new Error(`page ${id} no longer exists; restore it by hand`);
    await db.update(schema.cmsPages).set(values).where(eq(schema.cmsPages.id, id));
    await db.delete(schema.cmsBlocks).where(eq(schema.cmsBlocks.pageId, id));
    if (entry.blocks.length > 0) {
      await db.insert(schema.cmsBlocks).values(
        entry.blocks.map((block) => ({
          id: String(block.id),
          pageId: id,
          sortOrder: Number(block.sortOrder ?? 0),
          type: String(block.type),
          data: (block.data ?? {}) as Record<string, unknown>,
          createdAt: asDate(block.createdAt) ?? new Date(),
          updatedAt: asDate(block.updatedAt) ?? new Date(),
        })),
      );
    }
    await deps.auth.recordAudit(db, deps.actor, {
      action: 'rollout.aanbod.restore',
      entityType: 'cms_page',
      entityId: id,
      summary: `${locale}/${String(entry.row.slug)}`,
    });
    log('~', `page ${pagePath(String(entry.row.slug))} — restored from backup`);
  }

  for (const menu of backup.menus) {
    const result = await repo.updateNavigation(locale, menu.key, menu.items ?? []);
    if (!result.ok) throw new Error(`menu ${menu.key}: ${result.message}`);
    log('~', `menu ${menu.key} — restored`);
  }

  for (const fromPath of backup.created.redirectPaths) {
    const [row] = await db
      .select({ id: schema.cmsRedirects.id })
      .from(schema.cmsRedirects)
      .where(eq(schema.cmsRedirects.fromPath, fromPath))
      .limit(1);
    if (row) {
      const result = await repo.updateRedirect(row.id, { isEnabled: false });
      if (!result.ok) throw new Error(`redirect ${fromPath}: ${result.message}`);
      log('~', `redirect ${fromPath} — disabled (created by the rollout)`);
    }
  }
  for (const row of backup.redirects) {
    const result = await repo.updateRedirect(String(row.id), {
      isEnabled: Boolean(row.isEnabled),
      statusCode: Number(row.statusCode) === 302 ? 302 : 301,
    });
    if (!result.ok) throw new Error(`redirect ${String(row.fromPath)}: ${result.message}`);
    log('~', `redirect ${String(row.fromPath)} — restored`);
  }

  // Direct page writes bypass the repo's cache bust; on a deployment the
  // 300-second fallback revalidation (content.ts) picks them up.
  repo.revalidateContent({ tags: ['cms', 'cms:pages', 'cms:navigation', 'cms:redirects'] });
}
