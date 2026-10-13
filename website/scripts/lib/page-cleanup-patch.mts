/**
 * Core of `npm run cms:patch-page-cleanup` (and self-test section 17):
 * Toshoni's site review of 13 Oct 2026 on an EXISTING database — and nothing
 * else. The edits themselves are pure data in
 * `src/lib/studio/seed-content/page-cleanup.ts`.
 *
 * Scope:
 *   pages     /aanbod, /voor-wie, /ons-team: the listed fields of the listed
 *             blocks (+ the meta description of /voor-wie); /afspraak: four
 *             blocks removed, the booking kicker emptied, "Andere vraag?"
 *             appended to "Voor je komt"
 *   /contact  301 → /afspraak (created, or an existing disabled row with that
 *             target enabled), then the page unpublished (row, draft and
 *             snapshot kept)
 *   menus     main, footer: links to /contact point at /afspraak, labels kept
 *   settings  contact.email: empty → info@debikefitstudio.be (nothing else)
 *
 * Never touched: any other page, block or field, other settings, media,
 * users, and every booking table (`guardCounts()` before and after).
 *
 *   plan     read-only; refuses (lists `!`) when a page has unpublished draft
 *            edits, when a field holds neither the old nor the new value, or
 *            when /contact already redirects or the e-mail is set elsewhere
 *   apply    writes a JSON backup FIRST, then writes through the real repo
 *            (permissions, sanitising, validation, audit), publishing each
 *            page last; verifies the invariants on the published snapshots
 *   restore  the backup extends the aanbod-rollout format: its restore puts
 *            pages (incl. /contact, re-published) and menus back and disables
 *            the redirect; then the e-mail field is set back
 *
 * Dry run: no session, no audit entry, planned against `readOnlyDb()`
 * (planning lives in `page-cleanup-plan.mts`). Writing modes open one
 * short-lived admin session and always revoke it.
 */
import { z } from 'zod';
import { CONTACT_EMAIL } from '@/lib/studio/seed-content/shared';
import {
  CONTACT_REDIRECT,
  PAGE_CLEANUP_SPECS,
  pageCleanupProblems,
  RETIRED_CONTACT_SLUG,
} from '@/lib/studio/seed-content/page-cleanup';
import {
  guardCounts,
  pagePath,
  restoreAanbodRollout,
  rolloutBackupSchema,
  stable,
  writeBackup,
  type PlanDeps,
  type RolloutDeps,
} from './aanbod-rollout.mjs';
import {
  findActor,
  readOnlyDb,
  withAdminSession,
  type RolloutRunContext,
} from './aanbod-rollout-run.mjs';
import {
  pageChanges,
  pageCleanupBlockers,
  pageCleanupHasChanges,
  pageHasWork,
  pageRow,
  planPageCleanup,
  printPageCleanupPlan,
  type PageCleanupPlan,
} from './page-cleanup-plan.mjs';

export * from './page-cleanup-plan.mjs';

// ---------------------------------------------------------------------------
// Backup and apply
// ---------------------------------------------------------------------------

export const pageCleanupBackupSchema = rolloutBackupSchema.extend({
  pageCleanup: z.object({
    /** `cms_site_settings` contact value before the patch; null = no row. */
    contact: z.record(z.string(), z.unknown()).nullable(),
  }),
});
export type PageCleanupBackup = z.infer<typeof pageCleanupBackupSchema>;

