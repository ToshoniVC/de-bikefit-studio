/**
 * Core of `npm run cms:patch-booking-cta` (and self-test section 16): points
 * every published "Boek je bikefit" button that still dials the phone (or
 * jumps to `#contact`) at the booking page, like the header's
 * "Afspraak maken". Nothing else.
 *
 * Scope: per page, only the `href` of a link whose label starts with
 * "Boek je bikefit" and that points at `tel:` or `#contact` (the matcher is
 * `src/lib/studio/seed-content/booking-cta.ts`). Labels, styles, phone-number
 * links and every other field stay as they are. Pages that are not published
 * are reported and left alone. Booking tables, settings, menus, redirects,
 * media and users are never written; `guardCounts()` proves the booking side.
 *
 *   plan     read-only: which page, which block, which link, from where
 *   apply    refuses a page with unpublished draft edits (an editor's work is
 *            never published by this tool), writes a JSON backup FIRST, then
 *            updates the blocks through the real repo (permissions,
 *            sanitising, validation, audit) and publishes each page
 *   restore  the backup has the aanbod-rollout format, so its restore puts
 *            the page rows and draft blocks back exactly
 *
 * The dry run follows the aanbod rollout's rules: no session, no audit entry,
 * planned against `readOnlyDb()`. Writing modes open one short-lived admin
 * session and always revoke it.
 */
