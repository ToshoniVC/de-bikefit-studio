/**
 * Self-test section 19, part 2 (`./email-service.mts` runs it first): who may
 * use `/admin/email`. Every call goes straight to the repo
 * (`src/lib/email/repo.ts`), as a forged server-action POST would.
 *
 *  - no session, an editor, a provider who passed two-step verification:
 *    every read and write is refused (`email.manage` is admin-only);
 *  - an admin or provider session that did not pass two-step verification:
 *    refused (`mfa_required`), even with a fresh sign-in stamp;
 *  - an MFA-verified admin without a recent step-up, or with one older than
 *    5 minutes: the key, sender, reply-to and order inbox cannot be changed
 *    (`reauth_required`);
 *  - nothing refused is written, audited or sent;
 *  - "Bevestig je identiteit" (password + recovery code, the real
 *    `confirmIdentity()`) opens the window on that session: the same calls now
 *    pass the guard and reach the repo's own validation.
 *
 * That the status and the test message need no step-up is shown by the caller
 * (part 3), which reads and sends with an admin session without one.
 */
import type { CmsDatabase } from '@/db/cms';

type Check = (label: string, condition: boolean, detail?: string) => void;

export type SessionOptions = {
  /** The session passed the second step; required for admin sessions. */
  mfaVerified?: boolean;
  /** A full authentication just happened (sign-in or step-up): opens the 5-minute window. */
  reauthenticated?: boolean;
};

/**
 * Runs `work` with a real `cms_sessions` row for `userId` in the cookie jar the
 * stubbed `next/headers` reads (no session for `null`), revoked afterwards.
 */
export async function withSession(
  ctx: { db: CmsDatabase; cookieJar: Map<string, string> },
  userId: string | null,
  options: SessionOptions,
  work: (sessionId: string | null) => Promise<void>,
): Promise<void> {
  if (!userId) return work(null);
  const { createSession, revokeSession } = await import('@/lib/cms/session');
  const session = await createSession(ctx.db, userId, { userAgent: 'selftest-email' }, options);
  ctx.cookieJar.set('cms_session', session.token);
  try {
    await work(session.id);
  } finally {
    ctx.cookieJar.delete('cms_session');
    await revokeSession(ctx.db, session.token);
  }
}

