/**
 * Self-test section 15: the aanbod rollout and service preselection, on the
 * throwaway PGlite of `cms-selftest.mts` AFTER section 14 (so there are real
 * services, a provider and bookings in the database).
 *
 * 1. builds a legacy site (home, /bikefit, /over-ons, old main menu) through
 *    the repo, plus an unpublished draft edit on /bikefit;
 * 2. the CLI dry run (`runAanbodRollout`) leaves sessions, audit log, content
 *    and bookings byte-identical and cannot write (read-only db); plan =
 *    read-only; apply refuses the draft edit, then applies with
 *    `allowDraftOverwrite`; the booking tables are byte-for-byte the same;
 * 3. the published result: home starts with the offer, seven offer pages,
 *    the catalogue reader, menus, /over-ons unpublished + 301;
 * 4. `?dienst=` resolution against the live public services;
 * 5. a second apply changes nothing; restore brings the legacy site back.
 *
 * Imported lazily by `cms-selftest.mts` after its request-context stubs.
 */
import { and, eq } from 'drizzle-orm';
import type { CmsDatabase } from '@/db/cms';
import {
  applyAanbodRollout,
  guardCounts,
  planAanbodRollout,
  readBackup,
  restoreAanbodRollout,
  type RolloutDeps,
} from '../lib/aanbod-rollout.mjs';
import { readOnlyDb, runAanbodRollout } from '../lib/aanbod-rollout-run.mjs';

type Check = (label: string, condition: boolean, detail?: string) => void;