import { retargetBookingCtas, type BookingCtaChange } from '@/lib/studio/seed-content/booking-cta';
import { BOOKING_PATH } from '@/lib/studio/seed-content/shared';
import {
  guardCounts,
  pagePath,
  readBackup,
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

export type BookingCtaPagePlan = {
  pageId: string;
  path: string;
  status: 'draft' | 'published';
  /** Saved draft blocks differ from what is live: unpublished editor work. */
  unpublishedDraft: boolean;
  /** Misdirected links in the live snapshot (what visitors see now). */
  live: BookingCtaChange[];
  /** The draft blocks the apply rewrites, with their retargeted data. */
  drafts: { blockId: string; type: string; data: unknown; changes: BookingCtaChange[] }[];
};

export type BookingCtaPlan = { locale: string; pages: BookingCtaPagePlan[] };

function normalized(deps: PlanDeps, input: { type: string; data: unknown }[]): string | null {
  const result = deps.blocks.validateBlocks(input);
  return result.ok ? stable(result.blocks.map((block) => [block.type, block.data])) : null;
}

export async function planBookingCtaPatch(deps: PlanDeps): Promise<BookingCtaPlan> {
  const { db, orm, schema, locale } = deps;
  const { asc, eq } = orm;
  const rows = await db
    .select()
    .from(schema.cmsPages)
    .where(eq(schema.cmsPages.locale, locale))
    .orderBy(asc(schema.cmsPages.slug));

  const pages: BookingCtaPagePlan[] = [];
  for (const row of rows) {
    const snapshot = deps.blocks.parsePublishedSnapshot(row.publishedSnapshot);
    const liveBlocks = snapshot?.blocks ?? [];
    const draftBlocks = await db
      .select()
      .from(schema.cmsBlocks)
      .where(eq(schema.cmsBlocks.pageId, row.id))
      .orderBy(asc(schema.cmsBlocks.sortOrder));

    const live = liveBlocks.flatMap(
      (block, index) => retargetBookingCtas(block.data, `${index}:${block.type}`).changes,
    );
    const drafts = draftBlocks
      .map((block) => {
        const result = retargetBookingCtas(block.data, `${block.sortOrder}:${block.type}`);
        return { blockId: block.id, type: block.type, ...result };
      })
      .filter((block) => block.changes.length > 0);
    if (live.length === 0 && drafts.length === 0) continue;

    const draft = normalized(deps, draftBlocks);
    pages.push({
      pageId: row.id,
      path: pagePath(row.slug),
      status: row.status,
      unpublishedDraft:
        row.status === 'published' && (draft === null || draft !== normalized(deps, liveBlocks)),
      live,
      drafts,
    });
  }
  return { locale, pages };
}

/** Pages the apply writes: published, and the live page has a misdirected link. */
function targets(plan: BookingCtaPlan) {
  return plan.pages.filter((page) => page.status === 'published' && page.live.length > 0);
}

export function bookingCtaBlockers(plan: BookingCtaPlan): string[] {
  return targets(plan)
    .filter((page) => page.unpublishedDraft)
    .map(
      (page) =>
        `page ${page.path}: has unpublished draft edits; publish or discard them in /admin first (this tool never publishes an editor's draft)`,
    );
}

export function printBookingCtaPlan(plan: BookingCtaPlan, log: PlanDeps['log']): void {
  log('=', `locale ${plan.locale}; booking target ${BOOKING_PATH}`);
  if (plan.pages.length === 0) log('=', 'no "Boek je bikefit" link dials or points at #contact');
  for (const page of plan.pages) {
    const state =
      page.status !== 'published'
        ? 'skipped (not published; fix in /admin before publishing)'
        : page.live.length === 0
          ? 'skipped (live page already fine; draft-only link left for the editor)'
          : `retarget ${page.live.length} link(s)`;
    log(
      page.status === 'published' && page.live.length > 0 ? '~' : '=',
      `page ${page.path} — ${state}`,
    );
    for (const change of page.live) {
      log(' ', `  ${change.path}: "${change.label}" ${change.from} → ${BOOKING_PATH}`);
    }
  }
}

export type BookingCtaApplyResult = { changed: boolean; backupPath: string | null };

export async function applyBookingCtaPatch(
  deps: RolloutDeps,
  options: { backupDir: string; driver: string },
): Promise<BookingCtaApplyResult> {
  const { db, orm, schema, repo, log } = deps;
  const { asc, eq } = orm;
  const plan = await planBookingCtaPatch(deps);
  const blockers = bookingCtaBlockers(plan);
  if (blockers.length > 0) throw new Error(`patch refused:\n  - ${blockers.join('\n  - ')}`);
  const pages = targets(plan);
  if (pages.length === 0) {
    log('=', 'nothing to do: no published "Boek je bikefit" link dials or points at #contact');
    return { changed: false, backupPath: null };
  }

  // 1. Backup FIRST, in the aanbod-rollout format so its restore can use it.
  const guards = await guardCounts(deps);
  const backupPages = [];
  for (const page of pages) {
    const [row] = await db
      .select()
      .from(schema.cmsPages)
      .where(eq(schema.cmsPages.id, page.pageId));
    const blocks = await db
      .select()
      .from(schema.cmsBlocks)
      .where(eq(schema.cmsBlocks.pageId, page.pageId))
      .orderBy(asc(schema.cmsBlocks.sortOrder));
    backupPages.push({ row: toJson(row), blocks: blocks.map(toJson) });
  }
  const backup = rolloutBackupSchema.parse({
    kind: 'aanbod-rollout-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    locale: deps.locale,
    driver: options.driver,
    pages: backupPages,
    menus: [],
    redirects: [],
    created: { pageSlugs: [], redirectPaths: [] },
    guards,
  });
  const backupPath = await writeBackup(backup, options.backupDir, 'booking-cta-patch');
  const backupFile = backupPath.split(/[\\/]/).pop() ?? backupPath;
  log('✓', `backup written: ${backupPath}`);

  // 2. Draft blocks, then publish. Draft equals live (checked above), so the
  //    publish changes exactly the retargeted links.
  for (const page of pages) {
    for (const block of page.drafts) {
      const written = await repo.updateBlock(block.blockId, block.data);
      if (!written.ok) throw new Error(`page ${page.path} (${block.type}): ${written.message}`);
    }
    const published = await repo.publishPage(page.pageId);
    if (!published.ok) throw new Error(`page ${page.path}: ${published.message}`);
    log('~', `page ${page.path} — ${page.live.length} link(s) → ${BOOKING_PATH}, published`);
  }

  // 3. Verify: nothing left to patch on those pages, booking tables untouched.
  const after = await planBookingCtaPatch(deps);
  const left = targets(after).filter((page) => pages.some((done) => done.pageId === page.pageId));
  if (left.length > 0) {
    throw new Error(`still misdirected after publish: ${left.map((page) => page.path).join(', ')}`);
  }
  if (stable(await guardCounts(deps)) !== stable(guards)) {
    throw new Error('booking tables changed during the patch!');
  }
  log('✓', 'bookings, services and providers unchanged');
  await deps.auth.recordAudit(db, deps.actor, {
    action: 'patch.booking-cta.apply',
    entityType: 'cms_rollout',
    summary: `booking CTA → ${BOOKING_PATH}`,
    metadata: {
      backup: backupFile,
      pages: pages.map((page) => ({
        path: page.path,
        links: page.live.map((change) => `${change.path} ${change.from}`),
      })),
    },
  });
  return { changed: true, backupPath };
}

function toJson(row: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

export type BookingCtaRunOptions = { apply: boolean; restore: string | null; backupDir: string };

/** Mode dispatch of the CLI, shared with the self-test. */
export async function runBookingCtaPatch(
  options: BookingCtaRunOptions,
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
    const plan = await planBookingCtaPatch(planDeps);
    printBookingCtaPlan(plan, log);
    const blockers = bookingCtaBlockers(plan);
    for (const blocker of blockers) log('!', blocker);
    console.log('');
    const pending = targets(plan).length > 0;
    log(
      pending ? '→' : '=',
      !pending
        ? 'dry run: nothing to do'
        : blockers.length > 0
          ? 'dry run: blocked — fix the items marked ! first'
          : 'dry run: run again with --apply to write',
    );
    return;
  }

  log('=', `acting as ${actor.email}`);
  await withAdminSession(context, actor.id, 'cms-patch-booking-cta', async () => {
    const deps: RolloutDeps = {
      ...planDeps,
      repo: await import('@/lib/cms/repo'),
      auth: await import('@/lib/cms/auth'),
      actor,
    };
    if (options.restore) {
      await restoreAanbodRollout(deps, await readBackup(options.restore));
      log('✓', 'restore complete');
      return;
    }
    printBookingCtaPlan(await planBookingCtaPatch(deps), log);
    const result = await applyBookingCtaPatch(deps, {
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
