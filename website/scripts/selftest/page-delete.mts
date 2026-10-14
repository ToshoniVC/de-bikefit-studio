/**
 * Self-test section 8b (AZ-1, authz review 14 Oct 2026): deleting a published
 * page needs `page.unpublish`, on the throwaway PGlite of `cms-selftest.mts`.
 * Every delete goes through the real `deletePage()` (`src/lib/cms/repo.ts`)
 * with a real session in the cookie jar, as a forged server-action POST would,
 * so the form the page editor hides plays no part:
 *
 *  1. the self-test admin (both steps) publishes a page with two blocks and the
 *     home page; a throwaway editor (password only) creates a draft;
 *  2. the editor deleting either published page is refused with the reason
 *     from `src/lib/cms/page-policy.ts`: both stay published with snapshot and
 *     blocks, visitors still get them, and nothing is audited; the delete
 *     statement alone (`src/lib/cms/page-delete.ts`, the guard bypassed: what a
 *     page published between the check and the delete meets) leaves the
 *     published page alone as well;
 *  3. the editor deletes the draft: row and blocks gone, audited as the editor;
 *  4. the admin deletes the published page: gone for visitors, audited;
 *  5. after the admin takes the home page offline (snapshot kept), the editor
 *     may delete it, which is what the refusal asks the editor to arrange.
 *
 * The pages, the editor and the sessions are removed again and the cookie jar
 * is cleared, so later sections find the database as before. Imported lazily
 * by `cms-selftest.mts` after its request-context stubs.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { CmsDatabase } from '@/db/cms';
import type { CmsPageStatus } from '@/db/cms-schema';
import type { RepoResult } from '@/lib/cms/repo';

type Check = (label: string, condition: boolean, detail?: string) => void;
/** What is left of a page: its status (`gone` without a row), snapshot and draft blocks. */
type PageState = { status: CmsPageStatus | 'gone'; snapshot: boolean; blocks: number };

const EDITOR_EMAIL = 'verwijderen-redacteur@selftest.local';
const LIVE_SLUG = 'selftest-verwijderen';
const DRAFT_SLUG = 'selftest-verwijderen-concept';

/** Set-up that must succeed: the repo's message otherwise. */
function must<T>(result: RepoResult<T>, what: string): T {
  if (!result.ok) throw new Error(`page-delete set-up, ${what}: ${result.message}`);
  return result.data;
}

