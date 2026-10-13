import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CmsRole, CmsUserPublic } from '@/db/cms-schema';
import {
  CmsAuthError,
  changePassword,
  createUser,
  listCmsUsers,
  logout,
  requireCmsUser,
  requirePermission,
  resetUserPassword,
  setUserActive,
  setUserRole,
} from './auth';
import { hashPassword } from './password';

/**
 * The guards as server actions call them, with the session lookup mocked: no
 * database, no cookies, no Next runtime. `./session` and `@/db/cms` are
 * replaced, so `getCurrentCmsUser()` resolves whatever `resolveSession` returns
 * here; the decision is the real one from `./guard`. The flow on a real
 * database is covered by `npm run cms:selftest` (section 5b).
 */

const session = vi.hoisted(() => ({
  readSessionCookie: vi.fn(async (): Promise<string | undefined> => undefined),
  resolveSession: vi.fn(async (): Promise<unknown> => null),
  setSessionCookie: vi.fn(async () => {}),
  clearSessionCookie: vi.fn(async () => {}),
  createSession: vi.fn(async () => ({
    id: 'session-2',
    token: 'fresh-token',
    expiresAt: new Date(),
  })),
  revokeSession: vi.fn(async () => {}),
  revokeAllUserSessions: vi.fn(async () => {}),
  toPublicUser: vi.fn((user: unknown) => user),
}));

type Row = Record<string, unknown>;
type FakeQuery = {
  from: () => FakeQuery;
  where: () => FakeQuery;
  orderBy: () => FakeQuery;
  limit: () => Promise<Row[]>;
};

/** Just enough of a Drizzle handle for the paths under test; records writes. */
const fake = vi.hoisted(() => {
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
});

vi.mock('./session', () => session);
vi.mock('@/db/cms', () => ({ getCmsDb: async () => fake.db }));

const SLOW = 30_000;
const TEMPORARY = 'Tijdelijk-Wachtwoord-7';
const CHOSEN = 'Eigen-Wachtwoord-2026';