export async function emailAccessChecks(ctx: {
  db: CmsDatabase;
  admin: { id: string; email: string };
  /** The admin's own password (section 5b), for the real step-up. */
  password: string;
  check: Check;
  cookieJar: Map<string, string>;
  apiKey: string;
  /** Nothing stored, audited or sent since section 19 began. */
  untouched: () => Promise<boolean>;
}) {
  const { db, admin, password, check, cookieJar, apiKey, untouched } = ctx;
  const { eq } = await import('drizzle-orm');
  const schema = await import('@/db/cms-schema');
  const { CmsAuthError } = await import('@/lib/cms/auth');
  const { confirmIdentity } = await import('@/lib/cms/mfa/reauth');
  const { replaceRecoveryCodes } = await import('@/lib/cms/mfa/repo');
  const emailRepo = await import('@/lib/email/repo');

  /** The guard's refusal code, `ok`, or `invalid: <message>` when the repo itself refused. */
  const outcome = async (call: () => Promise<unknown>): Promise<string> => {
    try {
      const value = (await call()) as { ok?: boolean; message?: string } | undefined;
      return value?.ok === false ? `invalid: ${value.message}` : 'ok';
    } catch (error) {
      if (error instanceof CmsAuthError) return error.code;
      return `other: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
  /** The calls of `calls` that did not end in `expected`, with what they did instead. */
  const unexpected = async (calls: Record<string, () => Promise<unknown>>, expected: string) => {
    const wrong: string[] = [];
    for (const [name, call] of Object.entries(calls)) {
      const result = await outcome(call);
      if (result !== expected) wrong.push(`${name}: ${result}`);
    }
    return wrong;
  };

  const reads = {
    status: () => emailRepo.getEmailServiceStatus(),
    'test mail': () => emailRepo.sendEmailServiceTest('x@evil.test'),
  };
  const changes = {
    save: () =>
      emailRepo.saveEmailServiceConfig({
        from: 'Indringer <x@evil.test>',
        replyTo: '',
        giftVoucherRecipient: 'x@evil.test',
      }),
    key: () => emailRepo.setEmailApiKey(apiKey),
    'remove key': () => emailRepo.clearEmailApiKey(),
  };

  // --- who: admins only, and only after two-step verification ----------------------
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
  // Everyone below signed in just now, so a missing step-up is never the reason.
  for (const [who, userId, options, code] of [
    ['no session', null, {}, 'unauthenticated'],
    ['editor', editor.id, { reauthenticated: true }, 'forbidden'],
    ['provider', provider.id, { mfaVerified: true, reauthenticated: true }, 'forbidden'],
    [
      'provider without two-step verification',
      provider.id,
      { reauthenticated: true },
      'mfa_required',
    ],
    ['admin without two-step verification', admin.id, { reauthenticated: true }, 'mfa_required'],
  ] as const) {
    let wrong: string[] = [];
    await withSession({ db, cookieJar }, userId, options, async () => {
      wrong = await unexpected({ ...reads, ...changes }, code);
    });
    check(
      `access: ${who} is refused (${code}) for status, save, key, remove key and test mail`,
      wrong.length === 0,
      wrong.join(', '),
    );
  }

  // --- step-up: an admin signed in with both steps, but longer than 5 minutes ago ----
  let missing: string[] = [];
  let stale: string[] = [];
  let stepUp = '';
  let allowed: Record<string, string> = {};
  let nothingYet = false;
  await withSession({ db, cookieJar }, admin.id, { mfaVerified: true }, async (sessionId) => {
    missing = await unexpected(changes, 'reauth_required');
    // Test-only: a step-up 5 minutes and a second ago.
    await db
      .update(schema.cmsSessions)
      .set({ reauthenticatedAt: new Date(Date.now() - 5 * 60_000 - 1_000) })
      .where(eq(schema.cmsSessions.id, sessionId!));
    stale = await unexpected(changes, 'reauth_required');
    nothingYet = await untouched();

    const [code] = await replaceRecoveryCodes(db, admin.id);
    const confirmed = await confirmIdentity(
      { password, code },
      { ipAddress: '10.20.0.19', userAgent: 'selftest-email' },
    );
    stepUp = confirmed.ok ? 'ok' : confirmed.message;
    // Values the repo refuses itself, so the guard's answer shows and nothing is stored.
    allowed = {
      save: await outcome(() =>
        emailRepo.saveEmailServiceConfig({ from: 'abc', replyTo: '', giftVoucherRecipient: '' }),
      ),
      key: await outcome(() => emailRepo.setEmailApiKey('sk_live_not_a_resend_key')),
      // Nothing is stored yet: removing is a no-op that still passes the guard.
      'remove key': await outcome(() => emailRepo.clearEmailApiKey()),
    };
  });
  check(
    'step-up: without a recent one, save, key and remove key are refused (reauth_required)',
    missing.length === 0,
    missing.join(', '),
  );
  check('step-up: one older than 5 minutes is refused again', stale.length === 0, stale.join(', '));
  check('access: refused attempts wrote, audited and sent nothing', nothingYet);
  check(
    'step-up: "Bevestig je identiteit" (password + code) lets the same session through',
    stepUp === 'ok' &&
      allowed.save.startsWith('invalid: Afzender') &&
      allowed.key.startsWith('invalid: Dit lijkt geen Resend') &&
      allowed['remove key'] === 'ok' &&
      (await untouched()),
    `${stepUp} | ${JSON.stringify(allowed)}`,
  );
}
