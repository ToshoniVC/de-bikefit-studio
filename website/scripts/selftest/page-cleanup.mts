/**
 * Self-test section 17: `cms:patch-page-cleanup` on the throwaway PGlite of
 * `cms-selftest.mts`, after sections 14–16 (real services, bookings, pages).
 *
 * 1. fixture: the staging state before the review — /aanbod, /voor-wie,
 *    /ons-team and /afspraak exactly as `page-cleanup.fixture.json` (the seed
 *    at staging@9c655fe), a published /contact, the old menus, an empty
 *    contact e-mail — plus an editor's unpublished draft on /ons-team;
 * 2. the CLI dry run writes nothing; apply refuses the draft;
 * 3. after the editor publishes, apply changes exactly the review's fields,
 *    keeps the editor's edit, redirects /contact, fills in the e-mail, leaves
 *    other pages and the booking tables alone, audits, cleans up its session;
 * 4. a second apply changes nothing; restore puts everything back; a field an
 *    editor changed since the rollout blocks the patch.
 *
 * Imported lazily by `cms-selftest.mts` after its request-context stubs.
 */
import { and, eq } from 'drizzle-orm';
import type { CmsDatabase } from '@/db/cms';
import before from '@/lib/studio/seed-content/page-cleanup.fixture.json';
import { CONTACT_EMAIL, PHONE_HREF } from '@/lib/studio/seed-content/shared';
import { guardCounts, type PlanDeps } from '../lib/aanbod-rollout.mjs';
import { runPageCleanupPatch } from '../lib/page-cleanup-patch.mjs';

type Check = (label: string, condition: boolean, detail?: string) => void;

