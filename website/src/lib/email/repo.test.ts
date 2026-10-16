import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CmsRole, CmsUserPublic } from '@/db/cms-schema';
import {
  clearEmailApiKey,
  getEmailServiceStatus,
  saveEmailServiceConfig,
  sendEmailServiceTest,
  setEmailApiKey,
} from './repo';

/**
 * Who may use `/admin/email`, calling the repo directly as its server actions
 * (or a forged POST) do. The session lookup, the database, the stored settings
 * and the mail provider are mocked, as in `src/lib/cms/auth.test.ts`; the
 * decision is the real guard. Changing the key, the sender, the reply-to or
 * the order inbox needs a recent step-up ("Bevestig je identiteit"); reading
 * the status and sending the test message do not. On a real database:
 * `npm run cms:selftest`, section 19.
 */

const session = vi.hoisted(() => ({
  readSessionCookie: vi.fn(async (): Promise<string | undefined> => undefined),
  resolveSession: vi.fn(async (): Promise<unknown> => null),
  setSessionCookie: vi.fn(async () => {}),
  clearSessionCookie: vi.fn(async () => {}),
  createSession: vi.fn(async () => {}),
  revokeSession: vi.fn(async () => {}),
  revokeAllUserSessions: vi.fn(async () => {}),
  toPublicUser: vi.fn((user: unknown) => user),
}));

/** Just enough of a Drizzle handle for the repo's writes; records every one. */
const fake = vi.hoisted(() => {
  const writes: Array<Record<string, unknown>> = [];
  const db = {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        writes.push(values);
        return Object.assign(Promise.resolve(), { onConflictDoUpdate: async () => {} });
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        writes.push(values);
        return { where: async () => {} };
      },
    }),
  };
  return { writes, db };
});

const stored = vi.hoisted(() => ({
  emailEnv: () => ({}),
  readStoredEmailSettings: vi.fn(async () => ({
    available: true,
    config: { from: '', replyTo: '', giftVoucherRecipient: '' },
    apiKey: 're_stored_unit_key_1234',
    apiKeyStored: true,
    apiKeyHint: '1234',
    apiKeyUpdatedAt: new Date('2026-10-13T08:00:00Z'),
  })),
  sealEmailApiKey: vi.fn(() => 'v1.iv.tag.ciphertext'),
}));

const mail = vi.hoisted(() => ({
  sendEmail: vi.fn(async () => ({ sent: true as const, id: 'em_unit' })),
  maskEmail: (address: string) => `${address.slice(0, 1)}***`,
}));

vi.mock('@/lib/cms/session', () => session);
vi.mock('@/lib/cms/mfa/challenge', () => ({
  clearChallengeCookie: vi.fn(),
  createMfaChallenge: vi.fn(),
  deleteMfaChallenge: vi.fn(),
  readChallengeCookie: vi.fn(),
  resolveMfaChallenge: vi.fn(),
  setChallengeCookie: vi.fn(),
}));
vi.mock('@/lib/cms/mfa/repo', () => ({
  clearMfaAttempts: vi.fn(async () => {}),
  hasConfirmedFactor: vi.fn(async () => false),
}));
vi.mock('@/db/cms', () => ({ getCmsDb: async () => fake.db }));
vi.mock('@/lib/cms/content', () => ({
  getSiteSettings: async () => ({ site: { name: 'De Bikefit Studio' } }),
}));
vi.mock('./settings', () => stored);
vi.mock('./send', () => mail);

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000);
const refusedFor = (code: string) => ({ name: 'CmsAuthError', code });

function cmsUser(role: CmsRole, mustChangePassword = false): CmsUserPublic {
  const at = new Date('2026-10-13T08:00:00Z');
  return {
    id: `user-${role}`,
    email: `${role}@example.com`,
    name: role,
    role,
    mustChangePassword,
    isActive: true,
    createdAt: at,
    updatedAt: at,
    lastLoginAt: null,
  };
}

/** The request carries a valid session for `user`, MFA passed unless said otherwise. */
function signIn(
  user: CmsUserPublic | null,
  { mfaVerified = true, reauthenticatedAt = null as Date | null } = {},
) {
  session.readSessionCookie.mockResolvedValue(user ? 'cookie-token' : undefined);
  session.resolveSession.mockResolvedValue(
    user
      ? {
          user,
          sessionId: 'session-1',
          mfaVerified,
          reauthenticatedAt,
          absoluteExpiresAt: null,
          expiresAt: new Date(),
          cookieExpiresAt: new Date(),
          renewed: false,
        }
      : null,
  );
}

const CHANGES: Array<[string, () => Promise<unknown>]> = [
  [
    'saveEmailServiceConfig',
    () =>
      saveEmailServiceConfig({
        from: 'De Bikefit Studio <afspraken@studio.test>',
        replyTo: '',
        giftVoucherRecipient: 'bestellingen@studio.test',
      }),
  ],
  ['setEmailApiKey', () => setEmailApiKey('re_unit_test_key_0123456789')],
  ['clearEmailApiKey', () => clearEmailApiKey()],
];

const READS: Array<[string, () => Promise<unknown>]> = [
  ['getEmailServiceStatus', () => getEmailServiceStatus()],
  ['sendEmailServiceTest', () => sendEmailServiceTest('beheer@studio.test')],
];

