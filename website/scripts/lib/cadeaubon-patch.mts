/**
 * Core of `npm run cms:patch-cadeaubon` (and self-test section 18): the gift
 * voucher on an EXISTING database — and nothing else. The target content is
 * pure data in `src/lib/studio/seed-content/cadeaubon.ts`.
 *
 * Scope:
 *   /aanbod/cadeaubon  created with its one `giftVoucher` block and published
 *                      (or, after a restore, its unchanged draft re-published)
 *   /aanbod            the catalogue groups: "Overige" appended after
 *                      Bikefit and Begeleiding (exact-value guard), published
 *
 * Never touched: any other page, block or field, menus, redirects, settings
 * (the voucher mails go to Instellingen → Contact → e-mail, which this patch
 * does not set), media, users and every booking table (`guardCounts()`).
 *
 *   plan     read-only; refuses (lists `!`) when /aanbod has unpublished draft
 *            edits or other catalogue groups than the seed's, or when
 *            /aanbod/cadeaubon already exists with other content
 *   apply    writes a JSON backup FIRST, then writes through the real repo
 *            (permissions, validation, audit); verifies the published result
 *   restore  the aanbod-rollout restore: the created page is unpublished
 *            (kept), /aanbod gets its backed-up blocks back
 *
 * Dry run: no session, no audit entry, planned against `readOnlyDb()`.
 */
import {
  CADEAUBON_AANBOD_SPEC,
  CADEAUBON_PAGE,
  cadeaubonAanbodBlocks,
  cadeaubonProblems,
} from '@/lib/studio/seed-content/cadeaubon';
import type { CleanupResult } from '@/lib/studio/seed-content/page-cleanup';
import {
  guardCounts,
  pagePath,
  restoreAanbodRollout,
  rolloutBackupSchema,
  seoOf,
  stable,
  writeBackup,
  type CmsRepo,
  type GuardCounts,
  type PlanDeps,
  type RolloutBackup,
  type RolloutDeps,
} from './aanbod-rollout.mjs';
import {
  findActor,
  readOnlyDb,
  withAdminSession,
  type RolloutRunContext,
} from './aanbod-rollout-run.mjs';
import { draftBlocks, normalized, pageRow, type DraftBlock } from './page-cleanup-plan.mjs';

const AANBOD_SLUG = CADEAUBON_AANBOD_SPEC.slug;
const VOUCHER_SLUG = CADEAUBON_PAGE.slug;

export type CadeaubonPlan = {
  aanbod: {
    pageId: string | null;
    unpublishedDraft: boolean;
    result: CleanupResult<DraftBlock> | null;
  };
  voucher: {
    pageId: string | null;
    action: 'create' | 'publish' | 'unchanged' | 'conflict';
    detail: string;
  };
  guards: GuardCounts;
};

export async function planCadeaubon(deps: PlanDeps): Promise<CadeaubonPlan> {
  const seed = normalized(deps, CADEAUBON_PAGE.blocks);

  const aanbodRow = await pageRow(deps, AANBOD_SLUG);
  const aanbod: CadeaubonPlan['aanbod'] = {
    pageId: aanbodRow?.id ?? null,
    unpublishedDraft: false,
    result: null,
  };
  if (aanbodRow) {
    const drafts = await draftBlocks(deps, aanbodRow.id);
    const live = deps.blocks.parsePublishedSnapshot(aanbodRow.publishedSnapshot)?.blocks ?? [];
    const draft = normalized(deps, drafts);
    aanbod.unpublishedDraft =
      aanbodRow.status !== 'published' || draft === null || draft !== normalized(deps, live);
    aanbod.result = cadeaubonAanbodBlocks(drafts);
  }

  const voucherRow = await pageRow(deps, VOUCHER_SLUG);
  const voucher: CadeaubonPlan['voucher'] = {
    pageId: voucherRow?.id ?? null,
    action: 'create',
    detail: `${pagePath(VOUCHER_SLUG)} — create and publish`,
  };
  if (voucherRow) {
    const draft = normalized(deps, await draftBlocks(deps, voucherRow.id));
    const live = deps.blocks.parsePublishedSnapshot(voucherRow.publishedSnapshot)?.blocks;
    if (draft !== seed) {
      voucher.action = 'conflict';
      voucher.detail = `${pagePath(VOUCHER_SLUG)} already exists with other content; check it by hand`;
    } else if (voucherRow.status === 'published' && live && normalized(deps, live) === seed) {
      voucher.action = 'unchanged';
      voucher.detail = `${pagePath(VOUCHER_SLUG)} — already published`;
    } else {
      voucher.action = 'publish';
      voucher.detail = `${pagePath(VOUCHER_SLUG)} — publish the existing (unchanged) draft`;
    }
  }
  return { aanbod, voucher, guards: await guardCounts(deps) };
}

