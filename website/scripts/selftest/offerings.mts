/**
 * Self-test section 14d (17 Oct 2026, the offering IS the offer): Beheer →
 * Aanbod on the throwaway PGlite of `cms-selftest.mts`, with real sessions in
 * the cookie jar and the real repo, readers and CLI path:
 *
 *  0. migrations 0010 + 0011: guarded statements only (no data change, no
 *     DROP), re-running them twice is a no-op;
 *  1. the bootstrap offerings (`ensureDefaultOfferings`): ten rows, seven
 *     shown, the current-bike fit booked directly as the section-14 services,
 *     a second run keeps them; the public catalogue and `?dienst=` follow;
 *  2. `cms:migrate-aanbod` on legacy offer pages (raw rows, as a database from
 *     before 17 Oct 2026 holds them): the dry run writes nothing; the apply
 *     converts a published page (derived settings), a draft page (hidden) and
 *     a page with saved settings (filled, price kept), moves the voucher page
 *     to /cadeaubon with a 301, puts the voucher card on /aanbod, deletes the
 *     offer pages, audits once; a second apply finds nothing;
 *  3. permissions: a provider and an editor are refused (`offering.manage` is
 *     the admin's), nothing written;
 *  4. the admin writes an offering with its services: created with the
 *     variant slugs and labels, unavailable until a provider subscribes their
 *     own profile, then bookable with that variant only; an edit updates the
 *     service by id; enquiry and hidden hold the services back (availability
 *     refused, page 404); delete deactivates the services;
 *  5. the enquiry form on the real store: an enquiry offering is found, a
 *     direct one refused, rate-limit keys hold no address, a repeat is not
 *     sent twice; the real wiring answers "niet verstuurd" without a mail key;
 *  6. the provider profile comes with the Aanbieder role
 *     (`ensureProviderProfile`): created once, kept, the own account only;
 *  7. clean-up, so later sections find the database as before.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as orm from 'drizzle-orm';
import type { CmsDatabase } from '@/db/cms';
import { formatPrice } from '@/lib/booking/format';
import { OFFER_CTA_LABEL } from '@/lib/offers/catalogue';
import { ensureDefaultOfferings } from '../lib/offerings-bootstrap.mjs';
import { runAanbodMigration } from '../lib/aanbod-migrate.mjs';

type Check = (label: string, condition: boolean, detail?: string) => void;

const { and, eq, inArray, like, sql } = orm;

export async function offeringsSection(ctx: {
  db: CmsDatabase;
  check: Check;
  section: (title: string) => void;
  signInAs: (userId: string) => Promise<void>;
  admin: { id: string };
  provider: { id: string; userId: string };
  cookieJar: Map<string, string>;
  backupDir: string;
}) {
  const { db, check, section, signInAs, admin, provider, cookieJar, backupDir } = ctx;
  section('14d. Beheer → Aanbod: the offering is the offer');

  const schema = {
    ...(await import('@/db/cms-schema')),
    ...(await import('@/db/cms-rate-limit-schema')),
  };
  const offeringSchema = await import('@/db/cms-offering-schema');
  const { cmsOfferings, cmsOfferingVariants } = offeringSchema;
  const { CmsAuthError } = await import('@/lib/cms/auth');
  const users = await import('@/lib/cms/users');
  const cmsRepo = await import('@/lib/cms/repo');
  const bookingRepo = await import('@/lib/booking/repo');
  const { ensureProviderProfile } = await import('@/lib/booking/repo-provider-profile');
  const offersRepo = await import('@/lib/offers/repo');
  const { loadOfferCatalogue, getPublishedOffer, isServiceBookableOnline } =
    await import('@/lib/cms/offers-content');
  const { getPublishedPage, findRedirect } = await import('@/lib/cms/content');
  const { listPublicServices } = await import('@/lib/booking/content');
  const { resolveBookingSelection } = await import('@/lib/offers/catalogue');
  const { availabilityAction } = await import('@/lib/booking/public-actions');
  const enquiry = await import('@/lib/offer-enquiry/service');
  const { deliverOfferEnquiry } = await import('@/lib/offer-enquiry/delivery');
  const { loadEmailSettings } = await import('@/lib/email/settings');
  const { defaultDataFor } = await import('@/lib/cms/blocks');
  const locale = schema.DEFAULT_LOCALE;

  const refused = async (run: () => Promise<unknown>) => {
    try {
      await run();
      return false;
    } catch (error) {
      return error instanceof CmsAuthError && error.code === 'forbidden';
    }
  };
  const offeringRows = async () => db.select().from(cmsOfferings);
  const card = async (slug: string) =>
    (await loadOfferCatalogue(locale)).offers.find((offer) => offer.slug === slug);
  const silentLog = () => {};
  const pageRow = async (slug: string) => {
    const [row] = await db
      .select()
      .from(schema.cmsPages)
      .where(and(eq(schema.cmsPages.locale, locale), eq(schema.cmsPages.slug, slug)));
    return row ?? null;
  };

  // --- 0: migrations 0010 + 0011 ---------------------------------------------
  const tables = (
    (await db.execute(
      sql`select table_name from information_schema.tables
          where table_name in ('cms_offerings', 'cms_offering_variants') order by table_name`,
    )) as unknown as { rows: Array<{ table_name: string }> }
  ).rows.map((row) => row.table_name);
  check(
    'migrations 0010 + 0011: cms_offerings (with the copy columns) + cms_offering_variants exist',
    tables.join(',') === 'cms_offering_variants,cms_offerings' &&
      (
        (await db.execute(
          sql`select column_name from information_schema.columns where table_name = 'cms_offerings' and column_name in ('slug', 'title', 'contents', 'image')`,
        )) as unknown as { rows: unknown[] }
      ).rows.length === 4,
    tables.join(','),
  );
  for (const file of ['0010_cms_offerings.sql', '0011_cms_offerings_content.sql']) {
    const migrationSql = await readFile(resolve(process.cwd(), 'drizzle', file), 'utf8');
    // Split on the breakpoints first: they start with `--` like the comments.
    const statements = migrationSql
      .split('--> statement-breakpoint')
      .map((statement) => statement.replace(/^--.*$/gm, '').trim())
      .filter(Boolean);
    const code = statements.join('\n');
    check(
      `migration ${file.slice(0, 4)}: every statement guarded; no INSERT/UPDATE/DELETE/DROP TABLE`,
      statements.every(
        (statement) =>
          /^CREATE (UNIQUE )?(TABLE|INDEX) IF NOT EXISTS/.test(statement) ||
          /^ALTER TABLE "cms_offerings" ADD COLUMN IF NOT EXISTS/.test(statement) ||
          /^ALTER TABLE "cms_offerings" ALTER COLUMN "page_id" DROP NOT NULL/.test(statement) ||
          /^DO \$\$ BEGIN\s+ALTER TABLE "cms_offering(s|_variants)" ADD CONSTRAINT[\s\S]*duplicate_object/.test(
            statement,
          ),
      ) && !/\b(INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM|DROP\s+TABLE|TRUNCATE)\b/i.test(code),
      `${statements.length} statements`,
    );
    let rerun = 'ok';
    try {
      for (let pass = 0; pass < 2; pass += 1) {
        for (const statement of statements) await db.execute(sql.raw(statement));
      }
    } catch (error) {
      rerun = error instanceof Error ? error.message : String(error);
    }
    check(`migration ${file.slice(0, 4)}: re-running it twice is a no-op`, rerun === 'ok', rerun);
  }

  // --- 1: the bootstrap offerings ---------------------------------------------
  const rowsBefore = new Set((await offeringRows()).map((row) => row.id));
  const ownBefore = (
    await db
      .select()
      .from(schema.cmsProviderServices)
      .where(eq(schema.cmsProviderServices.providerId, provider.id))
  ).map((row) => ({ serviceId: row.serviceId, locationId: row.locationId }));
  const bootstrapDeps = {
    db,
    orm,
    schema: { cmsServices: schema.cmsServices, DEFAULT_LOCALE: locale },
    offerings: offeringSchema,
    log: silentLog,
  };
  const first = await ensureDefaultOfferings(bootstrapDeps);
  const again = await ensureDefaultOfferings(bootstrapDeps);
  const seeded = await loadOfferCatalogue(locale);
  const huidige = await card('bikefit-huidige-fiets');
  const publicServices = (await listPublicServices(locale)).map((s) => ({
    id: s.id,
    slug: s.slug,
  }));
  const adultId = publicServices.find((s) => s.slug === 'volwassenenfit')?.id;
  const youthId = publicServices.find((s) => s.slug === 'jeugdfit')?.id;
  const homeId = publicServices.find((s) => s.slug === 'fit-aan-huis')?.id;
  check(
    'bootstrap: seven offerings created once (all shown, no hidden legacy ones), kept on a second run',
    first.created.length === 7 &&
      first.kept.length === 0 &&
      again.created.length === 0 &&
      again.kept.length === 7 &&
      seeded.offers.length === 7 &&
      seeded.hiddenSlugs.length === 0,
    `${first.created.length} created, ${seeded.offers.length} shown, hidden ${seeded.hiddenSlugs.join(',')}`,
  );
  check(
    'bootstrap: Bikefit – huidige fiets is bookable as Volwassenenfit + Jeugdfit; the rest on request',
    huidige?.status === 'bookable' &&
      huidige.bookingServiceSlugs.join() === 'volwassenenfit,jeugdfit' &&
      huidige.durationLabel === 'Volwassene: 1 u 30 min · Jeugd: 1 uur' &&
      huidige.priceLabel === 'Prijs op aanvraag' &&
      seeded.offers.filter((offer) => offer.status === 'enquiry').length === 6,
    JSON.stringify(huidige),
  );
  const withheld = new Set(seeded.withheldServiceIds);
  check(
    'bootstrap: nothing is held back yet; the fits and the (not yet retired) Fit aan huis are bookable',
    homeId !== undefined &&
      withheld.size === 0 &&
      (await isServiceBookableOnline(homeId, locale)) &&
      (await isServiceBookableOnline(adultId ?? '', locale)),
  );
  const offered = publicServices.filter((service) => !withheld.has(service.id));
  const linked = resolveBookingSelection({
    requested: 'bikefit-huidige-fiets',
    offers: seeded.offers,
    services: offered,
  });
  const asked = resolveBookingSelection({
    requested: 'lactaattest',
    offers: seeded.offers,
    services: offered,
  });
  const hiddenOne = resolveBookingSelection({
    requested: 'fit-aan-huis',
    offers: seeded.offers,
    services: offered,
  });
  check(
    '?dienst=: the current-bike fit narrows to Volwassene + Jeugd; Lactaattest is an enquiry; a service on its own stays a service',
    linked.kind === 'offer' &&
      linked.serviceIds.join() === [adultId, youthId].join() &&
      asked.kind === 'offer' &&
      asked.serviceIds.length === 0 &&
      asked.offer.status === 'enquiry' &&
      hiddenOne.kind === 'service',
    JSON.stringify({ linked, asked, hiddenOne }),
  );

  // --- 2: cms:migrate-aanbod on legacy offer pages ---------------------------------
  await signInAs(admin.id);
  const legacyBlock = (title: string, slugs: string[], extra: Record<string, unknown> = {}) => ({
    category: 'bikefit',
    sortOrder: 70,
    eyebrow: 'Aanbod · Bikefit',
    title,
    summary: `${title}: korte omschrijving.`,
    intro: `${title}: inleiding.`,
    ctaLabel: OFFER_CTA_LABEL,
    goal: 'Doel van de test.',
    contents: ['Punt één.', 'Punt twee.'],
    duration: 'Ongeveer twee uur',
    priceCents: null,
    priceLabel: 'Prijs op aanvraag',
    extras: ['Een extra.'],
    extrasNote: 'Altijd vooraf afgesproken.',
    bookingServiceSlugs: slugs,
    image: {
      mediaId: null,
      url: '/images/editorial/bikefit-studio-v1.webp',
      alt: 'Studio',
      decorative: false,
    },
    ...extra,
  });
  /** A page as a database from before 17 Oct 2026 holds it (the `offer` block type no longer exists). */
  async function rawOfferPage(
    slug: string,
    status: 'draft' | 'published',
    data: Record<string, unknown>,
  ) {
    const [page] = await db
      .insert(schema.cmsPages)
      .values({
        locale,
        slug,
        translationGroup: slug,
        title: String(data.title),
        status,
        metaDescription: `Meta van ${data.title}`,
        publishedAt: status === 'published' ? new Date() : null,
        publishedSnapshot:
          status === 'published'
            ? {
                title: String(data.title),
                kind: 'default',
                publishedAt: new Date().toISOString(),
                seo: { metaTitle: null, metaDescription: `Meta van ${data.title}`, noIndex: false },
                blocks: [{ id: 'legacy-offer', type: 'offer', data }],
              }
            : null,
      })
      .returning({ id: schema.cmsPages.id });
    await db
      .insert(schema.cmsBlocks)
      .values({ pageId: page.id, sortOrder: 0, type: 'offer', data });
    return page.id;
  }
  const legacyId = await rawOfferPage(
    'aanbod/selftest-legacy',
    'published',
    legacyBlock('Selftest legacy', ['volwassenenfit', 'jeugdfit']),
  );
  const draftId = await rawOfferPage(
    'aanbod/selftest-concept',
    'draft',
    legacyBlock('Selftest concept', []),
  );
  const storedPageId = await rawOfferPage(
    'aanbod/selftest-stored',
    'published',
    legacyBlock('Selftest stored', []),
  );
  const [storedRow] = await db
    .insert(cmsOfferings)
    .values({
      locale,
      pageId: storedPageId,
      isListed: true,
      bookingMode: 'enquiry',
      variantMode: 'single',
    })
    .returning({ id: cmsOfferings.id });
  await db
    .insert(cmsOfferingVariants)
    .values({ offeringId: storedRow.id, audience: 'all', serviceId: null, priceCents: 9900 });
  // /aanbod (catalogue without the voucher card) and the old voucher page, through the repo.
  async function publishPage(
    slug: string,
    title: string,
    pageBlocks: { type: string; data: unknown }[],
  ) {
    const created = await cmsRepo.createPage({
      locale,
      slug,
      title,
      translationGroup: `selftest-${slug}`,
    });
    if (!created.ok) throw new Error(created.message);
    for (const block of pageBlocks) {
      const added = await cmsRepo.addBlock(
        created.data.id,
        block.type as Parameters<typeof cmsRepo.addBlock>[1],
      );
      if (!added.ok) throw new Error(added.message);
      const written = await cmsRepo.updateBlock(added.data.id, block.data);
      if (!written.ok) throw new Error(`${slug} ${block.type}: ${written.message}`);
    }
    const published = await cmsRepo.publishPage(created.data.id);
    if (!published.ok) throw new Error(published.message);
    return created.data.id;
  }
  const aanbodId = await publishPage('aanbod', 'Aanbod', [
    { type: 'hero', data: { ...defaultDataFor('hero'), variant: 'pageHead', title: 'Ons aanbod' } },
    { type: 'offerCatalogue', data: { ...defaultDataFor('offerCatalogue'), extraCards: [] } },
  ]);
  const voucherId = await publishPage('aanbod/cadeaubon', 'Cadeaubon', [
    { type: 'giftVoucher', data: defaultDataFor('giftVoucher') },
  ]);
  check(
    'migration fixture: three legacy offer pages, /aanbod and /aanbod/cadeaubon',
    Boolean(legacyId && draftId && aanbodId && voucherId),
  );

  const lines: string[] = [];
  const context = {
    db,
    driver: 'pglite',
    cookieJar,
    log: (symbol: string, message: string) => lines.push(`${symbol} ${message}`),
  };
  const writeCalls: string[] = [];
  const watchedDb = new Proxy(db, {
    get(target, property, receiver) {
      const writes = ['insert', 'update', 'delete', 'execute', 'transaction', 'batch'];
      if (typeof property === 'string' && writes.includes(property)) writeCalls.push(property);
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const auditBefore = (await db.select().from(schema.cmsAuditLog)).length;
  const previousCookie = cookieJar.get('cms_session');
  await runAanbodMigration({ apply: false, backupDir }, { ...context, db: watchedDb });
  check(
    'cms:migrate-aanbod dry run: plans the pages, the voucher move and the card; writes nothing',
    writeCalls.length === 0 &&
      lines.some((line) => line.startsWith('+ page /aanbod/selftest-legacy')) &&
      lines.some(
        (line) =>
          line.startsWith('+ page /aanbod/selftest-stored') && line.includes('fill the saved'),
      ) &&
      lines.some((line) => line.startsWith('~ page /aanbod/cadeaubon — move')) &&
      lines.some((line) => line.startsWith('~ page /aanbod — add the voucher card')) &&
      lines.some((line) => line.startsWith('- service fit-aan-huis (Fit aan huis) — retired')) &&
      lines.at(-1)?.includes('run again with --apply') === true &&
      (await db.select().from(schema.cmsAuditLog)).length === auditBefore &&
      cookieJar.get('cms_session') === previousCookie,
    writeCalls.join() || lines.filter((line) => /^[~!+-]/.test(line)).join(' | '),
  );
  lines.length = 0;
  const guardsBefore = JSON.stringify(
    await db.select({ id: schema.cmsBookings.id }).from(schema.cmsBookings),
  );
  const applied = await runAanbodMigration({ apply: true, backupDir }, context);
  const catalogueAfter = await loadOfferCatalogue(locale);
  const migrated = catalogueAfter.bySlug['selftest-legacy'];
  const stored = catalogueAfter.bySlug['selftest-stored'];
  const concept = catalogueAfter.bySlug['selftest-concept'];
  check(
    'apply: the published page became a shown, directly bookable offering with its text; the pages are gone',
    applied.changed &&
      applied.backupPath !== null &&
      migrated?.offering.status === 'bookable' &&
      migrated.offering.variantMode === 'audience' &&
      migrated.content.title === 'Selftest legacy' &&
      migrated.content.contents.join('|') === 'Punt één.|Punt twee.' &&
      migrated.content.metaDescription === 'Meta van Selftest legacy' &&
      migrated.content.image.url === '/images/editorial/bikefit-studio-v1.webp' &&
      migrated.content.ctaLabel === '' &&
      (await pageRow('aanbod/selftest-legacy')) === null &&
      (await pageRow('aanbod/selftest-concept')) === null,
    JSON.stringify({ changed: applied.changed, migrated: migrated?.offer, lines: lines.slice(-3) }),
  );
  check(
    'apply: the saved settings kept their price and got the text; the draft page is a hidden offering',
    stored?.offering.bookingMode === 'enquiry' &&
      stored.offer.priceLabel === formatPrice(9900) &&
      stored.content.title === 'Selftest stored' &&
      concept?.offering.isListed === false &&
      catalogueAfter.hiddenSlugs.includes('selftest-concept'),
    JSON.stringify({ stored: stored?.offer, concept: concept?.offering }),
  );
  const [homeAfter] = await db
    .select({ isActive: schema.cmsServices.isActive })
    .from(schema.cmsServices)
    .where(eq(schema.cmsServices.id, homeId ?? ''));
  const retiredAudit = await db
    .select()
    .from(schema.cmsAuditLog)
    .where(
      and(
        eq(schema.cmsAuditLog.action, 'service.delete'),
        eq(schema.cmsAuditLog.entityId, homeId ?? ''),
      ),
    );
  check(
    'apply: the retired Fit aan huis is deactivated (audited service.delete), out of /afspraak, no hidden offering for it',
    homeAfter?.isActive === false &&
      retiredAudit.length === 1 &&
      !(await listPublicServices(locale)).some((service) => service.slug === 'fit-aan-huis') &&
      catalogueAfter.bySlug['fit-aan-huis'] === undefined,
    JSON.stringify({ active: homeAfter?.isActive, audits: retiredAudit.length }),
  );
  const voucherNew = await getPublishedPage(locale, 'cadeaubon');
  const redirect = await findRedirect('/aanbod/cadeaubon');
  const aanbodLive = await getPublishedPage(locale, 'aanbod');
  const cards = (
    aanbodLive?.snapshot.blocks.find((block) => block.type === 'offerCatalogue')?.data as
      { extraCards?: { href: string }[] } | undefined
  )?.extraCards;
  check(
    'apply: /aanbod/cadeaubon moved to /cadeaubon with a 301; /aanbod shows the voucher card; audited once',
    voucherNew !== null &&
      (await pageRow('aanbod/cadeaubon')) === null &&
      redirect?.toPath === '/cadeaubon' &&
      redirect.statusCode === 301 &&
      cards?.length === 1 &&
      cards[0].href === '/cadeaubon' &&
      (
        await db
          .select()
          .from(schema.cmsAuditLog)
          .where(eq(schema.cmsAuditLog.action, 'migrate.aanbod.apply'))
      ).length === 1 &&
      JSON.stringify(await db.select({ id: schema.cmsBookings.id }).from(schema.cmsBookings)) ===
        guardsBefore,
    lines.filter((line) => /^[~!+-✓]/.test(line)).join(' | '),
  );
  lines.length = 0;
  const second = await runAanbodMigration({ apply: true, backupDir }, context);
  check(
    'cms:migrate-aanbod: a second apply finds nothing to do',
    !second.changed && lines.some((line) => line.includes('nothing to do')),
  );
  lines.length = 0;
  writeCalls.length = 0;
  const verifyAuditBefore = (await db.select().from(schema.cmsAuditLog)).length;
  const verified = await runAanbodMigration(
    { apply: false, verify: true, backupDir },
    { ...context, db: watchedDb },
  );
  check(
    'cms:migrate-aanbod --verify: re-checks every stored offering, writes nothing, no audit entry',
    verified.problems.length === 0 &&
      !verified.changed &&
      writeCalls.length === 0 &&
      lines.some((line) => line.startsWith('✓ verified:')) &&
      (await db.select().from(schema.cmsAuditLog)).length === verifyAuditBefore,
    writeCalls.join() || lines.join(' | '),
  );

  // --- 3: permissions --------------------------------------------------------
  const newOffering = (overrides: Record<string, unknown> = {}) => ({
    content: {
      slug: 'selftest-nieuw',
      category: 'begeleiding',
      sortOrder: 80,
      title: 'Selftest nieuw',
      summary: 'Een nieuw aanbod uit de selftest.',
      contents: ['Eerste stap.'],
      metaDescription: 'Selftest nieuw.',
    },
    settings: {
      isListed: true,
      bookingMode: 'direct',
      variantMode: 'audience',
      variants: [
        {
          audience: 'adult',
          serviceId: null,
          priceCents: 14950,
          service: {
            durationMinutes: 75,
            bufferAfterMinutes: null,
            locationId: null,
            requiresGuardian: false,
          },
        },
        {
          audience: 'youth',
          serviceId: null,
          priceCents: null,
          service: {
            durationMinutes: 45,
            bufferAfterMinutes: 10,
            locationId: null,
            requiresGuardian: true,
          },
        },
      ],
    },
    ...overrides,
  });
  await signInAs(provider.userId);
  const snapshot = JSON.stringify(await offeringRows());
  const [editor] = await db
    .insert(schema.cmsUsers)
    .values({
      email: 'aanbod-redacteur@selftest.local',
      name: 'Aanbod redacteur',
      role: 'editor',
      passwordHash: 'no-login',
      mustChangePassword: false,
    })
    .returning({ id: schema.cmsUsers.id });
  const providerRefused =
    (await refused(() => offersRepo.createOffering(newOffering()))) &&
    (await refused(() => offersRepo.listOfferingsForAdmin()));
  await signInAs(editor.id);
  const editorRefused =
    (await refused(() => offersRepo.createOffering(newOffering()))) &&
    (await refused(() => offersRepo.listOfferingsForAdmin()));
  check(
    'provider and editor: createOffering and listOfferingsForAdmin are refused, nothing written',
    providerRefused && editorRefused && JSON.stringify(await offeringRows()) === snapshot,
  );
  await signInAs(provider.userId);
  const groups = await offersRepo.listOfferingSubscriptionGroups();
  check(
    'provider: sees the offerings with their variants to subscribe to (service.read)',
    groups.some(
      (group) =>
        group.title === 'Bikefit – huidige fiets' &&
        group.bookable &&
        group.variants.map((v) => v.label).join('/') === 'Volwassene/Jeugd',
    ),
    JSON.stringify(groups.map((group) => group.title)),
  );

  // --- 4: the admin writes an offering with its services ------------------------
  await signInAs(admin.id);
  const created = await offersRepo.createOffering(newOffering());
  const createdServices = created.ok
    ? await db
        .select()
        .from(schema.cmsServices)
        .where(like(schema.cmsServices.slug, 'selftest-nieuw%'))
        .orderBy(orm.asc(schema.cmsServices.slug))
    : [];
  const adultService = createdServices.find((s) => s.slug === 'selftest-nieuw-volwassene');
  const youthService = createdServices.find((s) => s.slug === 'selftest-nieuw-jeugd');
  check(
    'admin: createOffering writes the two services (slug, label, name, duration, guardian) and the variants',
    created.ok &&
      adultService?.choiceLabel === 'Volwassene' &&
      adultService.name === 'Selftest nieuw – Volwassene' &&
      adultService.durationMinutes === 75 &&
      adultService.isActive &&
      youthService?.requiresGuardian === true &&
      youthService.durationMinutes === 45 &&
      youthService.bufferAfterMinutes === 10 &&
      (await card('selftest-nieuw'))?.status === 'unavailable',
    created.ok ? createdServices.map((s) => s.slug).join() : created.message,
  );
  if (!created.ok || !adultService || !youthService) return;
  const offeringId = created.data.id;
  const admin1 = await offersRepo.getOfferingForAdmin(offeringId);
  check(
    'admin: the overview resolves the offering with its variants and no provider yet',
    admin1?.offering.resolved.status === 'unavailable' &&
      admin1.offering.settings.variants.map((v) => v.serviceId).join() ===
        [adultService.id, youthService.id].join() &&
      admin1.services.find((s) => s.id === adultService.id)?.providerCount === 0,
  );

  await signInAs(provider.userId);
  const subscribe = await bookingRepo.setProviderServices(provider.id, [
    ...ownBefore,
    { serviceId: adultService.id, locationId: null },
  ]);
  const bookable = await card('selftest-nieuw');
  check(
    'provider subscribes their own profile to Volwassene → bookable with that variant only, priced',
    subscribe.ok &&
      bookable?.status === 'bookable' &&
      bookable.bookingServiceSlugs.join(',') === 'selftest-nieuw-volwassene' &&
      bookable.priceLabel === `Volwassene ${formatPrice(14950)} · Jeugd op aanvraag` &&
      bookable.durationLabel === 'Volwassene: 1 u 15 min · Jeugd: 45 min',
    JSON.stringify(bookable),
  );

  await signInAs(admin.id);
  const edited = await offersRepo.updateOffering(
    offeringId,
    newOffering({
      settings: {
        ...newOffering().settings,
        variants: [
          {
            audience: 'adult',
            serviceId: adultService.id,
            priceCents: 15000,
            service: {
              durationMinutes: 90,
              bufferAfterMinutes: 15,
              locationId: null,
              requiresGuardian: false,
            },
          },
          {
            audience: 'youth',
            serviceId: youthService.id,
            priceCents: null,
            service: {
              durationMinutes: 45,
              bufferAfterMinutes: 10,
              locationId: null,
              requiresGuardian: true,
            },
          },
        ],
      },
    }),
  );
  const [adultAfter] = await db
    .select()
    .from(schema.cmsServices)
    .where(eq(schema.cmsServices.id, adultService.id));
  check(
    'admin: an edit updates the service by id (duration, buffer), the subscription survives',
    edited.ok &&
      adultAfter.durationMinutes === 90 &&
      adultAfter.bufferAfterMinutes === 15 &&
      (await card('selftest-nieuw'))?.durationLabel === 'Volwassene: 1 u 30 min · Jeugd: 45 min' &&
      (await card('selftest-nieuw'))?.status === 'bookable' &&
      (
        await db
          .select()
          .from(schema.cmsServices)
          .where(like(schema.cmsServices.slug, 'selftest-nieuw%'))
      ).length === 2,
    edited.ok ? '' : edited.message,
  );
  const clash = await offersRepo.createOffering(
    newOffering({ content: { ...newOffering().content, title: 'Dubbel' } }),
  );
  check(
    'admin: a second offering with the same slug is refused',
    !clash.ok && clash.message.includes('slug'),
  );

  await offersRepo.updateOffering(
    offeringId,
    newOffering({
      settings: {
        ...newOffering().settings,
        bookingMode: 'enquiry',
        variants: newOffering().settings.variants.map((v, i) => ({
          ...v,
          serviceId: i === 0 ? adultService.id : youthService.id,
        })),
      },
    }),
  );
  const window = { fromYmd: '2026-11-02', toYmd: '2026-11-08' };
  const heldBack = await availabilityAction({
    serviceId: adultService.id,
    providerId: null,
    ...window,
  });
  check(
    'switched to enquiry: card "enquiry", the gate and availabilityAction refuse its service',
    (await card('selftest-nieuw'))?.status === 'enquiry' &&
      !(await isServiceBookableOnline(adultService.id, locale)) &&
      !heldBack.ok &&
      heldBack.message === 'Deze dienst kun je niet online boeken.',
    JSON.stringify(heldBack),
  );
  await offersRepo.updateOffering(
    offeringId,
    newOffering({
      settings: {
        ...newOffering().settings,
        isListed: false,
        variants: newOffering().settings.variants.map((v, i) => ({
          ...v,
          serviceId: i === 0 ? adultService.id : youthService.id,
        })),
      },
    }),
  );
  check(
    'hidden: left out of the overviews, its page 404s, its services held back',
    (await card('selftest-nieuw')) === undefined &&
      (await getPublishedOffer(locale, 'selftest-nieuw')) === null &&
      !(await isServiceBookableOnline(youthService.id, locale)),
  );
  await offersRepo.updateOffering(
    offeringId,
    newOffering({
      settings: {
        ...newOffering().settings,
        variants: newOffering().settings.variants.map((v, i) => ({
          ...v,
          serviceId: i === 0 ? adultService.id : youthService.id,
        })),
      },
    }),
  );
  check(
    'shown and direct again: bookable, the page is served, the gate allows the service',
    (await card('selftest-nieuw'))?.status === 'bookable' &&
      (await getPublishedOffer(locale, 'selftest-nieuw'))?.content.title === 'Selftest nieuw' &&
      (await isServiceBookableOnline(adultService.id, locale)),
  );

  // --- 5: the enquiry form on the real store (no outbound mail) ---------------
  const sent: Array<{ to: string; subject: string; replyTo: string }> = [];
  const deps = {
    store: enquiry.offerEnquiryStore(db),
    findOffer: (slug: string) => enquiry.findEnquiryOffer(slug, locale),
    send: async (mail: { to: string; subject: string; replyTo: string }) => {
      sent.push(mail);
      return { sent: true as const, id: 'selftest' };
    },
    recipient: 'orders@selftest.local',
    siteName: 'Selftest',
    ipAddress: '198.51.100.23',
    log: silentLog,
  };
  const form = {
    offerSlug: 'lactaattest',
    name: 'Aanvrager Test',
    email: 'aanvrager@selftest.local',
    message: 'Kan ik dit in november doen?',
    requestId: '7c0c6f0e-3f8e-4c1b-9c86-0a3e2b5d9f11',
  };
  const firstSend = await deliverOfferEnquiry(form, deps);
  const repeat = await deliverOfferEnquiry(form, deps);
  const direct = await deliverOfferEnquiry({ ...form, offerSlug: 'bikefit-huidige-fiets' }, deps);
  const keys = (
    await db
      .select({ scope: schema.cmsRateLimits.scope })
      .from(schema.cmsRateLimits)
      .where(like(schema.cmsRateLimits.scope, 'aanvraag%'))
  ).map((row) => row.scope);
  check(
    'enquiry: sent once to the inbox (Reply-To the visitor); a repeat is not sent again; a direct offering refuses',
    firstSend.ok &&
      repeat.ok &&
      repeat.duplicate &&
      sent.length === 1 &&
      sent[0].to === 'orders@selftest.local' &&
      sent[0].replyTo === form.email &&
      sent[0].subject.startsWith('Aanvraag: Lactaattest') &&
      !direct.ok &&
      direct.code === 'unavailable',
    JSON.stringify({ firstSend, repeat, direct, sent: sent.length }),
  );
  check(
    'enquiry: rate-limit keys (IP, hashed e-mail, sent marker) hold no address',
    keys.includes('aanvraag:ip:198.51.100.23') &&
      keys.some((key) => /^aanvraag:email:[0-9a-f]{64}$/.test(key)) &&
      keys.includes(`aanvraag-sent:${form.requestId}`) &&
      !keys.some((key) => key.includes('selftest.local')),
    keys.join(','),
  );
  const email = await loadEmailSettings(db);
  if (!email.apiKey) {
    const real = await enquiry.requestOfferEnquiry(
      {
        ...form,
        requestId: '9d1e7a2b-4c3d-4e5f-8a9b-0c1d2e3f4a5b',
        email: 'tweede@selftest.local',
      },
      { ipAddress: '198.51.100.24' },
    );
    check(
      'enquiry (real wiring, no mail key): "niet verstuurd", nothing sent',
      !real.ok && real.code === 'not_sent',
      JSON.stringify(real),
    );
  } else {
    check(
      'enquiry: real wiring skipped (a mail key is configured; never send from the self-test)',
      true,
    );
  }

  // --- 6: the provider profile comes with the Aanbieder role -------------------
  await signInAs(admin.id);
  const roleUser = await users.createUser({
    email: 'rol-aanbieder@selftest.local',
    name: 'Rol Aanbieder',
    role: 'provider',
  });
  const profile1 = roleUser.ok ? await ensureProviderProfile(roleUser.data.user.id) : null;
  const profile2 = roleUser.ok ? await ensureProviderProfile(roleUser.data.user.id) : null;
  check(
    'ensureProviderProfile: an admin creates the profile of a new Aanbieder once; a second call keeps it',
    roleUser.ok &&
      profile1?.ok === true &&
      profile1.data.created &&
      profile2?.ok === true &&
      !profile2.data.created &&
      profile2.data.providerId === profile1.data.providerId,
    roleUser.ok ? JSON.stringify([profile1, profile2]) : roleUser.message,
  );
  if (roleUser.ok) {
    // Test-only shortcut: a new account replaces its temporary password at the
    // first sign-in (section 5b); here the guard would refuse it otherwise.
    await db
      .update(schema.cmsUsers)
      .set({ mustChangePassword: false })
      .where(eq(schema.cmsUsers.id, roleUser.data.user.id));
    await signInAs(roleUser.data.user.id);
    const own = await ensureProviderProfile(roleUser.data.user.id);
    check(
      'ensureProviderProfile: the Aanbieder may complete their own account, never another one',
      own.ok && !own.data.created && (await refused(() => ensureProviderProfile(admin.id))),
    );
  }

  // --- 7: clean-up ------------------------------------------------------------
  await signInAs(admin.id);
  const removed = await offersRepo.deleteOffering(offeringId);
  const leftActive = await db
    .select({ id: schema.cmsServices.id })
    .from(schema.cmsServices)
    .where(
      and(like(schema.cmsServices.slug, 'selftest-nieuw%'), eq(schema.cmsServices.isActive, true)),
    );
  check(
    'admin: deleteOffering removes the offering and deactivates its services',
    removed.ok && leftActive.length === 0,
  );
  await db
    .delete(cmsOfferings)
    .where(rowsBefore.size ? orm.notInArray(cmsOfferings.id, [...rowsBefore]) : sql`true`);
  for (const slug of ['aanbod', 'cadeaubon']) {
    const row = await pageRow(slug);
    if (row) {
      await cmsRepo.unpublishPage(row.id);
      await cmsRepo.deletePage(row.id);
    }
  }
  await db.delete(schema.cmsRedirects).where(eq(schema.cmsRedirects.fromPath, '/aanbod/cadeaubon'));
  await signInAs(provider.userId);
  await bookingRepo.setProviderServices(provider.id, ownBefore);
  await signInAs(admin.id);
  await db
    .delete(schema.cmsProviderServices)
    .where(inArray(schema.cmsProviderServices.serviceId, [adultService.id, youthService.id]));
  await db
    .delete(schema.cmsServices)
    .where(inArray(schema.cmsServices.id, [adultService.id, youthService.id]));
  await db.delete(schema.cmsSessions).where(eq(schema.cmsSessions.userId, editor.id));
  await db.delete(schema.cmsUsers).where(eq(schema.cmsUsers.id, editor.id));
  if (roleUser.ok) {
    await db.delete(schema.cmsSessions).where(eq(schema.cmsSessions.userId, roleUser.data.user.id));
    await db.delete(schema.cmsUsers).where(eq(schema.cmsUsers.id, roleUser.data.user.id));
  }
  await db.delete(schema.cmsRateLimits).where(like(schema.cmsRateLimits.scope, 'aanvraag%'));
  const ownAfter = await db
    .select()
    .from(schema.cmsProviderServices)
    .where(eq(schema.cmsProviderServices.providerId, provider.id));
  check(
    'clean-up: offerings, pages, redirect, services and users removed; subscriptions as before',
    (await offeringRows()).length === rowsBefore.size &&
      (await pageRow('aanbod')) === null &&
      (await pageRow('cadeaubon')) === null &&
      ownAfter.length === ownBefore.length &&
      ownAfter.every((row) => ownBefore.some((entry) => entry.serviceId === row.serviceId)),
  );
}
