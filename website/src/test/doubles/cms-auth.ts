import { vi } from 'vitest';
import type { CmsRole, CmsUserPublic } from '@/db/cms-schema';

/**
 * Test doubles for the CMS auth unit tests (`src/lib/cms/auth.test.ts`): the
 * session module, just enough of a Drizzle handle, the MFA modules `login()`
 * and the password changes call, and helpers to sign a user in. Test-only:
 * imported by tests, never by app code.
 *
 * Mock factories load this module asynchronously, so the test and the mocked
 * modules share these very objects:
 *
 *     vi.mock('./session', async () => (await import('@/test/doubles/cms-auth')).session);
 */

export const session = {
  readSessionCookie: vi.fn(async (): Promise<string | undefined> => undefined),
  resolveSession: vi.fn(async (): Promise<unknown> => null),
  setSessionCookie: vi.fn(async () => {}),
  clearSessionCookie: vi.fn(async () => {}),
  createSession: vi.fn(async () => ({
    id: 'session-2',
    token: 'fresh-token',
    expiresAt: new Date(),
    cookieExpiresAt: new Date(),
  })),
  revokeSession: vi.fn(async () => {}),
  revokeAllUserSessions: vi.fn(async () => {}),
  toPublicUser: vi.fn((user: unknown) => user),
};

type Row = Record<string, unknown>;
type FakeQuery = {
  from: () => FakeQuery;
  where: () => FakeQuery;
  orderBy: () => FakeQuery;
  limit: () => Promise<Row[]>;
};

/** Just enough of a Drizzle handle for the paths under test; records writes. */
export const fake = (() => {
  const state = {
    rows: [] as Row[],
    updates: [] as Row[],
    inserts: [] as Row[],
  };
  const query: FakeQuery = {
    from: () => query,
    where: () => query,
    orderBy: () => query,
    limit: async () => state.rows,
  };
  const db = {
    select: () => query,
    update: () => ({
      set: (values: Row) => {
        state.updates.push(values);
        return { where: async () => undefined };
      },
    }),
    insert: () => ({
      values: async (values: Row) => {
        state.inserts.push(values);
      },
    }),
    delete: () => ({ where: async () => undefined }),
  };
  return { state, db };
})();

/** `./mfa/challenge` as a whole, plus the one export each of `./mfa/repo` and `./mfa/rate-limit`. */
export const mfa = {
  createMfaChallenge: vi.fn(async () => ({
    id: 'challenge-1',
    token: 'challenge-token',
    expiresAt: new Date(),
  })),
  setChallengeCookie: vi.fn(async () => {}),
  readChallengeCookie: vi.fn(async (): Promise<string | undefined> => undefined),
  resolveMfaChallenge: vi.fn(async (): Promise<unknown> => null),
  deleteMfaChallenge: vi.fn(async () => {}),
  deleteUserMfaChallenges: vi.fn(async () => {}),
  clearChallengeCookie: vi.fn(async () => {}),
  hasConfirmedFactor: vi.fn(async () => false),
  clearMfaAttempts: vi.fn(async () => {}),
};

/** Forgets every call and every row; for `beforeEach`. */
export function resetDoubles() {
  vi.clearAllMocks();
  fake.state.rows = [];
  fake.state.updates = [];
  fake.state.inserts = [];
}

export const ABSOLUTE_END = new Date('2026-10-13T16:00:00Z');
export const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000);

export function cmsUser(role: CmsRole, mustChangePassword: boolean): CmsUserPublic {
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

/**
 * The request carries a valid session for `user` (or no cookie at all). By
 * default the session passed MFA, so the older blocks test what they did,
 * and has no recent step-up (`reauthenticatedAt`).
 */
export function signIn(
  user: CmsUserPublic | null,
  mfaVerified = true,
  reauthenticatedAt: Date | null = null,
) {
  session.readSessionCookie.mockResolvedValue(user ? 'cookie-token' : undefined);
  session.resolveSession.mockResolvedValue(
    user
      ? {
          user,
          sessionId: 'session-1',
          mfaVerified,
          reauthenticatedAt,
          absoluteExpiresAt: ABSOLUTE_END,
          expiresAt: new Date(),
          cookieExpiresAt: ABSOLUTE_END,
          renewed: false,
        }
      : null,
  );
}

/** What `requireCmsUser()` returns for a signed-in `user`. */
export const signedIn = (user: CmsUserPublic, mfaVerified = true) => ({
  ...user,
  mfaVerified,
  reauthenticatedAt: null,
});

export const refusedFor = (code: string) => ({ name: 'CmsAuthError', code });