function aanbodHasWork(plan: CadeaubonPlan): boolean {
  return (plan.aanbod.result?.updated.length ?? 0) > 0;
}

export function cadeaubonHasChanges(plan: CadeaubonPlan): boolean {
  return (
    aanbodHasWork(plan) || plan.voucher.action === 'create' || plan.voucher.action === 'publish'
  );
}

export function cadeaubonBlockers(plan: CadeaubonPlan): string[] {
  const blockers: string[] = [];
  if (!plan.aanbod.pageId) blockers.push(`${pagePath(AANBOD_SLUG)} does not exist`);
  else if (plan.aanbod.unpublishedDraft) {
    blockers.push(
      `${pagePath(AANBOD_SLUG)} is not published or has unpublished draft edits; publish or discard them first`,
    );
  }
  for (const conflict of plan.aanbod.result?.conflicts ?? []) {
    blockers.push(`${pagePath(AANBOD_SLUG)}: ${conflict}`);
  }
  if (plan.voucher.action === 'conflict') blockers.push(plan.voucher.detail);
  return blockers;
}

export function printCadeaubonPlan(plan: CadeaubonPlan, log: PlanDeps['log']): void {
  log(
    plan.voucher.action === 'create' ? '+' : plan.voucher.action === 'publish' ? '~' : '=',
    `page ${plan.voucher.detail}`,
  );
  const changes = plan.aanbod.result?.changes ?? [];
  if (changes.length === 0) log('=', `page ${pagePath(AANBOD_SLUG)} — nothing to change`);
  else {
    log('~', `page ${pagePath(AANBOD_SLUG)} — ${changes.length} change(s), then publish`);
    for (const change of changes) console.log(`    ${change}`);
  }
  log('=', `guards: ${stable(plan.guards)}`);
}

// ---------------------------------------------------------------------------
// Backup, apply, verify
// ---------------------------------------------------------------------------

