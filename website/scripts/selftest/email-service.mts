/**
 * Self-test section 19: the e-mail service set up in the admin (`/admin/email`)
 * on the throwaway PGlite of `cms-selftest.mts`, right after section 18. No
 * network: `fetch` is replaced, nothing is ever sent.
 *
 * 1. Migration 0004 created `cms_integration_settings`.
 * 2. Access: without a session, as an editor and as a provider every read and
 *    write is refused (`email.manage` is admin-only) and nothing is written,
 *    audited or sent.
 * 3. Missing configuration: not ready; `sendEmail()`, a voucher order and the
 *    admin test mail are all "not sent" without a single provider call.
 * 4. Safe storage: invalid values are refused; the key is stored sealed
 *    (never plain), only its last four characters as a hint; it appears in no
 *    status, site setting, audit entry or log line.
 * 5. Admin configuration end to end: a voucher order goes out with the stored
 *    key, sender and inbox; booking-style mail gets the stored Reply-To.
 * 6. Provider failure (refusal that echoes the key, network error, 500 on the
 *    test mail) is "not sent", redacted in logs and audited as a code.
 * 7. Env compatibility: each env variable wins over the admin value.
 * 8. A rotated `CMS_SESSION_SECRET` makes the stored key unreadable: nothing
 *    is sent. A missing table means "nothing stored" (env still works).
 * 9. Removing the key: nothing is sent again.
 *
 * Imported lazily by `cms-selftest.mts` after its request-context stubs.
 */
import { like } from 'drizzle-orm';
import type { CmsDatabase } from '@/db/cms';

type Check = (label: string, condition: boolean, detail?: string) => void;

const KEY = 're_SelftestAdminKey_0123456789abcdef';
const ENV_KEY = 're_SelftestEnvKey_fedcba9876543210';