export async function aanbodSection(ctx: {
  db: CmsDatabase;
  admin: { id: string; email: string };
  check: Check;
  section: (title: string) => void;
  cookieJar: Map<string, string>;
  backupDir: string;
}) {
  const { db, admin, check, section, cookieJar } = ctx;
  section('15. aanbod rollout + service preselection');

  const orm = await import('drizzle-orm');
  const schema = await import('@/db/cms-schema');
  const blocks = await import('@/lib/cms/blocks');
  const repo = await import('@/lib/cms/repo');
  const auth = await import('@/lib/cms/auth');
  const { createSession } = await import('@/lib/cms/session');
  const { listPublishedOffers } = await import('@/lib/cms/offers-content');
  const { getPublishedPage, getNavigation, findRedirect } = await import('@/lib/cms/content');
  const bookingContent = await import('@/lib/booking/content');
  const { resolveBookingSelection } = await import('@/lib/offers/catalogue');
  const { DEFAULT_OFFERS } = await import('@/lib/offers/defaults');

  const session = await createSession(db, admin.id, { userAgent: 'selftest-aanbod' });
  cookieJar.set('cms_session', session.token);
  const locale = schema.DEFAULT_LOCALE;
  const logged: string[] = [];
  const deps: RolloutDeps = {
    db,
    orm,
    schema,
    blocks,
    repo,
    auth,
    actor: admin,
    locale,
    log: (symbol, message) => logged.push(`${symbol} ${message}`),
  };

  // --- 1. a legacy site -------------------------------------------------------
  async function legacyPage(slug: string, title: string, group: string, heroTitle: string) {
    const created = await repo.createPage({ locale, slug, title, translationGroup: group });
    if (!created.ok) throw new Error(created.message);
    const hero = await repo.addBlock(created.data.id, 'hero');
    if (!hero.ok) throw new Error(hero.message);
    await repo.updateBlock(hero.data.id, { ...blocks.defaultDataFor('hero'), title: heroTitle });
    const audience = await repo.addBlock(created.data.id, 'audience');
    if (!audience.ok) throw new Error(audience.message);
    const published = await repo.publishPage(created.data.id);
    if (!published.ok) throw new Error(published.message);
    return { pageId: created.data.id, heroId: hero.data.id };
  }
  await legacyPage('', 'Home', 'home', 'Fiets met');
  const bikefit = await legacyPage('bikefit', 'De bikefit', 'bikefit', 'De bikefit');
  await legacyPage('over-ons', 'Over ons', 'about', 'Over ons');
  await repo.updateNavigation(locale, 'main', [
    { label: 'Home', href: '/', external: false, group: '', children: [] },
    { label: 'Over ons', href: '/over-ons', external: false, group: '', children: [] },
  ]);
  // An editor's saved-but-unpublished change on /bikefit.
  await repo.updateBlock(bikefit.heroId, {
    ...blocks.defaultDataFor('hero'),
    title: 'Concept van een redacteur',
  });

  const guardsBefore = await guardCounts(deps);
  check(
    'legacy fixture: bookings and services present',
    guardsBefore.bookings > 0 && guardsBefore.services > 0,
    `${guardsBefore.bookings} bookings, ${guardsBefore.services} services`,
  );

  // --- 2. dry run and plan are read-only; apply guards drafts ---------------------
  // The CLI's own dry-run path (`runAanbodRollout`), not just the planner: no
  // session row, no audit entry, no content change, the cookie jar untouched.
  async function fingerprint() {
    const tables = [
      schema.cmsSessions,
      schema.cmsAuditLog,
      schema.cmsPages,
      schema.cmsBlocks,
      schema.cmsNavigation,
      schema.cmsRedirects,
    ] as const;
    const rows = await Promise.all(tables.map((table) => db.select().from(table)));
    return JSON.stringify([
      rows.map((list) => list.map((row) => JSON.stringify(row)).sort()),
      await guardCounts(deps),
    ]);
  }
  const beforeDryRun = await fingerprint();
  const cookieBefore = cookieJar.get('cms_session');
  // Records every write call, so a write that is undone again (create + revoke
  // a session) still counts.
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
  await runAanbodRollout(
    { apply: false, restore: null, backupDir: ctx.backupDir, allowDraftOverwrite: false },
    {
      db: watchedDb,
      driver: 'pglite',
      cookieJar,
      log: (symbol, message) => dryRunLog.push(`${symbol} ${message}`),
    },
  );
  check(
    'dry run (CLI path): no write call reaches the database',
    writeCalls.length === 0,
    writeCalls.join(', '),
  );
  check(
    'dry run (CLI path): sessions, audit log, pages, blocks, menus, redirects, bookings unchanged',
    (await fingerprint()) === beforeDryRun,
  );
  check(
    'dry run (CLI path): no session cookie set or cleared',
    cookieJar.get('cms_session') === cookieBefore,
  );
  check(
    'dry run (CLI path): prints the plan and asks for --apply',
    dryRunLog.some((line) => line.includes('page /aanbod — create')) &&
      dryRunLog.some((line) => line.includes('dry run: blocked')),
    dryRunLog.at(-1),
  );
  let writeBlocked = false;
  try {
    await readOnlyDb(db).insert(schema.cmsSessions).values({
      userId: admin.id,
      tokenHash: 'selftest-read-only-guard',
      expiresAt: new Date(),
    });
  } catch (error) {
    writeBlocked = error instanceof Error && error.message.includes('read-only');
  }
  check(
    'dry run: the read-only database refuses writes',
    writeBlocked && (await fingerprint()) === beforeDryRun,
  );

  const auditBefore = (await db.select({ id: schema.cmsAuditLog.id }).from(schema.cmsAuditLog))
    .length;
  const plan = await planAanbodRollout(deps);
  const auditAfterPlan = (await db.select({ id: schema.cmsAuditLog.id }).from(schema.cmsAuditLog))
    .length;
  check('plan: writes nothing (audit log unchanged)', auditAfterPlan === auditBefore);
  check(
    'plan: creates 10 pages, updates home + /bikefit',
    plan.pages.filter((page) => page.action === 'create').length === 10 &&
      plan.pages
        .filter((page) => page.action === 'update')
        .map((page) => page.path)
        .join() === '/,/bikefit',
  );
  check(
    'plan: flags the unpublished draft on /bikefit',
    plan.pages.find((page) => page.path === '/bikefit')?.unpublishedDraft === true,
  );
  check(
    'plan: /over-ons unpublish + new 301 redirect',
    plan.retire.action === 'unpublish' && plan.redirects[0]?.action === 'create',
  );
  const huidige = plan.catalogue.find((row) => row.offer === 'bikefit-huidige-fiets');
  check(
    'plan: catalogue report — huidige fiets online, the rest by enquiry',
    huidige?.outcome === 'online' &&
      plan.catalogue.filter((row) => row.outcome === 'aanvraag').length === 6,
    huidige?.services.map((service) => `${service.slug}:${service.state}`).join(', '),
  );

  let refused = false;
  try {
    await applyAanbodRollout(deps, {
      backupDir: ctx.backupDir,
      driver: 'pglite',
      allowDraftOverwrite: false,
    });
  } catch (error) {
    refused = error instanceof Error && error.message.includes('unpublished draft');
  }
  check('apply: refuses to overwrite unpublished draft edits', refused);

  const applied = await applyAanbodRollout(deps, {
    backupDir: ctx.backupDir,
    driver: 'pglite',
    allowDraftOverwrite: true,
  });
  check('apply: changed, backup written', applied.changed && applied.backupPath !== null);
  const overwriteAudits = await db
    .select({ summary: schema.cmsAuditLog.summary, metadata: schema.cmsAuditLog.metadata })
    .from(schema.cmsAuditLog)
    .where(eq(schema.cmsAuditLog.action, 'rollout.aanbod.overwrite'));
  check(
    'apply: audit entry per overwritten page, naming the backup',
    overwriteAudits.map((row) => row.summary).join() === 'nl/,nl/bikefit' &&
      overwriteAudits.every((row) =>
        String((row.metadata as { backup?: string } | null)?.backup).startsWith('aanbod-rollout-'),
      ),
  );
  const guardsAfter = await guardCounts(deps);
  check(
    'apply: bookings, services, providers untouched',
    JSON.stringify(guardsAfter) === JSON.stringify(guardsBefore),
  );

  // --- 3. the published result ----------------------------------------------------
  const homePage = await getPublishedPage(locale, '');
  const homeTypes = homePage?.snapshot.blocks.map((block) => block.type) ?? [];
  check(
    'home: hero, then the offer catalogue first',
    homeTypes[0] === 'hero' && homeTypes[1] === 'offerCatalogue',
    homeTypes.join(' → '),
  );
  const offers = await listPublishedOffers(locale);
  check(
    'catalogue reader: seven published offers, 5 Bikefit + 2 Begeleiding, in order',
    offers.map((offer) => offer.slug).join() === DEFAULT_OFFERS.map((offer) => offer.slug).join() &&
      offers.filter((offer) => offer.category === 'begeleiding').length === 2,
  );
  check(
    'catalogue reader: every card says "Prijs op aanvraag"',
    offers.every((offer) => offer.priceLabel === 'Prijs op aanvraag'),
  );
  const mainMenu = await getNavigation(locale, 'main');
  check(
    'menu: Aanbod, Voor wie, Bikefit, Ons team, Contact',
    mainMenu.map((item) => item.label).join() === 'Aanbod,Voor wie,Bikefit,Ons team,Contact',
  );
  const [overOns] = await db
    .select({ status: schema.cmsPages.status, snapshot: schema.cmsPages.publishedSnapshot })
    .from(schema.cmsPages)
    .where(and(eq(schema.cmsPages.locale, locale), eq(schema.cmsPages.slug, 'over-ons')));
  check(
    '/over-ons: unpublished, row and snapshot kept',
    overOns?.status === 'draft' && overOns.snapshot !== null,
  );
  const redirect = await findRedirect('/over-ons');
  check(
    '/over-ons: 301 → /ons-team',
    redirect?.toPath === '/ons-team' && redirect.statusCode === 301,
  );

  // --- 4. ?dienst= against the live public services --------------------------------
  const publicServices = await bookingContent.listPublicServices(locale);
  const services = publicServices.map((service) => ({ id: service.id, slug: service.slug }));
  const adult = publicServices.find((service) => service.slug === 'volwassenenfit');
  const youth = publicServices.find((service) => service.slug === 'jeugdfit');
  const linked = resolveBookingSelection({ requested: 'bikefit-huidige-fiets', offers, services });
  check(
    '?dienst=bikefit-huidige-fiets → widget narrowed to Volwassenenfit + Jeugdfit',
    linked.kind === 'offer' &&
      adult !== undefined &&
      youth !== undefined &&
      linked.serviceIds.join() === [adult.id, youth.id].join(),
  );
  const enquiry = resolveBookingSelection({ requested: 'lactaattest', offers, services });
  check(
    '?dienst=lactaattest → enquiry, no fallback service',
    enquiry.kind === 'offer' && enquiry.serviceIds.length === 0,
  );
  const legacy = resolveBookingSelection({ requested: 'jeugdfit', offers, services });
  check(
    '?dienst=jeugdfit (booking slug) → that service preselected',
    legacy.kind === 'service' && legacy.serviceId === youth?.id,
  );

  // --- 5. idempotent, and reversible ---------------------------------------------
  const again = await applyAanbodRollout(deps, {
    backupDir: ctx.backupDir,
    driver: 'pglite',
    allowDraftOverwrite: false,
  });
  check(
    'apply again: nothing to do, no second backup',
    !again.changed && again.backupPath === null,
  );

  const backup = await readBackup(applied.backupPath!);
  check(
    'backup: holds home, /bikefit (with the editor draft), /over-ons and both menus',
    backup.pages.length === 3 &&
      JSON.stringify(backup.pages).includes('Concept van een redacteur') &&
      backup.menus.length === 2,
  );
  await restoreAanbodRollout(deps, backup);
  const restoredHome = await getPublishedPage(locale, '');
  check(
    'restore: legacy home is live again',
    restoredHome?.snapshot.blocks[0]?.type === 'hero' &&
      (restoredHome.snapshot.blocks[0].data as { title: string }).title === 'Fiets met' &&
      restoredHome.snapshot.blocks[1]?.type === 'audience',
  );
  const [bikefitDraft] = await db
    .select({ data: schema.cmsBlocks.data })
    .from(schema.cmsBlocks)
    .where(eq(schema.cmsBlocks.id, bikefit.heroId));
  check(
    'restore: the editor draft on /bikefit is back',
    (bikefitDraft?.data as { title?: string } | undefined)?.title === 'Concept van een redacteur',
  );
  check(
    'restore: /over-ons published again',
    (await getPublishedPage(locale, 'over-ons')) !== null,
  );
  check(
    'restore: pages created by the rollout are unpublished (not deleted)',
    (await getPublishedPage(locale, 'aanbod')) === null &&
      (await db.select().from(schema.cmsPages).where(eq(schema.cmsPages.slug, 'aanbod'))).length ===
        1,
  );
  check('restore: redirect disabled', (await findRedirect('/over-ons')) === null);
  check(
    'restore: booking tables still untouched',
    JSON.stringify(await guardCounts(deps)) === JSON.stringify(guardsBefore),
  );
  cookieJar.clear();
}