function toJson(row: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

async function buildBackup(
  deps: PlanDeps,
  plan: CadeaubonPlan,
  driver: string,
): Promise<RolloutBackup> {
  const { db, orm, schema } = deps;
  const pageIds = [
    ...(aanbodHasWork(plan) ? [plan.aanbod.pageId!] : []),
    ...(plan.voucher.action === 'publish' ? [plan.voucher.pageId!] : []),
  ];
  const pages: RolloutBackup['pages'] = [];
  for (const pageId of pageIds) {
    const [row] = await db.select().from(schema.cmsPages).where(orm.eq(schema.cmsPages.id, pageId));
    const blocks = await db
      .select()
      .from(schema.cmsBlocks)
      .where(orm.eq(schema.cmsBlocks.pageId, pageId))
      .orderBy(orm.asc(schema.cmsBlocks.sortOrder));
    pages.push({ row: toJson(row), blocks: blocks.map(toJson) });
  }
  return rolloutBackupSchema.parse({
    kind: 'aanbod-rollout-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    locale: deps.locale,
    driver,
    pages,
    menus: [],
    redirects: [],
    created: {
      pageSlugs: plan.voucher.action === 'create' ? [VOUCHER_SLUG] : [],
      redirectPaths: [],
    },
    guards: plan.guards,
  });
}

/** Invariants after an apply; an empty list means the voucher is live as intended. */
export async function verifyCadeaubon(deps: PlanDeps): Promise<string[]> {
  const plan = await planCadeaubon(deps);
  const problems = [...cadeaubonBlockers(plan)];
  if (cadeaubonHasChanges(plan)) problems.push('a second plan still finds work');
  const live = async (slug: string) => {
    const row = await pageRow(deps, slug);
    if (row?.status !== 'published') return null;
    const blocks = deps.blocks.parsePublishedSnapshot(row.publishedSnapshot)?.blocks ?? [];
    return blocks.map((block) => ({
      type: block.type,
      data: block.data as Record<string, unknown>,
    }));
  };
  problems.push(...cadeaubonProblems((await live(AANBOD_SLUG)) ?? [], await live(VOUCHER_SLUG)));
  return problems;
}

export type CadeaubonApplyResult = { changed: boolean; backupPath: string | null };

export async function applyCadeaubon(
  deps: RolloutDeps,
  options: { backupDir: string; driver: string },
): Promise<CadeaubonApplyResult> {
  const { repo, log, locale } = deps;
  const plan = await planCadeaubon(deps);
  const blockers = cadeaubonBlockers(plan);
  if (blockers.length > 0) throw new Error(`patch refused:\n  - ${blockers.join('\n  - ')}`);
  if (!cadeaubonHasChanges(plan)) {
    log('=', 'nothing to do: the gift voucher is already live');
    return { changed: false, backupPath: null };
  }

  // 1. Backup FIRST. No backup, no write.
  const backupPath = await writeBackup(
    await buildBackup(deps, plan, options.driver),
    options.backupDir,
    'cadeaubon-patch',
  );
  log('✓', `backup written: ${backupPath}`);

  // 2. The voucher page, so the new group is never empty once /aanbod is published.
  let voucherId = plan.voucher.pageId;
  if (plan.voucher.action === 'create') {
    const created = await repo.createPage({
      locale,
      slug: VOUCHER_SLUG,
      title: CADEAUBON_PAGE.title,
      translationGroup: CADEAUBON_PAGE.translationGroup,
    });
    if (!created.ok) throw new Error(`page ${pagePath(VOUCHER_SLUG)}: ${created.message}`);
    voucherId = created.data.id;
    const updated = await repo.updatePage(voucherId, seoOf(CADEAUBON_PAGE));
    if (!updated.ok) throw new Error(`page ${pagePath(VOUCHER_SLUG)}: ${updated.message}`);
    for (const spec of CADEAUBON_PAGE.blocks) {
      const added = await repo.addBlock(voucherId, spec.type as Parameters<CmsRepo['addBlock']>[1]);
      if (!added.ok)
        throw new Error(`page ${pagePath(VOUCHER_SLUG)} (${spec.type}): ${added.message}`);
      const written = await repo.updateBlock(added.data.id, spec.data);
      if (!written.ok)
        throw new Error(`page ${pagePath(VOUCHER_SLUG)} (${spec.type}): ${written.message}`);
    }
  }
  if (plan.voucher.action === 'create' || plan.voucher.action === 'publish') {
    const published = await repo.publishPage(voucherId!);
    if (!published.ok) throw new Error(`page ${pagePath(VOUCHER_SLUG)}: ${published.message}`);
    log(plan.voucher.action === 'create' ? '+' : '~', `page ${pagePath(VOUCHER_SLUG)} — published`);
  }

  // 3. /aanbod: the catalogue groups, then publish (draft equals live, checked above).
  if (aanbodHasWork(plan)) {
    for (const { block, data } of plan.aanbod.result!.updated) {
      const written = await repo.updateBlock(block.id, data);
      if (!written.ok)
        throw new Error(`page ${pagePath(AANBOD_SLUG)} (${block.type}): ${written.message}`);
    }
    const published = await repo.publishPage(plan.aanbod.pageId!);
    if (!published.ok) throw new Error(`page ${pagePath(AANBOD_SLUG)}: ${published.message}`);
    log('~', `page ${pagePath(AANBOD_SLUG)} — "Overige" added, published`);
  }

  // 4. Verify on what visitors get, and that the booking tables were not touched.
  const problems = await verifyCadeaubon(deps);
  if (problems.length > 0) throw new Error(`verification failed:\n  - ${problems.join('\n  - ')}`);
  log('✓', 'published /aanbod and /aanbod/cadeaubon verified');
  if (stable(await guardCounts(deps)) !== stable(plan.guards)) {
    throw new Error('booking tables changed during the patch!');
  }
  log('✓', 'bookings, services and providers unchanged');
  await deps.auth.recordAudit(deps.db, deps.actor, {
    action: 'patch.cadeaubon.apply',
    entityType: 'cms_rollout',
    summary: 'gift voucher 2026-10-13',
    metadata: {
      backup: backupPath.split(/[\\/]/).pop() ?? backupPath,
      voucher: plan.voucher.action,
      aanbod: aanbodHasWork(plan),
    },
  });
  return { changed: true, backupPath };
}

// ---------------------------------------------------------------------------
// Mode dispatch
// ---------------------------------------------------------------------------

export type CadeaubonRunOptions = { apply: boolean; restore: string | null; backupDir: string };

/** Mode dispatch of the CLI, shared with the self-test. */
export async function runCadeaubonPatch(
  options: CadeaubonRunOptions,
  context: RolloutRunContext,
): Promise<void> {
  const { log } = context;
  const writing = options.apply || options.restore !== null;
  const schema = await import('@/db/cms-schema');
  const planDeps: PlanDeps = {
    db: writing ? context.db : readOnlyDb(context.db),
    orm: await import('drizzle-orm'),
    schema,
    blocks: await import('@/lib/cms/blocks'),
    locale: schema.DEFAULT_LOCALE,
    log,
  };
  const actor = await findActor(planDeps);

  if (!writing) {
    log('=', `would act as ${actor.email} (no session is created in a dry run)`);
    const plan = await planCadeaubon(planDeps);
    printCadeaubonPlan(plan, log);
    const blockers = cadeaubonBlockers(plan);
    for (const blocker of blockers) log('!', blocker);
    console.log('');
    const pending = cadeaubonHasChanges(plan);
    log(
      pending ? '→' : '=',
      blockers.length > 0
        ? 'dry run: blocked — fix the items marked ! first'
        : pending
          ? 'dry run: run again with --apply to write'
          : 'dry run: nothing to do',
    );
    return;
  }

  log('=', `acting as ${actor.email}`);
  await withAdminSession(context, actor.id, 'cms-patch-cadeaubon', async () => {
    const deps: RolloutDeps = {
      ...planDeps,
      repo: await import('@/lib/cms/repo'),
      auth: await import('@/lib/cms/auth'),
      actor,
    };
    if (options.restore) {
      const { readFile } = await import('node:fs/promises');
      const backup = rolloutBackupSchema.parse(JSON.parse(await readFile(options.restore, 'utf8')));
      await restoreAanbodRollout(deps, backup);
      log('✓', 'restore complete');
      return;
    }
    printCadeaubonPlan(await planCadeaubon(deps), log);
    const result = await applyCadeaubon(deps, {
      backupDir: options.backupDir,
      driver: context.driver,
    });
    log(
      '✓',
      result.changed
        ? `patch complete; backup: ${result.backupPath}`
        : 'patch complete; nothing changed',
    );
    if (result.changed)
      console.log('  Deployed sites pick this up within 5 minutes (cache fallback).');
  });
}
