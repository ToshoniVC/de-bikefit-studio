/**
 * Self-test section 14d (work block 2026-10-16, Beheer → Aanbod): offering
 * settings on the throwaway PGlite of `cms-selftest.mts`, with real sessions in
 * the cookie jar and the real repo, readers and server actions:
 *
 *  0. migration 0010: the two tables, guarded statements only (no data change,
 *     no DROP), re-running it twice is a no-op;
 *  1. set-up as admin: two services (Volwassene 90 min, Jeugd 60 min with a
 *     guardian) and two published offer pages: one linked to both services
 *     (the legacy `bookingServiceSlugs`), one without (asked for);
 *  2. before anything is saved the pages derive their settings; the
 *     `cms:migrate-offerings` dry run writes nothing, the apply writes exactly
 *     those settings (bookings, services and subscriptions unchanged), a second
 *     apply finds nothing to do, and the public catalogue is the same before
 *     and after;
 *  3. permissions: a provider is refused (`offering.manage`), an editor and
 *     the admin may save; nothing is written on a refusal;
 *  4. provider self-service and booking eligibility: with nobody offering it
 *     the direct offering is "unavailable" and nothing is bookable through it;
 *     the provider subscribes their own profile to Volwassene → bookable with
 *     that variant only; the gate of the booking actions agrees; enquiry and
 *     hidden hold the services back (availability refused, page 404);
 *  5. the enquiry form on the real store: an enquiry offering is found, a
 *     direct one refused, rate-limit keys hold no address, a repeat is not
 *     sent twice; the real wiring answers "niet verstuurd" without a mail key
 *     and sends nothing (no outbound mail in the self-test);
 *  6. clean-up: offering rows, pages, services and the editor are removed and
 *     the provider's subscriptions are restored, so later sections are as before.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { and, eq, inArray, like, notInArray, sql } from 'drizzle-orm';
import type { CmsDatabase } from '@/db/cms';

type Check = (label: string, condition: boolean, detail?: string) => void;

const ADULT_SLUG = 'selftest-aanbod-volwassene';
const YOUTH_SLUG = 'selftest-aanbod-jeugd';
const DIRECT_PAGE = 'aanbod/selftest-direct';
const ENQUIRY_PAGE = 'aanbod/selftest-aanvraag';
const EDITOR_EMAIL = 'aanbod-redacteur@selftest.local';

export async function offeringsSection(ctx: {
  db: CmsDatabase;
  check: Check;
  section: (title: string) => void;
  signInAs: (userId: string) => Promise<void>;
  admin: { id: string };
  provider: { id: string; userId: string };
  cookieJar: Map<string, string>;
}) {
  const { db, check, section, signInAs, admin, provider, cookieJar } = ctx;
  section('14d. Beheer → Aanbod: offering settings, provider self-service, enquiry');

  const schema = {
    ...(await import('@/db/cms-schema')),
    ...(await import('@/db/cms-rate-limit-schema')),
  };
  const { cmsOfferings, cmsOfferingVariants } = await import('@/db/cms-offering-schema');
  const { CmsAuthError } = await import('@/lib/cms/auth');
  const cmsRepo = await import('@/lib/cms/repo');
  const bookingRepo = await import('@/lib/booking/repo');
  const offersRepo = await import('@/lib/offers/repo');
  const { loadOfferCatalogue, isServiceBookableOnline } = await import('@/lib/cms/offers-content');
  const { getStudioPage } = await import('@/lib/studio/site');
  const { availabilityAction } = await import('@/lib/booking/public-actions');
  const { runOfferingMigration } = await import('../lib/offerings-migrate.mjs');
  const enquiry = await import('@/lib/offer-enquiry/service');
  const { deliverOfferEnquiry } = await import('@/lib/offer-enquiry/delivery');
  const { loadEmailSettings } = await import('@/lib/email/settings');

  const refused = async (run: () => Promise<unknown>) => {
    try {
      await run();
      return false;
    } catch (error) {
      return error instanceof CmsAuthError && error.code === 'forbidden';
    }
  };
  const offeringRows = async () => db.select().from(cmsOfferings);
  const silentLog = () => {};

  // --- 0: migration 0010 ------------------------------------------------------
  const tables = (
    (await db.execute(
      sql`select table_name from information_schema.tables
          where table_name in ('cms_offerings', 'cms_offering_variants') order by table_name`,
    )) as unknown as { rows: Array<{ table_name: string }> }
  ).rows.map((row) => row.table_name);
  check(
    'migration 0010: cms_offerings + cms_offering_variants exist',
    tables.join(',') === 'cms_offering_variants,cms_offerings',
    tables.join(','),
  );
  const migrationSql = await readFile(
    resolve(process.cwd(), 'drizzle/0010_cms_offerings.sql'),
    'utf8',
  );
  // Split on the breakpoints first: they start with `--` like the comments.
  const statements = migrationSql
    .split('--> statement-breakpoint')
    .map((statement) => statement.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
  const code = statements.join('\n');
  check(
    'migration 0010: every statement guarded; no INSERT/UPDATE/DELETE/DROP/ALTER of an existing table',
    statements.length === 8 &&
      statements.every(
        (statement) =>
          /^CREATE (UNIQUE )?(TABLE|INDEX) IF NOT EXISTS/.test(statement) ||
          /^DO \$\$ BEGIN\s+ALTER TABLE "cms_offering(s|_variants)" ADD CONSTRAINT[\s\S]*duplicate_object/.test(
            statement,
          ),
      ) &&
      // FK clauses say ON DELETE / ON UPDATE; a data change or a drop would not.
      !/\b(INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM|DROP|TRUNCATE)\b/i.test(code),
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
  check('migration 0010: re-running it twice is a no-op', rerun === 'ok', rerun);

  // --- 1: set-up as admin -----------------------------------------------------
  await signInAs(admin.id);
  const ownBefore = (
    await db
      .select()
      .from(schema.cmsProviderServices)
      .where(eq(schema.cmsProviderServices.providerId, provider.id))
  ).map((row) => ({ serviceId: row.serviceId, locationId: row.locationId }));
  const rowsBefore = new Set((await offeringRows()).map((row) => row.pageId));

  const adult = await bookingRepo.createService({
    name: 'Aanbod volwassene (test)',
    slug: ADULT_SLUG,
    durationMinutes: 90,
  });
  const youth = await bookingRepo.createService({
    name: 'Aanbod jeugd (test)',
    slug: YOUTH_SLUG,
    durationMinutes: 60,
    requiresGuardian: true,
  });
  if (!adult.ok || !youth.ok) {
    check('offerings: set-up services created', false);
    return;
  }
  const publishOffer = async (slug: string, title: string, bookingServiceSlugs: string[]) => {
    const page = await cmsRepo.createPage({ slug, title });
    if (!page.ok) throw new Error(page.message);
    const block = await cmsRepo.addBlock(page.data.id, 'offer');
    if (!block.ok) throw new Error(block.message);
    const updated = await cmsRepo.updateBlock(block.data.id, {
      ...(block.data.data as object),
      title,
      bookingServiceSlugs,
      duration: 'Ongeveer twee uur',
    });
    if (!updated.ok) throw new Error(updated.message);
    const published = await cmsRepo.publishPage(page.data.id);
    if (!published.ok) throw new Error(published.message);
    return page.data.id;
  };
  const directPageId = await publishOffer(DIRECT_PAGE, 'Selftest direct', [ADULT_SLUG, YOUTH_SLUG]);
  const enquiryPageId = await publishOffer(ENQUIRY_PAGE, 'Selftest aanvraag', []);
  check('offerings: two published offer pages created', Boolean(directPageId && enquiryPageId));

  const card = async (slug: string) =>
    (await loadOfferCatalogue('nl')).offers.find((offer) => offer.slug === slug);

  // --- 2: legacy derivation and the migration ----------------------------------
  const legacyDirect = await card('selftest-direct');
  check(
    'legacy: the linked page derives Volwassene/Jeugd booked directly; nobody offers it → unavailable',
    legacyDirect?.status === 'unavailable' &&
      legacyDirect.durationLabel === 'Volwassene: 1 u 30 min · Jeugd: 1 uur' &&
      legacyDirect.priceLabel === 'Prijs op aanvraag' &&
      legacyDirect.bookingServiceSlugs.length === 0,
    JSON.stringify(legacyDirect),
  );
  const legacyEnquiry = await card('selftest-aanvraag');
  check(
    'legacy: the unlinked page is asked for, with its editorial duration',
    legacyEnquiry?.status === 'enquiry' && legacyEnquiry.durationLabel === 'Ongeveer twee uur',
    JSON.stringify(legacyEnquiry),
  );

  const auditBefore = (await db.select().from(schema.cmsAuditLog)).length;
  const sessionsBefore = (await db.select().from(schema.cmsSessions)).length;
  const lines: string[] = [];
  const context = {
    db,
    driver: 'pglite',
    cookieJar,
    log: (symbol: string, message: string) => lines.push(`${symbol} ${message}`),
  };
  const previousCookie = cookieJar.get('cms_session');
  await runOfferingMigration({ apply: false }, context);
  check(
    'cms:migrate-offerings dry run: plans both pages, writes nothing (no row, no audit, no session)',
    lines.some((line) => line.startsWith('+ /aanbod/selftest-direct')) &&
      lines.some((line) => line.startsWith('+ /aanbod/selftest-aanvraag')) &&
      (await offeringRows()).length === rowsBefore.size &&
      (await db.select().from(schema.cmsAuditLog)).length === auditBefore &&
      (await db.select().from(schema.cmsSessions)).length === sessionsBefore,
    lines.join(' | '),
  );
  lines.length = 0;
  const applied = await runOfferingMigration({ apply: true }, context);
  const afterApply = await offeringRows();
  check(
    'cms:migrate-offerings --apply: rows for both pages, guard counts unchanged, session revoked',
    applied.created.includes(directPageId) &&
      applied.created.includes(enquiryPageId) &&
      lines.some((line) => line.includes('unchanged')) &&
      cookieJar.get('cms_session') === previousCookie,
    lines.join(' | '),
  );
  const storedDirect = afterApply.find((row) => row.pageId === directPageId);
  const storedVariants = storedDirect
    ? await db
        .select()
        .from(cmsOfferingVariants)
        .where(eq(cmsOfferingVariants.offeringId, storedDirect.id))
    : [];
  check(
    'migration: the linked page is saved as direct, Volwassene → adult service, Jeugd → youth, no price',
    storedDirect?.bookingMode === 'direct' &&
      storedDirect.variantMode === 'audience' &&
      storedVariants.length === 2 &&
      storedVariants.some((v) => v.audience === 'adult' && v.serviceId === adult.data.id) &&
      storedVariants.some((v) => v.audience === 'youth' && v.serviceId === youth.data.id) &&
      storedVariants.every((v) => v.priceCents === null),
    JSON.stringify(storedVariants),
  );
  lines.length = 0;
  const again = await runOfferingMigration({ apply: true }, context);
  check('cms:migrate-offerings: a second apply creates nothing', again.created.length === 0);
  const storedCard = await card('selftest-direct');
  check(
    'migration: the public card is the same before and after',
    JSON.stringify({ ...storedCard, variants: [] }) ===
      JSON.stringify({ ...legacyDirect, variants: [] }),
    JSON.stringify(storedCard),
  );

  // --- 3: permissions --------------------------------------------------------
  const settings = (overrides: Record<string, unknown> = {}) => ({
    isListed: true,
    bookingMode: 'direct',
    variantMode: 'audience',
    variants: [
      { audience: 'adult', serviceId: adult.data.id, priceCents: null },
      { audience: 'youth', serviceId: youth.data.id, priceCents: null },
    ],
    ...overrides,
  });
  await signInAs(provider.userId);
  const snapshot = JSON.stringify(await offeringRows());
  check(
    'provider: saveOffering and listOfferingsForAdmin are refused, nothing written',
    (await refused(() => offersRepo.saveOffering(directPageId, settings({ isListed: false })))) &&
      (await refused(() => offersRepo.listOfferingsForAdmin())) &&
      JSON.stringify(await offeringRows()) === snapshot,
  );
  const groups = await offersRepo.listOfferingSubscriptionGroups();
  check(
    'provider: sees the offering with its variants to subscribe to (service.read)',
    groups.some(
      (group) =>
        group.title === 'Selftest direct' &&
        group.variants.map((v) => v.label).join('/') === 'Volwassene/Jeugd',
    ),
    JSON.stringify(groups),
  );

  const [editor] = await db
    .insert(schema.cmsUsers)
    .values({
      email: EDITOR_EMAIL,
      name: 'Aanbod redacteur',
      role: 'editor',
      passwordHash: 'no-login',
      mustChangePassword: false,
    })
    .returning({ id: schema.cmsUsers.id });
  await signInAs(editor.id);
  const priced = await offersRepo.saveOffering(
    directPageId,
    settings({
      variants: [
        { audience: 'adult', serviceId: adult.data.id, priceCents: 14950 },
        { audience: 'youth', serviceId: youth.data.id, priceCents: null },
      ],
    }),
  );
  const overview = await offersRepo.listOfferingsForAdmin();
  check(
    'editor: saves a price per variant and sees it in Beheer → Aanbod',
    priced.ok &&
      overview.offerings.some(
        (offering) =>
          offering.pageId === directPageId &&
          offering.source === 'stored' &&
          offering.settings.variants[0].priceCents === 14950,
      ),
  );
  const missing = await offersRepo.saveOffering(
    directPageId,
    settings({
      variants: [
        { audience: 'adult', serviceId: adult.data.id, priceCents: null },
        { audience: 'youth', serviceId: null, priceCents: null },
      ],
    }),
  );
  check('editor: direct booking without a service for Jeugd is refused', !missing.ok);

  // --- 4: provider self-service and booking eligibility -----------------------
  const unavailable = await card('selftest-direct');
  check(
    'nobody offers it: "unavailable", no booking slugs, the gate holds nothing back',
    unavailable?.status === 'unavailable' &&
      unavailable.bookingServiceSlugs.length === 0 &&
      (await isServiceBookableOnline(adult.data.id, 'nl')),
    JSON.stringify(unavailable),
  );

  await signInAs(provider.userId);
  const subscribe = await bookingRepo.setProviderServices(provider.id, [
    ...ownBefore,
    { serviceId: adult.data.id, locationId: null },
  ]);
  const bookable = await card('selftest-direct');
  check(
    'provider subscribes their own profile to Volwassene → bookable with that variant only',
    subscribe.ok &&
      bookable?.status === 'bookable' &&
      bookable.bookingServiceSlugs.join(',') === ADULT_SLUG &&
      bookable.priceLabel.startsWith('Volwassene €'),
    JSON.stringify(bookable),
  );
  const [otherProvider] = await db
    .select({ id: schema.cmsProviders.id })
    .from(schema.cmsProviders)
    .where(notInArray(schema.cmsProviders.id, [provider.id]))
    .limit(1);
  if (otherProvider) {
    check(
      "provider: subscribing another provider's profile is refused",
      await refused(() =>
        bookingRepo.setProviderServices(otherProvider.id, [
          { serviceId: youth.data.id, locationId: null },
        ]),
      ),
    );
  }

  await signInAs(editor.id);
  await offersRepo.saveOffering(directPageId, settings({ bookingMode: 'enquiry' }));
  const window = { fromYmd: '2026-11-02', toYmd: '2026-11-08' };
  const heldBack = await availabilityAction({
    serviceId: adult.data.id,
    providerId: null,
    ...window,
  });
  check(
    'switched to enquiry: card "enquiry", the gate and availabilityAction refuse its service',
    (await card('selftest-direct'))?.status === 'enquiry' &&
      !(await isServiceBookableOnline(adult.data.id, 'nl')) &&
      !heldBack.ok &&
      heldBack.message === 'Deze dienst kun je niet online boeken.',
    JSON.stringify(heldBack),
  );

  await offersRepo.saveOffering(directPageId, settings({ isListed: false }));
  const catalogue = await loadOfferCatalogue('nl');
  check(
    'hidden: left out of the overviews, its page 404s, its services held back',
    !catalogue.offers.some((offer) => offer.slug === 'selftest-direct') &&
      catalogue.hiddenPageIds.includes(directPageId) &&
      (await getStudioPage('nl', DIRECT_PAGE)) === null &&
      !(await isServiceBookableOnline(youth.data.id, 'nl')),
  );
  await offersRepo.saveOffering(directPageId, settings());
  check(
    'shown and direct again: bookable, the page is served, the gate allows the service',
    (await card('selftest-direct'))?.status === 'bookable' &&
      (await getStudioPage('nl', DIRECT_PAGE)) !== null &&
      (await isServiceBookableOnline(adult.data.id, 'nl')),
  );

  // --- 5: the enquiry form on the real store (no outbound mail) ---------------
  const sent: Array<{ to: string; subject: string; replyTo: string }> = [];
  const deps = {
    store: enquiry.offerEnquiryStore(db),
    findOffer: (slug: string) => enquiry.findEnquiryOffer(slug, 'nl'),
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
    offerSlug: 'selftest-aanvraag',
    name: 'Aanvrager Test',
    email: 'aanvrager@selftest.local',
    message: 'Kan ik dit in november doen?',
    requestId: '7c0c6f0e-3f8e-4c1b-9c86-0a3e2b5d9f11',
  };
  const first = await deliverOfferEnquiry(form, deps);
  const repeat = await deliverOfferEnquiry(form, deps);
  const direct = await deliverOfferEnquiry({ ...form, offerSlug: 'selftest-direct' }, deps);
  const keys = (
    await db
      .select({ scope: schema.cmsRateLimits.scope })
      .from(schema.cmsRateLimits)
      .where(like(schema.cmsRateLimits.scope, 'aanvraag%'))
  ).map((row) => row.scope);
  check(
    'enquiry: sent once to the inbox (Reply-To the visitor); a repeat is not sent again',
    first.ok &&
      repeat.ok &&
      repeat.duplicate &&
      sent.length === 1 &&
      sent[0].to === 'orders@selftest.local' &&
      sent[0].replyTo === form.email &&
      sent[0].subject.startsWith('Aanvraag: Selftest aanvraag'),
    JSON.stringify({ first, repeat, sent: sent.length }),
  );
  check(
    'enquiry: a directly booked offering does not take enquiries',
    !direct.ok && direct.code === 'unavailable',
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

  // --- 6: clean-up ------------------------------------------------------------
  await signInAs(admin.id);
  await db
    .delete(cmsOfferings)
    .where(rowsBefore.size ? notInArray(cmsOfferings.pageId, [...rowsBefore]) : sql`true`);
  for (const pageId of [directPageId, enquiryPageId]) {
    await cmsRepo.unpublishPage(pageId);
    await cmsRepo.deletePage(pageId);
  }
  await signInAs(provider.userId);
  await bookingRepo.setProviderServices(provider.id, ownBefore);
  await signInAs(admin.id);
  await bookingRepo.deleteService(adult.data.id);
  await bookingRepo.deleteService(youth.data.id);
  await db.delete(schema.cmsSessions).where(eq(schema.cmsSessions.userId, editor.id));
  await db.delete(schema.cmsUsers).where(eq(schema.cmsUsers.id, editor.id));
  await db.delete(schema.cmsRateLimits).where(like(schema.cmsRateLimits.scope, 'aanvraag%'));
  const leftPages = await db
    .select({ id: schema.cmsPages.id })
    .from(schema.cmsPages)
    .where(inArray(schema.cmsPages.slug, [DIRECT_PAGE, ENQUIRY_PAGE]));
  const ownAfter = await db
    .select()
    .from(schema.cmsProviderServices)
    .where(eq(schema.cmsProviderServices.providerId, provider.id));
  check(
    'clean-up: offering rows, pages and editor removed; subscriptions as before; test services inactive',
    leftPages.length === 0 &&
      (await offeringRows()).length === rowsBefore.size &&
      ownAfter.length === ownBefore.length &&
      ownAfter.every((row) => ownBefore.some((entry) => entry.serviceId === row.serviceId)) &&
      (
        await db
          .select()
          .from(schema.cmsServices)
          .where(
            and(
              inArray(schema.cmsServices.id, [adult.data.id, youth.data.id]),
              eq(schema.cmsServices.isActive, true),
            ),
          )
      ).length === 0,
  );
}