export async function emailServiceSection(ctx: {
  db: CmsDatabase;
  admin: { id: string; email: string };
  check: Check;
  section: (title: string) => void;
  cookieJar: Map<string, string>;
}) {
  const { db, admin, check, section, cookieJar } = ctx;
  section('19. e-mail service set up in /admin/email');

  const schema = await import('@/db/cms-schema');
  const { createSession, revokeSession } = await import('@/lib/cms/session');
  const { CmsAuthError } = await import('@/lib/cms/auth');
  const { getSiteSettings } = await import('@/lib/cms/content');
  const emailRepo = await import('@/lib/email/repo');
  const { sendEmail } = await import('@/lib/email/send');
  const { loadEmailSettings, readStoredEmailSettings } = await import('@/lib/email/settings');
  const { requestGiftVoucher } = await import('@/lib/gift-voucher/service');
  const table = schema.cmsIntegrationSettings;

  // --- 1. migration ----------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tables: any = await (db as any).execute(
    `select table_name from information_schema.tables where table_schema = 'public'`,
  );
  const tableNames = (Array.isArray(tables) ? tables : (tables?.rows ?? [])).map(
    (row: { table_name: string }) => row.table_name,
  );
  check(
    'table cms_integration_settings (migration 0004)',
    tableNames.includes('cms_integration_settings'),
  );

  // Section 18 stored an order inbox; start from nothing.
  await db.delete(table);

  // --- shared test doubles -----------------------------------------------------------
  const realFetch = globalThis.fetch;
  const saved = {
    key: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
    replyTo: process.env.EMAIL_REPLY_TO,
    recipient: process.env.GIFT_VOUCHER_RECIPIENT,
    secret: process.env.CMS_SESSION_SECRET,
  };
  for (const name of ['RESEND_API_KEY', 'EMAIL_FROM', 'EMAIL_REPLY_TO', 'GIFT_VOUCHER_RECIPIENT']) {
    delete process.env[name];
  }
  type Call = { url: string; auth: string; body: Record<string, unknown> };
  const calls: Call[] = [];
  let reply: () => Response = () =>
    new Response(JSON.stringify({ id: 'em_selftest' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(url),
      auth: headers.get('Authorization') ?? '',
      body: JSON.parse(String(init?.body ?? '{}')),
    });
    return reply();
  }) as typeof fetch;

  const logs: string[] = [];
  // `check()` prints with console.log, so only the levels the app logs with are captured.
  const realConsole = { info: console.info, warn: console.warn, error: console.error };
  for (const level of ['info', 'warn', 'error'] as const) {
    console[level] = (...args: unknown[]) => {
      logs.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' '));
    };
  }

  async function as(userId: string | null, work: () => Promise<void>) {
    if (!userId) return work();
    const session = await createSession(db, userId, { userAgent: 'selftest-email' });
    cookieJar.set('cms_session', session.token);
    try {
      await work();
    } finally {
      cookieJar.delete('cms_session');
      await revokeSession(db, session.token);
    }
  }
  // Section 18 already stored the order inbox through the same repo: only rows
  // written from here on count.
  const auditBefore = new Set(
    (await db.select({ id: schema.cmsAuditLog.id }).from(schema.cmsAuditLog)).map((row) => row.id),
  );
  const emailAudit = async () =>
    (
      await db.select().from(schema.cmsAuditLog).where(like(schema.cmsAuditLog.action, 'email.%'))
    ).filter((row) => !auditBefore.has(row.id));
  const storedRow = async () => (await db.select().from(table))[0];

  let ip = 10;
  const order = (tag: string) => ({
    amount: '50',
    message: '',
    name: 'Selftest Klant',
    email: `klant-${tag}@example.com`,
    phone: '',
    website: '',
    requestId: `selftest-email-${tag}-0000`,
    ipAddress: `198.51.100.${(ip += 1)}`,
  });
  const voucher = (tag: string) => {
    const { ipAddress, ...raw } = order(tag);
    return requestGiftVoucher(raw, { ipAddress });
  };
  const mail = { to: 'klant@example.com', subject: 'Selftest', html: '<p>x</p>', text: 'x' };

  try {
    // --- 2. access ---------------------------------------------------------------------
    const [editor, provider] = await db
      .insert(schema.cmsUsers)
      .values([
        {
          email: 'email-editor@selftest.local',
          name: 'Editor',
          role: 'editor',
          passwordHash: 'no-login',
        },
        {
          email: 'email-provider@selftest.local',
          name: 'Provider',
          role: 'provider',
          passwordHash: 'no-login',
        },
      ])
      .returning();

    const attempts = {
      status: () => emailRepo.getEmailServiceStatus(),
      save: () =>
        emailRepo.saveEmailServiceConfig({
          from: 'Indringer <x@evil.test>',
          replyTo: '',
          giftVoucherRecipient: 'x@evil.test',
        }),
      setKey: () => emailRepo.setEmailApiKey(KEY),
      clearKey: () => emailRepo.clearEmailApiKey(),
      test: () => emailRepo.sendEmailServiceTest('x@evil.test'),
    };
    for (const [who, userId, code] of [
      ['no session', null, 'unauthenticated'],
      ['editor', editor.id, 'forbidden'],
      ['provider', provider.id, 'forbidden'],
    ] as const) {
      const refused: string[] = [];
      await as(userId, async () => {
        for (const [name, attempt] of Object.entries(attempts)) {
          try {
            await attempt();
          } catch (error) {
            if (error instanceof CmsAuthError && error.code === code) refused.push(name);
          }
        }
      });
      check(
        `access: ${who} is refused for status, save, key, remove key and test mail`,
        refused.length === Object.keys(attempts).length,
        refused.join(', '),
      );
    }
    check(
      'access: refused attempts wrote, audited and sent nothing',
      (await storedRow()) === undefined && (await emailAudit()).length === 0 && calls.length === 0,
    );

    // --- 3. missing configuration -----------------------------------------------------
    let status = null as Awaited<ReturnType<typeof emailRepo.getEmailServiceStatus>> | null;
    let testResult = null as Awaited<ReturnType<typeof emailRepo.sendEmailServiceTest>> | null;
    await as(admin.id, async () => {
      status = await emailRepo.getEmailServiceStatus();
      testResult = await emailRepo.sendEmailServiceTest('beheer@example.test');
    });
    const plain = await sendEmail(mail);
    const unsentOrder = await voucher('unset');
    check(
      'missing config: not ready; sendEmail, a voucher order and the test mail are "not sent", no provider call',
      status!.storeAvailable &&
        !status!.ready &&
        !status!.voucherReady &&
        status!.apiKey.source === 'none' &&
        !plain.sent &&
        plain.reason === 'not_configured' &&
        !unsentOrder.ok &&
        unsentOrder.code === 'not_sent' &&
        testResult!.ok &&
        !testResult!.data.sent &&
        testResult!.data.message.includes('geen API-sleutel') &&
        calls.length === 0,
      JSON.stringify({ plain, unsentOrder, test: testResult }),
    );
    const testAudit = (await emailAudit()).find((row) => row.action === 'email.test');
    check(
      'missing config: the test mail is audited as not sent (masked address, reason code)',
      JSON.stringify(testAudit?.metadata) ===
        JSON.stringify({ to: 'b***@example.test', sent: false, reason: 'not_configured' }),
      JSON.stringify(testAudit?.metadata),
    );

    // --- 4. safe storage ---------------------------------------------------------------
    const refusals: string[] = [];
    await as(admin.id, async () => {
      const injected = await emailRepo.saveEmailServiceConfig({
        from: 'Studio <a@studio.test>\r\nBcc: x@evil.test',
        replyTo: '',
        giftVoucherRecipient: '',
      });
      const badKey = await emailRepo.setEmailApiKey('sk_live_not_a_resend_key');
      const badInbox = await emailRepo.saveEmailServiceConfig({
        from: '',
        replyTo: '',
        giftVoucherRecipient: 'a@studio.test, b@studio.test',
      });
      for (const result of [injected, badKey, badInbox])
        if (!result.ok) refusals.push(result.message);
    });
    check(
      'validation: header injection in the sender, a non-Resend key and a list as inbox are refused; nothing stored',
      refusals.length === 3 && (await storedRow()) === undefined,
      refusals.join(' | '),
    );

    const FROM = 'De Bikefit Studio <afspraken@studio.test>';
    const REPLY_TO = 'info@studio.test';
    const INBOX = 'bestellingen@studio.test';
    await as(admin.id, async () => {
      const config = await emailRepo.saveEmailServiceConfig({
        from: FROM,
        replyTo: REPLY_TO,
        giftVoucherRecipient: INBOX,
      });
      const key = await emailRepo.setEmailApiKey(`  ${KEY}  `);
      if (!config.ok || !key.ok) throw new Error('admin save failed');
      status = await emailRepo.getEmailServiceStatus();
    });
    const row = await storedRow();
    check(
      'storage: key sealed (v1 envelope, not plain), hint = last four, config holds only addresses',
      Boolean(row?.secretCiphertext?.startsWith('v1.')) &&
        !row!.secretCiphertext!.includes(KEY) &&
        row!.secretHint === KEY.slice(-4) &&
        !JSON.stringify(row!.config).includes('re_') &&
        JSON.stringify(row!.config) ===
          JSON.stringify({ from: FROM, replyTo: REPLY_TO, giftVoucherRecipient: INBOX }),
    );
    const settingsRows = await db.select().from(schema.cmsSiteSettings);
    const audit = await emailAudit();
    check(
      'no leak: the key is in no status, site setting, public settings or audit entry',
      !JSON.stringify(status).includes(KEY) &&
        !JSON.stringify(status).includes(row!.secretCiphertext!) &&
        !JSON.stringify(settingsRows).includes(KEY) &&
        !JSON.stringify(await getSiteSettings(schema.DEFAULT_LOCALE)).includes(KEY) &&
        !JSON.stringify(audit).includes(KEY) &&
        !JSON.stringify(audit).includes(row!.secretCiphertext!) &&
        !JSON.stringify(audit).includes(KEY.slice(-4)),
    );
    check(
      'status: key from the admin (hint only), ready for bookings and vouchers; audited as key set + settings update',
      status!.apiKey.source === 'setting' &&
        status!.apiKey.hint === KEY.slice(-4) &&
        status!.ready &&
        status!.voucherReady &&
        audit.some((entry) => entry.action === 'email.key.set' && entry.metadata === null) &&
        audit.some(
          (entry) =>
            entry.action === 'email.settings.update' &&
            JSON.stringify(entry.metadata) ===
              JSON.stringify({ changed: ['from', 'replyTo', 'giftVoucherRecipient'] }),
        ),
      JSON.stringify(audit.map((entry) => [entry.action, entry.metadata])),
    );

    // --- 5. admin configuration end to end ----------------------------------------------
    calls.length = 0;
    const sentOrder = await voucher('admin');
    const bookingMail = await sendEmail(mail);
    check(
      'admin config: the voucher order goes out with the stored key, sender and inbox (Reply-To the visitor)',
      sentOrder.ok &&
        calls[0]?.auth === `Bearer ${KEY}` &&
        calls[0]?.body.from === FROM &&
        JSON.stringify(calls[0]?.body.to) === JSON.stringify([INBOX]) &&
        calls[0]?.body.reply_to === 'klant-admin@example.com',
      JSON.stringify({
        sentOrder,
        from: calls[0]?.body.from,
        to: calls[0]?.body.to,
        replyTo: calls[0]?.body.reply_to,
        keyMatches: calls[0]?.auth === `Bearer ${KEY}`,
      }),
    );
    check(
      'admin config: other mail (bookings) gets the stored Reply-To',
      bookingMail.sent && calls[1]?.body.reply_to === REPLY_TO,
    );

    // --- 6. provider failure --------------------------------------------------------------
    calls.length = 0;
    reply = () =>
      new Response(JSON.stringify({ message: `API key ${KEY} is invalid` }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    const refusedOrder = await voucher('refused');
    reply = () => {
      throw new TypeError('fetch failed');
    };
    const networkOrder = await voucher('network');
    reply = () => new Response('{}', { status: 500 });
    let failedTest = null as Awaited<ReturnType<typeof emailRepo.sendEmailServiceTest>> | null;
    await as(admin.id, async () => {
      failedTest = await emailRepo.sendEmailServiceTest(INBOX);
    });
    const lastAudit = (await emailAudit()).filter((entry) => entry.action === 'email.test').at(-1);
    check(
      'provider failure: refusal and network error → "not sent"; failed test mail says so, audited as provider_error',
      !refusedOrder.ok &&
        refusedOrder.code === 'not_sent' &&
        !networkOrder.ok &&
        networkOrder.code === 'not_sent' &&
        calls.length === 3 &&
        failedTest!.ok &&
        !failedTest!.data.sent &&
        failedTest!.data.message.startsWith('Niet verstuurd') &&
        JSON.stringify(lastAudit?.metadata) ===
          JSON.stringify({ to: 'b***@studio.test', sent: false, reason: 'provider_error' }),
      JSON.stringify({ refusedOrder, networkOrder, failedTest, audit: lastAudit?.metadata }),
    );
    reply = () =>
      new Response(JSON.stringify({ id: 'em_selftest' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    // --- 7. env compatibility ---------------------------------------------------------------
    calls.length = 0;
    process.env.RESEND_API_KEY = ENV_KEY;
    process.env.EMAIL_FROM = 'Ops <ops@env.test>';
    const envMail = await sendEmail(mail);
    await as(admin.id, async () => {
      status = await emailRepo.getEmailServiceStatus();
    });
    check(
      'env wins: RESEND_API_KEY and EMAIL_FROM override the admin values; the admin sees the override',
      envMail.sent &&
        calls[0]?.auth === `Bearer ${ENV_KEY}` &&
        calls[0]?.body.from === 'Ops <ops@env.test>' &&
        calls[0]?.body.reply_to === REPLY_TO &&
        status!.apiKey.source === 'env' &&
        status!.apiKey.storedButOverridden &&
        status!.apiKey.hint === null &&
        status!.sender.source === 'env' &&
        !JSON.stringify(status).includes(ENV_KEY),
    );
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;

    // --- 8. rotated secret, missing table ---------------------------------------------------
    calls.length = 0;
    process.env.CMS_SESSION_SECRET = 'selftest-rotated-session-secret-value';
    const rotated = await loadEmailSettings();
    const rotatedMail = await sendEmail(mail);
    process.env.CMS_SESSION_SECRET = saved.secret;
    const missingTable = await readStoredEmailSettings(
      new Proxy(db, {
        get(target, property, receiver) {
          if (property === 'select') {
            return () => {
              throw new Error('relation "cms_integration_settings" does not exist');
            };
          }
          return Reflect.get(target, property, receiver);
        },
      }),
    );
    check(
      'rotated CMS_SESSION_SECRET: stored key unreadable → not sent; missing table → nothing stored, no throw',
      rotated.apiKey === null &&
        !rotatedMail.sent &&
        rotatedMail.reason === 'not_configured' &&
        calls.length === 0 &&
        !missingTable.available &&
        missingTable.apiKey === null,
    );

    // --- 9. removing the key -----------------------------------------------------------------
    await as(admin.id, async () => {
      const cleared = await emailRepo.clearEmailApiKey();
      if (!cleared.ok) throw new Error(cleared.message);
      status = await emailRepo.getEmailServiceStatus();
    });
    const afterClear = await sendEmail(mail);
    const clearedRow = await storedRow();
    check(
      'remove key: ciphertext and hint gone, not ready, nothing sent; audited',
      clearedRow?.secretCiphertext === null &&
        clearedRow?.secretHint === null &&
        !status!.ready &&
        !afterClear.sent &&
        afterClear.reason === 'not_configured' &&
        calls.length === 0 &&
        (await emailAudit()).some((entry) => entry.action === 'email.key.clear'),
    );

    check(
      'logs: no line carries the key (provider message redacted)',
      logs.length > 0 && !logs.some((line) => line.includes(KEY) || line.includes(ENV_KEY)),
      `${logs.length} lines`,
    );
  } finally {
    globalThis.fetch = realFetch;
    Object.assign(console, realConsole);
    const restore: [string, string | undefined][] = [
      ['RESEND_API_KEY', saved.key],
      ['EMAIL_FROM', saved.from],
      ['EMAIL_REPLY_TO', saved.replyTo],
      ['GIFT_VOUCHER_RECIPIENT', saved.recipient],
      ['CMS_SESSION_SECRET', saved.secret],
    ];
    for (const [name, value] of restore) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await db.delete(table);
    await db
      .delete(schema.cmsBookingRateLimit)
      .where(like(schema.cmsBookingRateLimit.email, 'cadeaubon%'));
    await db.delete(schema.cmsUsers).where(like(schema.cmsUsers.email, 'email-%@selftest.local'));
    cookieJar.clear();
  }
}
