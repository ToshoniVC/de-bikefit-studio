/**
 * Self-test section 18: the gift voucher ("Cadeaubon") on the throwaway PGlite
 * of `cms-selftest.mts`, right after section 17 (which leaves /aanbod as on
 * staging before the review, with an editor's own kicker published).
 *
 * 1. `cms:patch-cadeaubon`: the dry run writes nothing; an unpublished draft
 *    on /aanbod blocks the apply; after publishing, apply creates and
 *    publishes /aanbod/cadeaubon, appends "Overige" to /aanbod (editor's
 *    kicker kept), leaves the booking tables alone, audits once, cleans up its
 *    session; a second apply does nothing; restore and re-apply work.
 * 2. The order service end to end on the database (no network: `fetch` is
 *    replaced): no `RESEND_API_KEY` or no `EMAIL_FROM` or a provider refusal
 *    is "not sent" and leaves no sent marker; only an accepted request is a
 *    success, sent from `EMAIL_FROM` to the order inbox (/admin/email →
 *    *Ontvanger cadeaubonbestellingen*) with the visitor as Reply-To; a repeat is
 *    not mailed twice; the rate limit holds; the rows never hold the plain
 *    e-mail address and never count as booking attempts. The public
 *    `contact.email` alone is never used as the recipient; env
 *    `GIFT_VOUCHER_RECIPIENT` wins over the setting; an invalid value sends
 *    nothing.
 *
 * Imported lazily by `cms-selftest.mts` after its request-context stubs.
 */
import { and, eq, like } from 'drizzle-orm';
import type { CmsDatabase } from '@/db/cms';
import { CONTACT_EMAIL } from '@/lib/studio/seed-content/shared';
import { guardCounts, type PlanDeps } from '../lib/aanbod-rollout.mjs';
import { runCadeaubonPatch } from '../lib/cadeaubon-patch.mjs';

type Check = (label: string, condition: boolean, detail?: string) => void;