beforeEach(() => {
  vi.clearAllMocks();
  fake.writes.length = 0;
});

describe('e-mail service changes need a recent step-up (direct calls included)', () => {
  it('refuses an MFA-verified admin without one, or with one older than 5 minutes', async () => {
    for (const reauthenticatedAt of [null, minutesAgo(5.5), minutesAgo(60)]) {
      signIn(cmsUser('admin'), { reauthenticatedAt });
      for (const [name, call] of CHANGES) {
        await expect(call(), name).rejects.toMatchObject(refusedFor('reauth_required'));
      }
    }
    // Refused before anything is read, sealed or written.
    expect(fake.writes).toEqual([]);
    expect(stored.readStoredEmailSettings).not.toHaveBeenCalled();
    expect(stored.sealEmailApiKey).not.toHaveBeenCalled();
  });

  it('does not trust a step-up stamp from the future', async () => {
    signIn(cmsUser('admin'), { reauthenticatedAt: new Date(Date.now() + 10 * 60 * 1000) });
    for (const [name, call] of CHANGES) {
      await expect(call(), name).rejects.toMatchObject(refusedFor('reauth_required'));
    }
    expect(fake.writes).toEqual([]);
  });

  it('lets a recent step-up through: each change is written and audited', async () => {
    signIn(cmsUser('admin'), { reauthenticatedAt: minutesAgo(4) });
    for (const [name, call] of CHANGES) {
      await expect(call(), name).resolves.toMatchObject({ ok: true });
    }
    expect(fake.writes.map((row) => row.action).filter(Boolean)).toEqual([
      'email.settings.update',
      'email.key.set',
      'email.key.clear',
    ]);
  });

  it('reading the status and sending the test message need no step-up', async () => {
    signIn(cmsUser('admin'), { reauthenticatedAt: null });
    await expect(getEmailServiceStatus()).resolves.toMatchObject({ storeAvailable: true });
    await expect(sendEmailServiceTest('beheer@studio.test')).resolves.toMatchObject({
      ok: true,
      data: { sent: true },
    });
    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('stays admin-only: editors, providers and visitors are refused, step-up or not', async () => {
    // Editors need no second step; providers do (a provider without it is
    // refused even earlier, as `mfa_required`).
    for (const [role, mfaVerified] of [
      ['editor', false],
      ['provider', true],
    ] as const) {
      signIn(cmsUser(role), { mfaVerified, reauthenticatedAt: minutesAgo(1) });
      for (const [name, call] of [...CHANGES, ...READS]) {
        await expect(call(), `${role} ${name}`).rejects.toMatchObject(refusedFor('forbidden'));
      }
    }
    signIn(cmsUser('provider'), { mfaVerified: false, reauthenticatedAt: minutesAgo(1) });
    for (const [name, call] of [...CHANGES, ...READS]) {
      await expect(call(), `provider ${name}`).rejects.toMatchObject(refusedFor('mfa_required'));
    }
    signIn(null);
    for (const [name, call] of [...CHANGES, ...READS]) {
      await expect(call(), name).rejects.toMatchObject(refusedFor('unauthenticated'));
    }
    expect(fake.writes).toEqual([]);
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it('a fresh stamp never stands in for MFA or a permanent password', async () => {
    signIn(cmsUser('admin'), { mfaVerified: false, reauthenticatedAt: minutesAgo(1) });
    for (const [name, call] of [...CHANGES, ...READS]) {
      await expect(call(), name).rejects.toMatchObject(refusedFor('mfa_required'));
    }
    signIn(cmsUser('admin', true), { reauthenticatedAt: minutesAgo(1) });
    for (const [name, call] of [...CHANGES, ...READS]) {
      await expect(call(), name).rejects.toMatchObject(refusedFor('password_change_required'));
    }
    expect(fake.writes).toEqual([]);
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });
});

describe('a failed key write', () => {
  it('is refused in Dutch, not audited, and logged as a fixed code only', async () => {
    signIn(cmsUser('admin'), { reauthenticatedAt: minutesAgo(1) });
    // Drizzle's error for the upsert: the SQL, then every bound value.
    const failure = Object.assign(
      new Error(
        'Failed query: insert into "cms_integration_settings" ("key", "secret_ciphertext", "secret_hint") values ($1, $2, $3)\nparams: email,v1.iv.tag.ciphertext,6789',
      ),
      { params: ['email', 'v1.iv.tag.ciphertext', '6789'] },
    );
    const insert = vi.spyOn(fake.db, 'insert').mockImplementation(() => ({
      values: () =>
        Object.assign(Promise.resolve(), {
          onConflictDoUpdate: async () => {
            throw failure;
          },
        }),
    }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(setEmailApiKey('re_unit_test_key_0123456789')).resolves.toEqual({
        ok: false,
        message: 'De sleutel kon niet opgeslagen worden. Probeer het opnieuw.',
      });
      expect(log.mock.calls).toEqual([['[email] api_key_store_failed']]);
      // The upsert was the only insert: no audit entry for a key that was not stored.
      expect(insert).toHaveBeenCalledTimes(1);
    } finally {
      insert.mockRestore();
      log.mockRestore();
    }
  });
});