function toJson(row: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

async function buildBackup(deps: PlanDeps, plan: PageCleanupPlan, driver: string) {
  const { db, orm, schema } = deps;
  const pageIds = [
    ...plan.pages.filter(pageHasWork).map((page) => page.pageId!),
    ...(plan.contact.published ? [plan.contact.pageId!] : []),
  ];
  const pages: PageCleanupBackup['pages'] = [];
  for (const pageId of pageIds) {
    const [row] = await db.select().from(schema.cmsPages).where(orm.eq(schema.cmsPages.id, pageId));
    const blocks = await db
      .select()
      .from(schema.cmsBlocks)
      .where(orm.eq(schema.cmsBlocks.pageId, pageId))
      .orderBy(orm.asc(schema.cmsBlocks.sortOrder));
    pages.push({ row: toJson(row), blocks: blocks.map(toJson) });
  }
  const menus: PageCleanupBackup['menus'] = [];
  for (const menu of plan.menus.filter((entry) => entry.changed.length > 0)) {
    const [row] = await db
      .select({ items: schema.cmsNavigation.items })
      .from(schema.cmsNavigation)
      .where(
        orm.and(
          orm.eq(schema.cmsNavigation.locale, deps.locale),
          orm.eq(schema.cmsNavigation.menuKey, menu.key),
        ),
      )
      .limit(1);
    menus.push({ key: menu.key, items: row ? (row.items as unknown[]) : null });
  }
  const redirects: PageCleanupBackup['redirects'] = [];
  if (plan.contact.redirect === 'enable') {
    const [row] = await db
      .select()
      .from(schema.cmsRedirects)
      .where(orm.eq(schema.cmsRedirects.id, plan.contact.redirectId!));
    if (row) redirects.push(toJson(row));
  }
  return pageCleanupBackupSchema.parse({
    kind: 'aanbod-rollout-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    locale: deps.locale,
    driver,
    pages,
    menus,
    redirects,
    created: {
      pageSlugs: [],
      redirectPaths: plan.contact.redirect === 'create' ? [CONTACT_REDIRECT.fromPath] : [],
    },
    guards: plan.guards,
    pageCleanup: { contact: plan.settings.contact },
  });
}

export type PageCleanupApplyResult = { changed: boolean; backupPath: string | null };

export async function applyPageCleanup(
  deps: RolloutDeps,
  options: { backupDir: string; driver: string },
): Promise<PageCleanupApplyResult> {
  const { repo, log, locale } = deps;
  const plan = await planPageCleanup(deps);
  const blockers = pageCleanupBlockers(plan);
  if (blockers.length > 0) throw new Error(`patch refused:\n  - ${blockers.join('\n  - ')}`);
  if (!pageCleanupHasChanges(plan)) {
    log('=', 'nothing to do: the review is already applied');
    return { changed: false, backupPath: null };
  }

  // 1. Backup FIRST. No backup, no write.
  const backupPath = await writeBackup(
    await buildBackup(deps, plan, options.driver),
    options.backupDir,
    'page-cleanup-patch',
  );
  const backupFile = backupPath.split(/[\\/]/).pop() ?? backupPath;
  log('✓', `backup written: ${backupPath}`);

  // 2. The e-mail address first, so the new "Andere vraag?" line and the footer agree.
  if (plan.settings.action === 'set') {
    const result = await repo.updateSiteSetting(locale, 'contact', {
      ...(plan.settings.contact ?? {}),
      email: CONTACT_EMAIL,
    });
    if (!result.ok) throw new Error(`settings contact: ${result.message}`);
    log('~', `settings contact.email → ${CONTACT_EMAIL}`);
  }

  // 3. Pages: blocks, meta, then publish (draft equals live, checked above).
  for (const page of plan.pages.filter(pageHasWork)) {
    for (const block of page.result?.removed ?? []) {
      const removed = await repo.deleteBlock(block.id);
      if (!removed.ok) throw new Error(`page ${page.path} (${block.type}): ${removed.message}`);
    }
    for (const { block, data } of page.result?.updated ?? []) {
      const written = await repo.updateBlock(block.id, data);
      if (!written.ok) throw new Error(`page ${page.path} (${block.type}): ${written.message}`);
    }
    if (page.meta && !page.meta.conflict) {
      const updated = await repo.updatePage(page.pageId!, { metaDescription: page.meta.to });
      if (!updated.ok) throw new Error(`page ${page.path}: ${updated.message}`);
    }
    const published = await repo.publishPage(page.pageId!);
    if (!published.ok) throw new Error(`page ${page.path}: ${published.message}`);
    log('~', `page ${page.path} — ${pageChanges(page).length} change(s), published`);
  }

  // 4. Redirect before unpublishing, so /contact never answers 404.
  if (plan.contact.redirect === 'create') {
    const result = await repo.createRedirect(CONTACT_REDIRECT);
    if (!result.ok) throw new Error(`redirect: ${result.message}`);
  } else if (plan.contact.redirect === 'enable') {
    const result = await repo.updateRedirect(plan.contact.redirectId!, {
      isEnabled: true,
      statusCode: CONTACT_REDIRECT.statusCode,
    });
    if (!result.ok) throw new Error(`redirect: ${result.message}`);
  }
  if (plan.contact.redirect !== 'unchanged') log('+', `redirect ${plan.contact.detail}`);
  if (plan.contact.published) {
    const result = await repo.unpublishPage(plan.contact.pageId!);
    if (!result.ok) throw new Error(`page /${RETIRED_CONTACT_SLUG}: ${result.message}`);
    log('~', `page /${RETIRED_CONTACT_SLUG} — unpublished (row, draft and snapshot kept)`);
  }

  // 5. Menus.
  for (const menu of plan.menus.filter((entry) => entry.changed.length > 0)) {
    const result = await repo.updateNavigation(locale, menu.key, menu.items);
    if (!result.ok) throw new Error(`menu ${menu.key}: ${result.message}`);
    log('~', `menu ${menu.key} — ${menu.changed.join('; ')}`);
  }

  // 6. Verify on what visitors get, and that the booking tables were not touched.
  const problems = await verifyPageCleanup(deps);
  if (problems.length > 0) throw new Error(`verification failed:\n  - ${problems.join('\n  - ')}`);
  log('✓', 'published pages, redirect, menus and e-mail verified');
  if (stable(await guardCounts(deps)) !== stable(plan.guards)) {
    throw new Error('booking tables changed during the patch!');
  }
  log('✓', 'bookings, services and providers unchanged');
  await deps.auth.recordAudit(deps.db, deps.actor, {
    action: 'patch.page-cleanup.apply',
    entityType: 'cms_rollout',
    summary: 'site review 2026-10-13',
    metadata: {
      backup: backupFile,
      pages: plan.pages.filter(pageHasWork).map((page) => page.path),
      contact: { unpublished: plan.contact.published, redirect: plan.contact.redirect },
      menus: plan.menus.filter((menu) => menu.changed.length > 0).map((menu) => menu.key),
      email: plan.settings.action === 'set',
    },
  });
  return { changed: true, backupPath };
}

/** Invariants after an apply; an empty list means the review is live as intended. */
export async function verifyPageCleanup(deps: PlanDeps): Promise<string[]> {
  const plan = await planPageCleanup(deps);
  const problems = [...pageCleanupBlockers(plan)];
  if (pageCleanupHasChanges(plan)) problems.push('a second plan still finds work');
  for (const spec of PAGE_CLEANUP_SPECS) {
    const row = await pageRow(deps, spec.slug);
    const live = deps.blocks.parsePublishedSnapshot(row?.publishedSnapshot)?.blocks ?? [];
    const blocks = live.map((block) => ({
      type: block.type,
      data: block.data as Record<string, unknown>,
    }));
    for (const problem of pageCleanupProblems(spec.slug, blocks)) {
      problems.push(`live ${pagePath(spec.slug)}: ${problem}`);
    }
  }
  const [redirect] = await deps.db
    .select()
    .from(deps.schema.cmsRedirects)
    .where(deps.orm.eq(deps.schema.cmsRedirects.fromPath, CONTACT_REDIRECT.fromPath))
    .limit(1);
  if (!redirect?.isEnabled || redirect.toPath !== CONTACT_REDIRECT.toPath) {
    problems.push(`${CONTACT_REDIRECT.fromPath} does not redirect to ${CONTACT_REDIRECT.toPath}`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Restore and mode dispatch
// ---------------------------------------------------------------------------

export async function restorePageCleanup(
  deps: RolloutDeps,
  backup: PageCleanupBackup,
): Promise<void> {
  await restoreAanbodRollout(deps, backup);
  const plan = await planPageCleanup(deps);
  const before = backup.pageCleanup.contact;
  const email = typeof before?.email === 'string' ? before.email : '';
  const current = plan.settings.contact ?? {};
  if (current.email !== email) {
    // Only the e-mail field goes back; later edits to the other fields stay.
    const result = await deps.repo.updateSiteSetting(deps.locale, 'contact', { ...current, email });
    if (!result.ok) throw new Error(`settings contact: ${result.message}`);
    deps.log('~', `settings contact.email — restored to ${JSON.stringify(email)}`);
  }
}

export type PageCleanupRunOptions = { apply: boolean; restore: string | null; backupDir: string };

/** Mode dispatch of the CLI, shared with the self-test. */
export async function runPageCleanupPatch(
  options: PageCleanupRunOptions,
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
    const plan = await planPageCleanup(planDeps);
    printPageCleanupPlan(plan, log);
    const blockers = pageCleanupBlockers(plan);
    for (const blocker of blockers) log('!', blocker);
    console.log('');
    const pending = pageCleanupHasChanges(plan);
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
  await withAdminSession(context, actor.id, 'cms-patch-page-cleanup', async () => {
    const deps: RolloutDeps = {
      ...planDeps,
      repo: await import('@/lib/cms/repo'),
      auth: await import('@/lib/cms/auth'),
      actor,
    };
    if (options.restore) {
      const { readFile } = await import('node:fs/promises');
      const backup = pageCleanupBackupSchema.parse(
        JSON.parse(await readFile(options.restore, 'utf8')),
      );
      await restorePageCleanup(deps, backup);
      log('✓', 'restore complete');
      return;
    }
    printPageCleanupPlan(await planPageCleanup(deps), log);
    const result = await applyPageCleanup(deps, {
      backupDir: options.backupDir,
      driver: context.driver,
    });
    log(
      '✓',
      result.changed
        ? `patch complete; backup: ${result.backupPath}`
        : 'patch complete; nothing changed',
    );
    if (result.changed) {
      console.log('  Deployed sites pick this up within 5 minutes (cache fallback).');
    }
  });
}