export async function cadeaubonSection(ctx: {
  db: CmsDatabase;
  admin: { id: string; email: string };
  check: Check;
  section: (title: string) => void;
  cookieJar: Map<string, string>;
  backupDir: string;
}) {
  const { db, admin, check, section, cookieJar, backupDir } = ctx;
  section('18. gift voucher: cms:patch-cadeaubon + order requests');

  const schema = await import('@/db/cms-schema');
  const repo = await import('@/lib/cms/repo');
  const { createSession, revokeSession } = await import('@/lib/cms/session');
  const { getPublishedPage, getSiteSettings } = await import('@/lib/cms/content');
  const { listPublishedOffers } = await import('@/lib/cms/offers-content');
  const locale = schema.DEFAULT_LOCALE;
  const planDeps: PlanDeps = {
    db,
    orm: await import('drizzle-orm'),
    schema,
    blocks: await import('@/lib/cms/blocks'),
    locale,
    log: () => {},
  };

  /**
   * Runs `work` as the self-test admin, signed in with both steps (it also
   * plays the editor). `stepUp`: right after a full authentication, which the
   * e-mail settings ask for (`src/lib/email/repo.ts`).
   */
  async function asAdmin(work: () => Promise<void>, { stepUp = false } = {}) {
    const session = await createSession(
      db,
      admin.id,
      { userAgent: 'selftest-cadeaubon' },
      { mfaVerified: true, reauthenticated: stepUp },
    );
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
  const liveGroups = async () =>
    (
      (await getPublishedPage(locale, 'aanbod'))?.snapshot.blocks.find(
        (block) => block.type === 'offerCatalogue',
      )?.data as { groups: { category: string }[] } | undefined
    )?.groups.map((group) => group.category) ?? [];

  // --- 1. the patch -----------------------------------------------------------------
  const log: string[] = [];
  const run = (options: { apply: boolean; restore: string | null }, target: CmsDatabase = db) =>
    runCadeaubonPatch(
      { ...options, backupDir },
      {
        db: target,
        driver: 'pglite',
        cookieJar,
        log: (symbol, message) => log.push(`${symbol} ${message}`),
      },
    );

  // An editor's saved-but-unpublished change on /aanbod.
  const aanbodId = (await pageRow('aanbod')).id;
  let calloutId = '';
  await asAdmin(async () => {
    const callout = (await repo.getPageForEdit(aanbodId))!.blocks.find(
      (block) => block.type === 'cta',
    )!;
    calloutId = callout.id;
    await repo.updateBlock(callout.id, { ...(callout.data as object), body: 'Concepttekst.' });
  });

  const writeCalls: string[] = [];
  const watchedDb = new Proxy(db, {
    get(target, property, receiver) {
      const writes = ['insert', 'update', 'delete', 'execute', 'transaction', 'batch'];
      if (typeof property === 'string' && writes.includes(property)) writeCalls.push(property);
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  await run({ apply: false, restore: null }, watchedDb);
  const planned = log.join('\n');
  check(
    'dry run: no write call; plans the new page and "Overige"; blocks on the /aanbod draft',
    writeCalls.length === 0 &&
      !cookieJar.has('cms_session') &&
      planned.includes('+ page /aanbod/cadeaubon — create and publish') &&
      planned.includes('~ page /aanbod — 1 change(s), then publish') &&
      planned.includes('/aanbod is not published or has unpublished draft edits') &&
      log.at(-1)?.includes('dry run: blocked') === true,
    writeCalls.join() || log.filter((line) => /^[~!+]/.test(line)).join(' | '),
  );

  let refused = '';
  try {
    await run({ apply: true, restore: null });
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error);
  }
  check(
    'apply: refuses the unpublished draft and creates nothing',
    refused.includes('unpublished draft edits') &&
      (await pageRow('aanbod/cadeaubon')) === undefined,
    refused,
  );

  await asAdmin(async () => {
    const callout = (await repo.getPageForEdit(aanbodId))!.blocks.find(
      (block) => block.id === calloutId,
    )!;
    await repo.updateBlock(callout.id, { ...(callout.data as object), body: '' });
  });
  const guardsBefore = await guardCounts(planDeps);
  const sessionsLeft = async () => (await db.select().from(schema.cmsSessions)).length;
  const sessionsBefore = await sessionsLeft();
  log.length = 0;
  await run({ apply: true, restore: null });
  const backupPath =
    log.find((line) => line.includes('backup written: '))?.split('backup written: ')[1] ?? '';
  const voucherPage = await getPublishedPage(locale, 'aanbod/cadeaubon');
  const offers = await listPublishedOffers(locale);
  check(
    'apply: backup first, verified, session revoked; voucher page live; Overige last on /aanbod',
    backupPath.includes('cadeaubon-patch-') &&
      log.some((line) => line.includes('verified')) &&
      (await sessionsLeft()) === sessionsBefore &&
      !cookieJar.has('cms_session') &&
      voucherPage?.snapshot.blocks.map((block) => block.type).join() === 'giftVoucher' &&
      (await liveGroups()).join() === 'bikefit,begeleiding,overige',
    log.at(-1),
  );
  check(
    'catalogue: the voucher is the Overige card; the editor’s /aanbod kicker survives',
    offers.some(
      (offer) =>
        offer.slug === 'cadeaubon' && offer.kind === 'giftVoucher' && offer.category === 'overige',
    ) &&
      ((await getPublishedPage(locale, 'aanbod'))?.snapshot.blocks[0].data as { eyebrow?: string })
        ?.eyebrow === 'Ons volledige aanbod',
  );
  check(
    'booking tables untouched; apply audited once',
    JSON.stringify(await guardCounts(planDeps)) === JSON.stringify(guardsBefore) &&
      (
        await db
          .select()
          .from(schema.cmsAuditLog)
          .where(eq(schema.cmsAuditLog.action, 'patch.cadeaubon.apply'))
      ).length === 1,
  );

  log.length = 0;
  await run({ apply: true, restore: null });
  const nothing = log.some((line) => line.includes('nothing changed'));
  await run({ apply: false, restore: backupPath });
  const restored =
    (await pageRow('aanbod/cadeaubon')).status === 'draft' &&
    (await liveGroups()).join() === 'bikefit,begeleiding';
  log.length = 0;
  await run({ apply: true, restore: null });
  check(
    'idempotent; restore unpublishes the page and drops Overige; re-apply publishes the kept draft',
    nothing &&
      restored &&
      log.some((line) => line.includes('publish the existing (unchanged) draft')) &&
      (await pageRow('aanbod/cadeaubon')).status === 'published' &&
      (await liveGroups()).join() === 'bikefit,begeleiding,overige',
  );

  // --- 2. order requests through the real service (fetch replaced) -----------------
  const { requestGiftVoucher } = await import('@/lib/gift-voucher/service');
  const emailRepo = await import('@/lib/email/repo');
  const ORDER_INBOX = 'bestellingen-inbox@example.test';
  // Only the inbox is stored in the admin here; key and sender come from env,
  // the path every existing deployment uses. A sensitive change: step-up first.
  const setOrderInbox = (address: string) =>
    asAdmin(
      async () => {
        const saved = await emailRepo.saveEmailServiceConfig({
          from: '',
          replyTo: '',
          giftVoucherRecipient: address,
        });
        if (!saved.ok) throw new Error(saved.message);
      },
      { stepUp: true },
    );
  await asAdmin(async () => {
    const current = (await getSiteSettings(locale)).contact;
    await repo.updateSiteSetting(locale, 'contact', { ...current, email: CONTACT_EMAIL });
  });
  await setOrderInbox(ORDER_INBOX);

  const realFetch = globalThis.fetch;
  const env = {
    key: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
    recipient: process.env.GIFT_VOUCHER_RECIPIENT,
  };
  delete process.env.GIFT_VOUCHER_RECIPIENT;
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  let status = 200;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(
      JSON.stringify(status === 200 ? { id: 'em_selftest' } : { message: 'refused' }),
      {
        status,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }) as typeof fetch;

  const order = {
    amount: '75,50',
    message: 'Veel fietsplezier!',
    name: 'Selftest Klant',
    email: 'cadeau.klant@example.com',
    phone: '',
    website: '',
    requestId: 'selftest-request-0001',
  };
  const ip = '198.51.100.9';
  const sentMarkers = async () =>
    (
      await db
        .select()
        .from(schema.cmsBookingRateLimit)
        .where(like(schema.cmsBookingRateLimit.email, 'cadeaubon-sent:%'))
    ).length;

  try {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    const noKey = await requestGiftVoucher(order, { ipAddress: ip });
    process.env.RESEND_API_KEY = 're_selftest_not_real';
    const noFrom = await requestGiftVoucher(order, { ipAddress: ip });
    process.env.EMAIL_FROM = 'De Bikefit Studio <bestellingen@example.test>';
    status = 422;
    const refusedSend = await requestGiftVoucher(order, { ipAddress: ip });
    check(
      'no API key, no EMAIL_FROM, provider refusal → "not sent", no sent marker',
      [noKey, noFrom, refusedSend].every((result) => !result.ok && result.code === 'not_sent') &&
        calls.length === 1 &&
        (await sentMarkers()) === 0,
      JSON.stringify(
        [noKey, noFrom, refusedSend].map((result) => (result.ok ? 'ok' : result.code)),
      ),
    );

    status = 200;
    calls.length = 0;
    const accepted = await requestGiftVoucher(order, { ipAddress: ip });
    const body = calls[0]?.body ?? {};
    check(
      'accepted by the provider → success; from EMAIL_FROM to the order inbox, Reply-To the visitor',
      accepted.ok &&
        calls.length === 1 &&
        calls[0].url === 'https://api.resend.com/emails' &&
        body.from === process.env.EMAIL_FROM &&
        JSON.stringify(body.to) === JSON.stringify([ORDER_INBOX]) &&
        body.reply_to === order.email &&
        !String(body.subject).includes('Selftest') &&
        String(body.text).includes('Veel fietsplezier!') &&
        (await sentMarkers()) === 1,
      JSON.stringify({ accepted, to: body.to, from: body.from }),
    );

    const repeat = await requestGiftVoucher(order, { ipAddress: ip });
    check(
      'the same form again: confirmed, not mailed twice',
      repeat.ok && repeat.duplicate && calls.length === 1,
    );

    const fifth = await requestGiftVoucher(
      { ...order, requestId: 'selftest-request-0002' },
      { ipAddress: ip },
    );
    const sixth = await requestGiftVoucher(
      { ...order, requestId: 'selftest-request-0003' },
      { ipAddress: ip },
    );
    check(
      'rate limit: the sixth request in 15 minutes is refused before any mail',
      fifth.ok && !sixth.ok && sixth.code === 'rate_limited' && calls.length === 2,
      JSON.stringify([fifth, sixth]),
    );

    // Bookings no longer write this table (since 0008 they reserve hits on
    // `cms_rate_limits`, section 14b); the voucher rows are namespaced, so even
    // the rows of a database from before 0008 (plain e-mail and IP) can never
    // match one, and none of these holds the visitor's address.
    const rows = (await db.select().from(schema.cmsBookingRateLimit)).filter((row) =>
      row.email.startsWith('cadeaubon'),
    );
    check(
      'rate-limit rows: namespaced, hashed e-mail, never counted as a booking attempt',
      rows.length === 7 &&
        rows.every(
          (row) =>
            !row.email.includes('@') &&
            (row.ipAddress === `cadeaubon:${ip}` || row.ipAddress === 'cadeaubon'),
        ) &&
        (
          await db
            .select()
            .from(schema.cmsBookingRateLimit)
            .where(eq(schema.cmsBookingRateLimit.email, order.email))
        ).length === 0,
      rows.map((row) => `${row.email.slice(0, 20)}|${row.ipAddress}`).join(', '),
    );

    // The recipient is its own setting (gift-voucher/recipient.ts). Another
    // visitor and IP, so the rate limit above does not interfere. Key, sender
    // and an accepting provider are all in place for these three.
    const other = { ...order, email: 'tweede.klant@example.com' };
    const otherIp = '198.51.100.10';
    calls.length = 0;
    await setOrderInbox('');
    const contactOnly = await requestGiftVoucher(
      { ...other, requestId: 'selftest-request-0010' },
      { ipAddress: otherIp },
    );
    process.env.GIFT_VOUCHER_RECIPIENT = 'ops-inbox@example.test';
    await setOrderInbox(ORDER_INBOX);
    const viaEnv = await requestGiftVoucher(
      { ...other, requestId: 'selftest-request-0011' },
      { ipAddress: otherIp },
    );
    process.env.GIFT_VOUCHER_RECIPIENT = 'geen-adres';
    const badEnv = await requestGiftVoucher(
      { ...other, requestId: 'selftest-request-0012' },
      { ipAddress: otherIp },
    );
    check(
      'recipient: public contact e-mail alone → not sent; env wins over the setting; invalid env → not sent',
      !contactOnly.ok &&
        contactOnly.code === 'not_sent' &&
        viaEnv.ok &&
        !badEnv.ok &&
        badEnv.code === 'not_sent' &&
        calls.length === 1 &&
        JSON.stringify(calls[0].body.to) === JSON.stringify(['ops-inbox@example.test']),
      JSON.stringify({
        results: [contactOnly, viaEnv, badEnv].map((result) => (result.ok ? 'ok' : result.code)),
        to: calls.map((call) => call.body.to),
      }),
    );
  } finally {
    globalThis.fetch = realFetch;
    if (env.key === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = env.key;
    if (env.from === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = env.from;
    if (env.recipient === undefined) delete process.env.GIFT_VOUCHER_RECIPIENT;
    else process.env.GIFT_VOUCHER_RECIPIENT = env.recipient;
    await db
      .delete(schema.cmsBookingRateLimit)
      .where(like(schema.cmsBookingRateLimit.email, 'cadeaubon%'));
  }
  cookieJar.clear();
}