export async function pageCleanupSection(ctx: {
  db: CmsDatabase;
  admin: { id: string; email: string };
  check: Check;
  section: (title: string) => void;
  cookieJar: Map<string, string>;
  backupDir: string;
}) {
  const { db, admin, check, section, cookieJar, backupDir } = ctx;
  section('17. page cleanup patch (review 13 Oct 2026)');

  const schema = await import('@/db/cms-schema');
  const blocks = await import('@/lib/cms/blocks');
  const repo = await import('@/lib/cms/repo');
  const { createSession, revokeSession } = await import('@/lib/cms/session');
  const { getPublishedPage, getNavigation, findRedirect, getSiteSettings } =
    await import('@/lib/cms/content');
  const locale = schema.DEFAULT_LOCALE;
  const planDeps: PlanDeps = {
    db,
    orm: await import('drizzle-orm'),
    schema,
    blocks,
    locale,
    log: () => {},
  };

  async function asEditor(work: () => Promise<void>) {
    const session = await createSession(db, admin.id, { userAgent: 'selftest-page-cleanup' });
    cookieJar.set('cms_session', session.token);
    try {
      await work();
    } finally {
      cookieJar.delete('cms_session');
      await revokeSession(db, session.token);
    }
  }
  async function pageRow(slug: string) {
    const [row] = await db
      .select()
      .from(schema.cmsPages)
      .where(and(eq(schema.cmsPages.locale, locale), eq(schema.cmsPages.slug, slug)));
    return row;
  }
  /** Creates or overwrites a page with exactly these blocks, then publishes it. */
  async function publishPage(
    slug: string,
    pageBlocks: { type: string; data: unknown }[],
    metaDescription: string,
  ) {
    let pageId = (await pageRow(slug))?.id;
    if (!pageId) {
      const created = await repo.createPage({ locale, slug, title: slug, translationGroup: slug });
      if (!created.ok) throw new Error(created.message);
      pageId = created.data.id;
    }
    await repo.updatePage(pageId, { metaDescription });
    for (const block of (await repo.getPageForEdit(pageId))?.blocks ?? []) {
      await repo.deleteBlock(block.id);
    }
    for (const block of pageBlocks) {
      const added = await repo.addBlock(pageId, block.type as Parameters<typeof repo.addBlock>[1]);
      if (!added.ok) throw new Error(added.message);
      const written = await repo.updateBlock(added.data.id, block.data);
      if (!written.ok) throw new Error(`${slug} ${block.type}: ${written.message}`);
    }
    const published = await repo.publishPage(pageId);
    if (!published.ok) throw new Error(published.message);
    return pageId;
  }

  // --- 1. the staging state before the review --------------------------------------
  await asEditor(async () => {
    for (const page of before.pages) {
      await publishPage(page.slug, page.blocks, page.metaDescription);
    }
    await publishPage(
      'contact',
      [{ type: 'contact', data: blocks.defaultDataFor('contact') }],
      'Contact',
    );
    await repo.updateNavigation(locale, 'main', before.menus.main);
    await repo.updateNavigation(locale, 'footer', before.menus.footer);
    await repo.updateSiteSetting(locale, 'contact', {
      phoneLabel: '0473 95 26 33',
      phoneHref: PHONE_HREF,
      email: '',
      city: 'Ninove',
      hours: 'Op afspraak',
    });
    const team = (await repo.getPageForEdit((await pageRow('ons-team')).id))!.blocks.find(
      (block) => block.type === 'team',
    )!;
    // An editor's saved-but-unpublished change to a bio.
    const data = team.data as { members: { bio: string[] }[] };
    data.members[0].bio = ['Bio aangepast door een redacteur.'];
    await repo.updateBlock(team.id, data);
  });

  const guardsBefore = await guardCounts(planDeps);
  const otherPage = await pageRow('selftest-cta-faq');
  async function fingerprint() {
    const tables = [
      schema.cmsSessions,
      schema.cmsAuditLog,
      schema.cmsPages,
      schema.cmsBlocks,
      schema.cmsNavigation,
      schema.cmsRedirects,
      schema.cmsSiteSettings,
    ] as const;
    const rows = await Promise.all(tables.map((table) => db.select().from(table)));
    return JSON.stringify(rows.map((list) => list.map((row) => JSON.stringify(row)).sort()));
  }

  // --- 2. dry run is read-only; apply refuses the unpublished draft -----------------
  const beforeDryRun = await fingerprint();
  const writeCalls: string[] = [];
  const watchedDb = new Proxy(db, {
    get(target, property, receiver) {
      const writes = ['insert', 'update', 'delete', 'execute', 'transaction', 'batch'];
      if (typeof property === 'string' && writes.includes(property)) writeCalls.push(property);
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const dryRunLog: string[] = [];
  await runPageCleanupPatch(
    { apply: false, restore: null, backupDir },
    {
      db: watchedDb,
      driver: 'pglite',
      cookieJar,
      log: (symbol, message) => dryRunLog.push(`${symbol} ${message}`),
    },
  );
  check('dry run: no write call reaches the database', writeCalls.length === 0, writeCalls.join());
  check(
    'dry run: sessions, audit, content, menus, redirects, settings unchanged; no cookie',
    (await fingerprint()) === beforeDryRun && !cookieJar.has('cms_session'),
  );
  const planned = dryRunLog.join('\n');
  check(
    'dry run: plans the four pages, /contact, both menus and the e-mail; blocks on the draft',
    planned.includes('page /afspraak — 6 change(s)') &&
      planned.includes('page /voor-wie — 7 change(s)') &&
      planned.includes('page /contact — unpublish') &&
      planned.includes('redirect /contact → /afspraak (301) — create') &&
      planned.includes('menu main — "Contact" /contact → /afspraak') &&
      planned.includes(`settings contact.email — "" → ${CONTACT_EMAIL}`) &&
      planned.includes('/ons-team: has unpublished draft edits') &&
      dryRunLog.at(-1)?.includes('dry run: blocked') === true,
    dryRunLog.filter((line) => /^[~!+]/.test(line)).join(' | '),
  );

  const applyLog: string[] = [];
  const run = (options: { apply: boolean; restore: string | null }) =>
    runPageCleanupPatch(
      { ...options, backupDir },
      {
        db,
        driver: 'pglite',
        cookieJar,
        log: (symbol, message) => applyLog.push(`${symbol} ${message}`),
      },
    );
  let refused = '';
  try {
    await run({ apply: true, restore: null });
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error);
  }
  check(
    'apply: refuses an unpublished draft edit and writes no content',
    refused.includes('/ons-team: has unpublished draft edits') &&
      (await fingerprint()) === beforeDryRun,
    refused,
  );

  // --- 3. the editor publishes; apply changes exactly the review --------------------
  await asEditor(async () => {
    await repo.publishPage((await pageRow('ons-team')).id);
  });
  const sessionsLeft = async () => (await db.select().from(schema.cmsSessions)).length;
  const sessionsBefore = await sessionsLeft();
  applyLog.length = 0;
  await run({ apply: true, restore: null });
  const backupPath =
    applyLog.find((line) => line.includes('backup written: '))?.split('backup written: ')[1] ?? '';
  check(
    'apply: backup first, verified, session revoked, cookie cleared',
    backupPath.includes('page-cleanup-patch-') &&
      applyLog.some((line) => line.includes('verified')) &&
      (await sessionsLeft()) === sessionsBefore &&
      !cookieJar.has('cms_session'),
    applyLog.at(-1),
  );

  type Data = Record<string, unknown>;
  const live = async (slug: string) =>
    (await getPublishedPage(locale, slug))?.snapshot.blocks.map((block) => ({
      type: block.type,
      data: block.data as Data,
    })) ?? [];
  const afspraak = await live('afspraak');
  const html = String(afspraak[1]?.data.html ?? '');
  check(
    'live /afspraak: "Kies je moment" first, then "Voor je komt" with "Andere vraag?"',
    afspraak.map((block) => block.type).join() === 'booking,richText' &&
      afspraak[0].data.title === 'Kies je moment' &&
      html.includes('Andere vraag?') &&
      html.includes(`href="mailto:${CONTACT_EMAIL}"`) &&
      html.includes(`href="${PHONE_HREF}"`),
    afspraak.map((block) => block.type).join(),
  );
  const voorWie = await live('voor-wie');
  const team = (await live('ons-team')).find((block) => block.type === 'team')?.data as
    { title: string; members: { bio: string[] }[] } | undefined;
  check(
    'live /voor-wie, /ons-team, /aanbod: kickers, headings and "jeugd" as reviewed',
    !JSON.stringify(voorWie).includes('junioren') &&
      JSON.stringify(voorWie).includes('Of je nu miniem, aspirant, nieuweling of junior bent') &&
      voorWie.find((block) => block.type === 'audience')?.data.title === '' &&
      ((await pageRow('voor-wie')).metaDescription ?? '').endsWith(
        'Extra aandacht voor de jeugd.',
      ) &&
      team?.title === '' &&
      (await live('aanbod'))[0].data.eyebrow === 'Aanbod',
  );
  check(
    "the editor's published bio edit survives the patch",
    team?.members[0].bio[0] === 'Bio aangepast door een redacteur.',
  );
  const contactRow = await pageRow('contact');
  const redirect = await findRedirect('/contact');
  const main = await getNavigation(locale, 'main');
  const settings = await getSiteSettings(locale);
  check(
    '/contact: unpublished (snapshot kept), 301 to /afspraak; menus and e-mail updated',
    contactRow.status === 'draft' &&
      contactRow.publishedSnapshot !== null &&
      redirect?.toPath === '/afspraak' &&
      redirect.statusCode === 301 &&
      main.some((item) => item.label === 'Contact' && item.href === '/afspraak') &&
      !JSON.stringify(await getNavigation(locale, 'footer')).includes('"/contact"') &&
      settings.contact.email === CONTACT_EMAIL &&
      settings.contact.phoneHref === PHONE_HREF,
  );
  check(
    'other pages and the booking tables untouched; apply is audited once',
    JSON.stringify(await pageRow('selftest-cta-faq')) === JSON.stringify(otherPage) &&
      JSON.stringify(await guardCounts(planDeps)) === JSON.stringify(guardsBefore) &&
      (
        await db
          .select()
          .from(schema.cmsAuditLog)
          .where(eq(schema.cmsAuditLog.action, 'patch.page-cleanup.apply'))
      ).length === 1,
  );

  // --- 4. idempotent, reversible, and guarded against later edits ------------------
  applyLog.length = 0;
  await run({ apply: true, restore: null });
  check(
    'apply again: nothing to do, no second backup',
    applyLog.some((line) => line.includes('nothing changed')) &&
      !applyLog.some((line) => line.includes('backup written')),
  );
  await run({ apply: false, restore: backupPath });
  check(
    'restore: old /afspraak, /contact published, redirect off, menus and e-mail back',
    (await live('afspraak')).length === 6 &&
      (await pageRow('contact')).status === 'published' &&
      (await findRedirect('/contact')) === null &&
      JSON.stringify(await getNavigation(locale, 'main')).includes('"/contact"') &&
      (await getSiteSettings(locale)).contact.email === '' &&
      (await sessionsLeft()) === sessionsBefore,
  );

  await asEditor(async () => {
    const hero = (await repo.getPageForEdit((await pageRow('aanbod')).id))!.blocks[0];
    await repo.updateBlock(hero.id, { ...(hero.data as Data), eyebrow: 'Ons volledige aanbod' });
    await repo.publishPage((await pageRow('aanbod')).id);
  });
  dryRunLog.length = 0;
  await runPageCleanupPatch(
    { apply: false, restore: null, backupDir },
    {
      db,
      driver: 'pglite',
      cookieJar,
      log: (symbol, message) => dryRunLog.push(`${symbol} ${message}`),
    },
  );
  check(
    "an editor's own kicker blocks the patch instead of being overwritten",
    dryRunLog.some((line) =>
      line.includes('/aanbod: hero (page head).eyebrow: expected "Aanbod · Ninove"'),
    ) && dryRunLog.at(-1)?.includes('dry run: blocked') === true,
  );
  cookieJar.clear();
}
