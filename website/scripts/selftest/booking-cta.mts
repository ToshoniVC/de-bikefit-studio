/**
 * Self-test section 16: `cms:patch-booking-cta` on the throwaway PGlite of
 * `cms-selftest.mts`, after section 15 (real services, provider, bookings).
 *
 * 1. fixture: three pages with the old dialling "Boek je bikefit" callout —
 *    published, published with an editor's unpublished draft, never
 *    published — next to visible phone-number links;
 * 2. the CLI dry run writes nothing (no write call, no session, no cookie);
 *    apply refuses while the draft is unpublished;
 * 3. after the editor publishes, apply retargets only those hrefs, keeps the
 *    editor's copy and every phone link, leaves the unpublished page and the
 *    booking tables alone, audits, and cleans up its session;
 * 4. a second apply changes nothing; restore puts the old content back.
 *
 * Imported lazily by `cms-selftest.mts` after its request-context stubs.
 */
import { and, eq } from 'drizzle-orm';
import type { CmsDatabase } from '@/db/cms';
import { guardCounts, type PlanDeps } from '../lib/aanbod-rollout.mjs';
import { runBookingCtaPatch } from '../lib/booking-cta-patch.mjs';

type Check = (label: string, condition: boolean, detail?: string) => void;

const PHONE_HREF = 'tel:+32473952633';
const OLD_CALLOUT = {
  variant: 'accent',
  title: 'Comfort is een keuze. Maak ze.',
  body: '',
  primaryCta: { label: 'Boek je bikefit →', href: PHONE_HREF, external: false },
  secondaryCta: null,
};