export async function pageDeleteSection(ctx: {
  db: CmsDatabase;
  admin: { id: string; email: string };
  check: Check;
  section: (title: string) => void;
  cookieJar: Map<string, string>;
}) {
  const { db, admin, check, section, cookieJar } = ctx;
  section('8b. deleting a published page needs page.unpublish');

  const { cmsAuditLog, cmsBlocks, cmsPages, cmsSessions, cmsUsers, DEFAULT_LOCALE } =
    await import('@/db/cms-schema');
  const { CmsAuthError } = await import('@/lib/cms/auth');
  const { getPublishedPage } = await import('@/lib/cms/content');
  const { deletePageRow } = await import('@/lib/cms/page-delete');
  const { PUBLISHED_PAGE_DELETE_DENIED } = await import('@/lib/cms/page-policy');
  const repo = await import('@/lib/cms/repo');
  const { createSession, revokeSession } = await import('@/lib/cms/session');

  /** Runs `work` signed in as `userId`, right after a full sign-in (both steps for the admin). */
  async function as<T>(userId: string, work: () => Promise<T>): Promise<T> {
    const session = await createSession(
      db,
      userId,
      { userAgent: 'selftest-page-delete' },
      { mfaVerified: userId === admin.id, reauthenticated: true },
    );
    cookieJar.set('cms_session', session.token);
    try {
      return await work();
    } finally {
      cookieJar.delete('cms_session');
      await revokeSession(db, session.token);
    }
  }
  /** `ok`, `refused: <message>` when the repo said no, the guard's code, or `other: …`. */
  async function outcome(call: () => Promise<RepoResult<unknown>>): Promise<string> {
    try {
      const result = await call();
      return result.ok ? 'ok' : `refused: ${result.message}`;
    } catch (error) {
      if (error instanceof CmsAuthError) return error.code;
      return `other: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  async function stateOf(pageId: string): Promise<PageState> {
    const [row] = await db
      .select({ status: cmsPages.status, snapshot: cmsPages.publishedSnapshot })
      .from(cmsPages)
      .where(eq(cmsPages.id, pageId));
    const [blocks] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(cmsBlocks)
      .where(eq(cmsBlocks.pageId, pageId));
    return {
      status: row?.status ?? 'gone',
      snapshot: row?.snapshot != null,
      blocks: Number(blocks?.n ?? 0),
    };
  }
  /** The user ids on the `page.delete` audit entries for `pageId`. */
  async function deletedBy(pageId: string): Promise<(string | null)[]> {
    const rows = await db
      .select({ userId: cmsAuditLog.userId })
      .from(cmsAuditLog)
      .where(and(eq(cmsAuditLog.action, 'page.delete'), eq(cmsAuditLog.entityId, pageId)));
    return rows.map((row) => row.userId);
  }
  const auditCount = async () =>
    Number((await db.select({ n: sql<number>`count(*)::int` }).from(cmsAuditLog))[0]?.n ?? 0);

  const [editor] = await db
    .insert(cmsUsers)
    .values({
      email: EDITOR_EMAIL,
      name: 'Selftest redacteur',
      role: 'editor',
      passwordHash: 'no-login',
      mustChangePassword: false,
    })
    .returning({ id: cmsUsers.id });
  const created: string[] = [];

  try {
    // --- 1. a published page, the published home page, an editor's draft ------
    const [liveId, homeId] = await as(admin.id, async () => {
      const ids: string[] = [];
      for (const [slug, title, types] of [
        [LIVE_SLUG, 'Zelftest verwijderen', ['hero', 'faq']],
        ['', 'Zelftest home', ['hero']],
      ] as const) {
        const page = must(await repo.createPage({ slug, title }), `createPage /${slug}`);
        created.push(page.id);
        ids.push(page.id);
        for (const type of types) must(await repo.addBlock(page.id, type), `addBlock ${type}`);
        must(await repo.publishPage(page.id), `publishPage /${slug}`);
      }
      return ids;
    });
    const draftId = await as(editor.id, async () => {
      const page = must(
        await repo.createPage({ slug: DRAFT_SLUG, title: 'Zelftest concept' }),
        'createPage (editor)',
      );
      created.push(page.id);
      must(await repo.addBlock(page.id, 'hero'), 'addBlock (editor)');
      return page.id;
    });

    // --- 2. the editor cannot delete a published page, nor the home page -------
    const auditBefore = await auditCount();
    const refused = await as(editor.id, async () => ({
      live: await outcome(() => repo.deletePage(liveId)),
      home: await outcome(() => repo.deletePage(homeId)),
    }));
    const reason = `refused: ${PUBLISHED_PAGE_DELETE_DENIED}`;
    check(
      'editor: deleting a published page is refused with the Dutch reason',
      refused.live === reason,
      refused.live,
    );
    check(
      'editor: deleting the published home page is refused too',
      refused.home === reason,
      refused.home,
    );
    const live = await stateOf(liveId);
    const home = await stateOf(homeId);
    check(
      'refused: both pages are still published, snapshot and blocks intact',
      live.status === 'published' &&
        live.snapshot &&
        live.blocks === 2 &&
        home.status === 'published' &&
        home.snapshot &&
        home.blocks === 1,
      JSON.stringify({ live, home }),
    );
    check(
      'refused: visitors still get both pages (getPublishedPage)',
      (await getPublishedPage(DEFAULT_LOCALE, LIVE_SLUG)) !== null &&
        (await getPublishedPage(DEFAULT_LOCALE, '')) !== null,
    );
    check(
      'refused: nothing was audited (no page.delete entry, audit log unchanged)',
      (await deletedBy(liveId)).length === 0 &&
        (await deletedBy(homeId)).length === 0 &&
        (await auditCount()) === auditBefore,
    );
    // The statement alone, as if the page had been published after the check.
    const raced = await deletePageRow(db, liveId, 'editor');
    const racedLive = await stateOf(liveId);
    const missing = await deletePageRow(db, 'selftest-geen-pagina', 'editor');
    check(
      'statement: with the guard bypassed, an editor still cannot delete the published page',
      raced === PUBLISHED_PAGE_DELETE_DENIED &&
        racedLive.status === 'published' &&
        racedLive.blocks === 2 &&
        missing === 'Pagina niet gevonden.',
      `${raced ?? 'deleted'} | ${JSON.stringify(racedLive)} | ${missing ?? 'deleted'}`,
    );

    // --- 3. the editor still deletes a draft -----------------------------------
    const draftResult = await as(editor.id, () => outcome(() => repo.deletePage(draftId)));
    const draft = await stateOf(draftId);
    const draftAudit = await deletedBy(draftId);
    check(
      'editor: deleting a draft still works (row and blocks gone)',
      draftResult === 'ok' && draft.status === 'gone' && draft.blocks === 0,
      draftResult,
    );
    check(
      'editor: that deletion is audited once, as the editor',
      draftAudit.length === 1 && draftAudit[0] === editor.id,
    );

    // --- 4. an admin still deletes a published page ------------------------------
    const adminResult = await as(admin.id, () => outcome(() => repo.deletePage(liveId)));
    const gone = await stateOf(liveId);
    const adminAudit = await deletedBy(liveId);
    check(
      'admin: deleting a published page still works (row and blocks gone)',
      adminResult === 'ok' && gone.status === 'gone' && gone.blocks === 0,
      adminResult,
    );
    check(
      'admin: the page is gone for visitors; the deletion is audited once, as the admin',
      (await getPublishedPage(DEFAULT_LOCALE, LIVE_SLUG)) === null &&
        adminAudit.length === 1 &&
        adminAudit[0] === admin.id,
    );

    // --- 5. once an admin took it offline, the editor may delete it ---------------
    const offline = await as(admin.id, () => outcome(() => repo.unpublishPage(homeId)));
    const homeOffline = await stateOf(homeId);
    const homeResult = await as(editor.id, () => outcome(() => repo.deletePage(homeId)));
    check(
      'editor: after an admin took the home page offline (snapshot kept), deleting it works',
      offline === 'ok' &&
        homeOffline.status === 'draft' &&
        homeOffline.snapshot &&
        homeResult === 'ok' &&
        (await stateOf(homeId)).status === 'gone',
      `${offline} → ${homeOffline.status} → ${homeResult}`,
    );
  } finally {
    cookieJar.clear();
    if (created.length > 0) await db.delete(cmsPages).where(inArray(cmsPages.id, created));
    await db.delete(cmsUsers).where(eq(cmsUsers.id, editor.id));
  }

  const leftPages = await db
    .select({ id: cmsPages.id })
    .from(cmsPages)
    .where(
      and(eq(cmsPages.locale, DEFAULT_LOCALE), inArray(cmsPages.slug, [LIVE_SLUG, DRAFT_SLUG, ''])),
    );
  const [leftEditor] = await db
    .select({ id: cmsUsers.id })
    .from(cmsUsers)
    .where(eq(cmsUsers.email, EDITOR_EMAIL));
  const [leftSessions] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(cmsSessions)
    .where(eq(cmsSessions.userAgent, 'selftest-page-delete'));
  check(
    'cleanup: the throwaway pages, the editor and the sessions are gone; cookie jar empty',
    leftPages.length === 0 &&
      !leftEditor &&
      Number(leftSessions?.n ?? 0) === 0 &&
      cookieJar.size === 0,
  );
}