function cmsUser(role: CmsRole, mustChangePassword: boolean): CmsUserPublic {
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

/** The request carries a valid session for `user` (or no cookie at all). */
function signIn(user: CmsUserPublic | null) {
  session.readSessionCookie.mockResolvedValue(user ? 'cookie-token' : undefined);
  session.resolveSession.mockResolvedValue(
    user ? { user, sessionId: 'session-1', expiresAt: new Date(), renewed: false } : null,
  );
}

const refusedFor = (code: string) => ({ name: 'CmsAuthError', code });

beforeEach(() => {
  vi.clearAllMocks();
  fake.state.rows = [];
  fake.state.updates = [];
  fake.state.inserts = [];
});

describe('requireCmsUser / requirePermission with a temporary password', () => {
  it('refuses the session with password_change_required, whatever the role requirement', async () => {
    signIn(cmsUser('admin', true));
    await expect(requireCmsUser()).rejects.toBeInstanceOf(CmsAuthError);
    await expect(requireCmsUser()).rejects.toMatchObject(refusedFor('password_change_required'));
    for (const role of ['provider', 'editor', 'admin'] as const) {
      await expect(requireCmsUser(role), role).rejects.toMatchObject(
        refusedFor('password_change_required'),
      );
    }
  });

  it('refuses permissions the role does hold', async () => {
    signIn(cmsUser('admin', true));
    for (const permission of [
      'page.read',
      'page.publish',
      'user.manage',
      'booking.manage',
    ] as const) {
      await expect(requirePermission(permission), permission).rejects.toMatchObject(
        refusedFor('password_change_required'),
      );
    }
  });

  it('lets the session through on the explicit allow-path only', async () => {
    const temporary = cmsUser('editor', true);
    signIn(temporary);
    await expect(requireCmsUser(undefined, { allowMustChangePassword: true })).resolves.toBe(
      temporary,
    );
    await expect(requireCmsUser(undefined, {})).rejects.toMatchObject(
      refusedFor('password_change_required'),
    );
  });

  it('keeps the allow-path behind authentication and role checks', async () => {
    signIn(null);
    await expect(
      requireCmsUser(undefined, { allowMustChangePassword: true }),
    ).rejects.toMatchObject(refusedFor('unauthenticated'));
    signIn(cmsUser('editor', true));
    await expect(requireCmsUser('admin', { allowMustChangePassword: true })).rejects.toMatchObject(
      refusedFor('forbidden'),
    );
  });

  it('blocks admin-only user management before anything is written', async () => {
    signIn(cmsUser('admin', true));
    const calls: Array<[string, () => Promise<unknown>]> = [
      ['listCmsUsers', () => listCmsUsers()],
      [
        'createUser',
        () => createUser({ email: 'nieuw@example.com', name: 'Nieuw', role: 'admin' }),
      ],
      ['resetUserPassword', () => resetUserPassword('user-editor')],
      ['setUserRole', () => setUserRole('user-editor', 'admin')],
      ['setUserActive', () => setUserActive('user-editor', false)],
    ];
    for (const [name, call] of calls) {
      await expect(call(), name).rejects.toMatchObject(refusedFor('password_change_required'));
    }
    expect(fake.state.updates).toEqual([]);
    expect(fake.state.inserts).toEqual([]);
    expect(session.revokeAllUserSessions).not.toHaveBeenCalled();
  });
});

describe('requireCmsUser / requirePermission with a permanent password', () => {
  it('behaves as before: role rank, permissions, unauthenticated', async () => {
    const admin = cmsUser('admin', false);
    signIn(admin);
    await expect(requireCmsUser('admin')).resolves.toBe(admin);
    await expect(requirePermission('user.manage')).resolves.toBe(admin);

    signIn(cmsUser('editor', false));
    await expect(requireCmsUser('editor')).resolves.toMatchObject({ role: 'editor' });
    await expect(requireCmsUser('admin')).rejects.toMatchObject(refusedFor('forbidden'));
    await expect(requirePermission('page.publish')).rejects.toMatchObject(refusedFor('forbidden'));

    signIn(null);
    await expect(requireCmsUser()).rejects.toMatchObject(refusedFor('unauthenticated'));
    await expect(requirePermission('page.read')).rejects.toMatchObject(
      refusedFor('unauthenticated'),
    );
  });
});

describe('changePassword: the one write a temporary-password session may make', () => {
  let temporaryHash = '';
  beforeAll(async () => {
    temporaryHash = await hashPassword(TEMPORARY);
  }, SLOW);

  it(
    'clears the flag, revokes every session and issues a fresh cookie',
    async () => {
      const temporary = cmsUser('editor', true);
      signIn(temporary);
      fake.state.rows = [{ ...temporary, passwordHash: temporaryHash }];

      const result = await changePassword({ currentPassword: TEMPORARY, newPassword: CHOSEN });

      expect(result).toEqual({ ok: true, data: true });
      expect(fake.state.updates).toHaveLength(1);
      expect(fake.state.updates[0]).toMatchObject({ mustChangePassword: false });
      expect(String(fake.state.updates[0].passwordHash)).toMatch(/^scrypt\$/);
      expect(session.revokeAllUserSessions).toHaveBeenCalledWith(fake.db, temporary.id);
      expect(session.setSessionCookie).toHaveBeenCalledWith('fresh-token', expect.any(Date));
      expect(fake.state.inserts).toContainEqual(
        expect.objectContaining({ action: 'auth.password_change', userId: temporary.id }),
      );
    },
    SLOW,
  );

  it(
    'refuses a wrong current password and changes nothing',
    async () => {
      const temporary = cmsUser('admin', true);
      signIn(temporary);
      fake.state.rows = [{ ...temporary, passwordHash: temporaryHash }];

      const result = await changePassword({
        currentPassword: 'Verkeerd-Wachtwoord-1',
        newPassword: CHOSEN,
      });

      expect(result).toMatchObject({ ok: false, error: 'invalid_credentials' });
      expect(fake.state.updates).toEqual([]);
      expect(session.setSessionCookie).not.toHaveBeenCalled();
    },
    SLOW,
  );

  it('still needs a session', async () => {
    signIn(null);
    await expect(
      changePassword({ currentPassword: TEMPORARY, newPassword: CHOSEN }),
    ).rejects.toMatchObject(refusedFor('unauthenticated'));
  });
});

describe('logout', () => {
  it('needs no guard, so a temporary-password session can always sign out', async () => {
    signIn(cmsUser('provider', true));
    await expect(logout()).resolves.toBeUndefined();
    expect(session.revokeSession).toHaveBeenCalledWith(fake.db, 'cookie-token');
    expect(session.clearSessionCookie).toHaveBeenCalledTimes(1);
  });
});