export async function bookingCtaSection(ctx: {
  db: CmsDatabase;
  admin: { id: string; email: string };
  check: Check;
  section: (title: string) => void;
  cookieJar: Map<string, string>;
  backupDir: string;
}) {
  const { db, admin, check, section, cookieJar, backupDir } = ctx;
  section('16. booking CTA patch (Boek je bikefit → /afspraak)');

  const schema = await import('@/db/cms-schema');
  const blocks = await import('@/lib/cms/blocks');
  const repo = await import('@/lib/cms/repo');
  const { createSession, revokeSession } = await import('@/lib/cms/session');
  const { getPublishedPage } = await import('@/lib/cms/content');
  const locale = schema.DEFAULT_LOCALE;
  const planDeps: PlanDeps = {
    db,
    orm: await import('drizzle-orm'),
    schema,
    blocks,
    locale,
    log: () => {},
  };

  // --- 1. fixture (through the repo, with the selftest's own session) -------------
  const fixtureSession = await createSession(
    db,
    admin.id,
    { userAgent: 'selftest-booking-cta' },
    { mfaVerified: true },
  );
  cookieJar.set('cms_session', fixtureSession.token);
  async function page(slug: string, publish: boolean) {
    const created = await repo.createPage({ locale, slug, title: slug, translationGroup: slug });
    if (!created.ok) throw new Error(created.message);
    const hero = await repo.addBlock(created.data.id, 'hero');
    const cta = await repo.addBlock(created.data.id, 'cta');
    if (!hero.ok || !cta.ok) throw new Error('fixture blocks');
    await repo.updateBlock(hero.data.id, {
      ...blocks.defaultDataFor('hero'),
      primaryCta: { label: '0473 95 26 33', href: PHONE_HREF, external: false },
      secondaryCta: null,
    });
    await repo.updateBlock(cta.data.id, OLD_CALLOUT);
    if (publish) await repo.publishPage(created.data.id);
    return { pageId: created.data.id, ctaId: cta.data.id };
  }
  await page('selftest-cta-faq', true);
  const edited = await page('selftest-cta-draft', true);
  await page('selftest-cta-hidden', false);
  await repo.updateBlock(edited.ctaId, { ...OLD_CALLOUT, title: 'Tekst van een redacteur' });
  cookieJar.delete('cms_session');
  await revokeSession(db, fixtureSession.token);

  const guardsBefore = await guardCounts(planDeps);
  async function fingerprint() {
    const tables = [schema.cmsSessions, schema.cmsAuditLog, schema.cmsPages, schema.cmsBlocks];
    const rows = await Promise.all(tables.map((table) => db.select().from(table)));
    return JSON.stringify(rows.map((list) => list.map((row) => JSON.stringify(row)).sort()));
  }

  // --- 2. dry run is read-only; apply refuses the unpublished draft ---------------
  const before = await fingerprint();
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
  await runBookingCtaPatch(
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
    'dry run: sessions, audit, pages, blocks unchanged; no cookie',
    (await fingerprint()) === before && !cookieJar.has('cms_session'),
  );
  check(
    'dry run: plans both live pages, skips the unpublished one, blocks on the draft',
    dryRunLog.some((line) => line.includes('page /selftest-cta-faq — retarget 1 link(s)')) &&
      dryRunLog.some((line) => line.includes('page /selftest-cta-hidden — skipped')) &&
      dryRunLog.some((line) => line.includes('/selftest-cta-draft: has unpublished draft')) &&
      dryRunLog.at(-1)?.includes('dry run: blocked') === true,
    dryRunLog.at(-1),
  );

  const applyLog: string[] = [];
  const run = (options: { apply: boolean; restore: string | null }) =>
    runBookingCtaPatch(
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
  const sessionsLeft = async () => (await db.select().from(schema.cmsSessions)).length;
  check(
    'apply: refuses an unpublished draft edit and writes no content',
    refused.includes('/selftest-cta-draft: has unpublished draft edits') &&
      (await fingerprint()) === before,
  );

  // --- 3. the editor publishes; apply retargets only the booking hrefs ------------
  const editorSession = await createSession(
    db,
    admin.id,
    { userAgent: 'selftest-booking-cta' },
    { mfaVerified: true },
  );
  cookieJar.set('cms_session', editorSession.token);
  await repo.publishPage(edited.pageId);
  cookieJar.delete('cms_session');
  await revokeSession(db, editorSession.token);

  const sessionsBefore = await sessionsLeft();
  applyLog.length = 0;
  await run({ apply: true, restore: null });
  const backupLine = applyLog.find((line) => line.includes('backup written: '));
  const backupPath = backupLine?.split('backup written: ')[1] ?? '';
  check(
    'apply: backup first, both pages published, session revoked, cookie restored',
    backupPath.endsWith('.json') &&
      backupPath.includes('booking-cta-patch-') &&
      applyLog.filter((line) => line.includes('→ /afspraak, published')).length === 2 &&
      (await sessionsLeft()) === sessionsBefore &&
      !cookieJar.has('cms_session'),
    applyLog.at(-1),
  );

  const liveFaq = await getPublishedPage(locale, 'selftest-cta-faq');
  const liveEdited = await getPublishedPage(locale, 'selftest-cta-draft');
  type Link = { label: string; href: string };
  const ctaOf = (live: typeof liveFaq) =>
    live?.snapshot.blocks.find((block) => block.type === 'cta')?.data as
      { title: string; primaryCta: Link } | undefined;
  const heroOf = (live: typeof liveFaq) =>
    live?.snapshot.blocks.find((block) => block.type === 'hero')?.data as
      { primaryCta: Link } | undefined;
  check(
    'live: "Boek je bikefit →" now goes to /afspraak, label and copy unchanged',
    ctaOf(liveFaq)?.primaryCta.href === '/afspraak' &&
      ctaOf(liveFaq)?.primaryCta.label === 'Boek je bikefit →' &&
      ctaOf(liveEdited)?.primaryCta.href === '/afspraak' &&
      ctaOf(liveEdited)?.title === 'Tekst van een redacteur',
  );
  check(
    'live: the visible phone-number link still dials',
    heroOf(liveFaq)?.primaryCta.href === PHONE_HREF &&
      heroOf(liveFaq)?.primaryCta.label === '0473 95 26 33',
  );
  const [hidden] = await db
    .select()
    .from(schema.cmsPages)
    .where(
      and(eq(schema.cmsPages.locale, locale), eq(schema.cmsPages.slug, 'selftest-cta-hidden')),
    );
  const hiddenBlocks = await db
    .select()
    .from(schema.cmsBlocks)
    .where(eq(schema.cmsBlocks.pageId, hidden.id));
  check(
    'unpublished page and booking tables untouched; apply is audited',
    hidden.status === 'draft' &&
      JSON.stringify(hiddenBlocks).includes(PHONE_HREF) &&
      JSON.stringify(await guardCounts(planDeps)) === JSON.stringify(guardsBefore) &&
      (
        await db
          .select()
          .from(schema.cmsAuditLog)
          .where(eq(schema.cmsAuditLog.action, 'patch.booking-cta.apply'))
      ).length === 1,
  );

  // --- 4. idempotent, and reversible -------------------------------------------
  applyLog.length = 0;
  await run({ apply: true, restore: null });
  check(
    'apply again: nothing to do, no second backup',
    applyLog.some((line) => line.includes('nothing changed')) &&
      !applyLog.some((line) => line.includes('backup written')),
  );
  await run({ apply: false, restore: backupPath });
  check(
    'restore: the old dialling button is back on the live page',
    ctaOf(await getPublishedPage(locale, 'selftest-cta-faq'))?.primaryCta.href === PHONE_HREF &&
      (await sessionsLeft()) === sessionsBefore,
  );
  cookieJar.clear();
}
