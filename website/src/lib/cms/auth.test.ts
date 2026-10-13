import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CmsRole, CmsUserPublic } from '@/db/cms-schema';
import {
  CmsAuthError,
  changePassword,
  login,
  logout,
  requireCmsUser,
  requirePermission,
} from './auth';
import { createUser, listCmsUsers, resetUserPassword, setUserActive, setUserRole } from './users';
import { hashPassword } from './password';

/**
 * The guards as server actions call them, with the session lookup mocked: no
 * database, no cookies, no Next runtime. `./session` and `@/db/cms` are
 * replaced, so `getCurrentCmsUser()` resolves whatever `resolveSession` returns
 * here; the decision is the real one from `./guard`. `./mfa/challenge` and
 * `./mfa/repo` are replaced too, so `login()` can be observed choosing between
 * a challenge and a session. The flow on a real database is covered by
 * `npm run cms:selftest` (sections 5b and 5c).
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
    cookieExpiresAt: new Date(),
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

const mfa = vi.hoisted(() => ({
  createMfaChallenge: vi.fn(async () => ({
    id: 'challenge-1',
    token: 'challenge-token',
    expiresAt: new Date(),
  })),
  setChallengeCookie: vi.fn(async () => {}),
  readChallengeCookie: vi.fn(async (): Promise<string | undefined> => undefined),
  resolveMfaChallenge: vi.fn(async (): Promise<unknown> => null),
  deleteMfaChallenge: vi.fn(async () => {}),
  clearChallengeCookie: vi.fn(async () => {}),
  hasConfirmedFactor: vi.fn(async () => false),
  clearMfaAttempts: vi.fn(async () => {}),
}));

vi.mock('./session', () => session);
vi.mock('./mfa/challenge', () => mfa);
vi.mock('./mfa/repo', () => ({
  hasConfirmedFactor: mfa.hasConfirmedFactor,
  clearMfaAttempts: mfa.clearMfaAttempts,
}));
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

/**
 * The request carries a valid session for `user` (or no cookie at all). By
 * default the session passed MFA, so the older blocks test what they did,
 * and has no recent step-up (`reauthenticatedAt`).
 */
function signIn(
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

const ABSOLUTE_END = new Date('2026-10-13T16:00:00Z');
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000);

const signedIn = (user: CmsUserPublic, mfaVerified = true) => ({
  ...user,
  mfaVerified,
  reauthenticatedAt: null,
});

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
    await expect(requireCmsUser(undefined, { allowMustChangePassword: true })).resolves.toEqual(
      signedIn(temporary),
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
    await expect(requireCmsUser('admin')).resolves.toEqual(signedIn(admin));
    await expect(requirePermission('user.manage')).resolves.toEqual(signedIn(admin));

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

describe('an admin session that did not pass MFA (e.g. from before MFA existed)', () => {
  it('is refused everywhere, the temporary-password opt-in included', async () => {
    for (const mustChangePassword of [false, true]) {
      signIn(cmsUser('admin', mustChangePassword), false);
      await expect(requireCmsUser()).rejects.toMatchObject(refusedFor('mfa_required'));
      await expect(requireCmsUser('admin')).rejects.toMatchObject(refusedFor('mfa_required'));
      await expect(
        requireCmsUser(undefined, { allowMustChangePassword: true }),
      ).rejects.toMatchObject(refusedFor('mfa_required'));
      await expect(requirePermission('page.read')).rejects.toMatchObject(
        refusedFor('mfa_required'),
      );
    }
  });

  it('cannot reach user management, and nothing is written', async () => {
    signIn(cmsUser('admin', false), false);
    const calls: Array<[string, () => Promise<unknown>]> = [
      ['listCmsUsers', () => listCmsUsers()],
      ['createUser', () => createUser({ email: 'x@example.com', name: 'X', role: 'admin' })],
      ['resetUserPassword', () => resetUserPassword('user-editor')],
      ['setUserRole', () => setUserRole('user-editor', 'admin')],
      ['setUserActive', () => setUserActive('user-editor', false)],
    ];
    for (const [name, call] of calls) {
      await expect(call(), name).rejects.toMatchObject(refusedFor('mfa_required'));
    }
    expect(fake.state.updates).toEqual([]);
    expect(fake.state.inserts).toEqual([]);
  });

  it('cannot change the password either (sign in again instead)', async () => {
    signIn(cmsUser('admin', true), false);
    await expect(
      changePassword({ currentPassword: TEMPORARY, newPassword: CHOSEN }),
    ).rejects.toMatchObject(refusedFor('mfa_required'));
    expect(fake.state.updates).toEqual([]);
  });

  it('leaves editors and providers unchanged', async () => {
    for (const role of ['editor', 'provider'] as const) {
      signIn(cmsUser(role, false), false);
      await expect(requireCmsUser(), role).resolves.toMatchObject({ role, mfaVerified: false });
    }
    signIn(cmsUser('editor', false), false);
    await expect(requirePermission('page.update')).resolves.toMatchObject({ role: 'editor' });
  });
});

describe('login(): a password alone never creates an admin session', () => {
  let hash = '';
  beforeAll(async () => {
    hash = await hashPassword(CHOSEN);
  }, SLOW);

  const asStored = (user: CmsUserPublic) => [{ ...user, passwordHash: hash }];

  it(
    'admin: only a challenge (cms_mfa cookie), no session, any old session revoked',
    async () => {
      fake.state.rows = asStored(cmsUser('admin', false));
      session.readSessionCookie.mockResolvedValue('legacy-token');

      const result = await login({ email: 'admin@example.com', password: CHOSEN });

      expect(result).toMatchObject({ ok: true, data: { secondStep: true } });
      expect(mfa.createMfaChallenge).toHaveBeenCalledWith(fake.db, 'user-admin', undefined);
      expect(mfa.setChallengeCookie).toHaveBeenCalledWith('challenge-token', expect.any(Date));
      expect(session.createSession).not.toHaveBeenCalled();
      expect(session.setSessionCookie).not.toHaveBeenCalled();
      expect(session.revokeSession).toHaveBeenCalledWith(fake.db, 'legacy-token');
      expect(session.clearSessionCookie).toHaveBeenCalled();
    },
    SLOW,
  );

  it(
    'editor: a session as before, no challenge',
    async () => {
      fake.state.rows = asStored(cmsUser('editor', false));
      const result = await login({ email: 'editor@example.com', password: CHOSEN });
      expect(result).toMatchObject({ ok: true, data: { secondStep: false } });
      expect(session.createSession).toHaveBeenCalledWith(fake.db, 'user-editor', undefined, {
        reauthenticated: true,
      });
      expect(session.setSessionCookie).toHaveBeenCalledWith('fresh-token', expect.any(Date));
      expect(mfa.createMfaChallenge).not.toHaveBeenCalled();
    },
    SLOW,
  );

  it(
    'editor who kept an authenticator: asked for it too',
    async () => {
      fake.state.rows = asStored(cmsUser('editor', false));
      mfa.hasConfirmedFactor.mockResolvedValueOnce(true);
      const result = await login({ email: 'editor@example.com', password: CHOSEN });
      expect(result).toMatchObject({ ok: true, data: { secondStep: true } });
      expect(session.createSession).not.toHaveBeenCalled();
    },
    SLOW,
  );

  it(
    'wrong password: neither a challenge nor a session',
    async () => {
      fake.state.rows = asStored(cmsUser('admin', false));
      const result = await login({ email: 'admin@example.com', password: 'Verkeerd-Wachtwoord-9' });
      expect(result).toMatchObject({ ok: false, error: 'invalid_credentials' });
      expect(mfa.createMfaChallenge).not.toHaveBeenCalled();
      expect(session.createSession).not.toHaveBeenCalled();
    },
    SLOW,
  );
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
      signIn(temporary, false);
      fake.state.rows = [{ ...temporary, passwordHash: temporaryHash }];

      const result = await changePassword({ currentPassword: TEMPORARY, newPassword: CHOSEN });

      expect(result).toEqual({ ok: true, data: true });
      expect(fake.state.updates).toHaveLength(1);
      expect(fake.state.updates[0]).toMatchObject({ mustChangePassword: false });
      expect(String(fake.state.updates[0].passwordHash)).toMatch(/^scrypt\$/);
      expect(session.revokeAllUserSessions).toHaveBeenCalledWith(fake.db, temporary.id);
      expect(mfa.clearMfaAttempts).toHaveBeenCalledWith(fake.db, temporary.id);
      // An editor session without MFA is replaced by one without MFA; an
      // editor needs no step-up for its own password (the current one is asked).
      expect(session.createSession).toHaveBeenCalledWith(
        fake.db,
        temporary.id,
        {},
        {
          mfaVerified: false,
          replaces: { absoluteExpiresAt: ABSOLUTE_END, reauthenticatedAt: null },
        },
      );
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
      signIn(temporary, true, minutesAgo(1));
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

  it(
    'an admin session that passed MFA gets a fresh session that keeps it, never more',
    async () => {
      const admin = cmsUser('admin', true);
      const steppedUp = minutesAgo(2);
      signIn(admin, true, steppedUp);
      fake.state.rows = [{ ...admin, passwordHash: temporaryHash }];
      const result = await changePassword({ currentPassword: TEMPORARY, newPassword: CHOSEN });
      expect(result).toEqual({ ok: true, data: true });
      // Same absolute end, same step-up time: a password change extends neither.
      expect(session.createSession).toHaveBeenCalledWith(
        fake.db,
        admin.id,
        {},
        {
          mfaVerified: true,
          replaces: { absoluteExpiresAt: ABSOLUTE_END, reauthenticatedAt: steppedUp },
        },
      );
    },
    SLOW,
  );

  it('an admin without a recent step-up is refused before anything is checked or written', async () => {
    for (const reauthenticatedAt of [null, minutesAgo(6)]) {
      signIn(cmsUser('admin', false), true, reauthenticatedAt);
      fake.state.rows = [{ ...cmsUser('admin', false), passwordHash: temporaryHash }];
      await expect(
        changePassword({ currentPassword: TEMPORARY, newPassword: CHOSEN }),
      ).rejects.toMatchObject(refusedFor('reauth_required'));
    }
    expect(fake.state.updates).toEqual([]);
    expect(session.revokeAllUserSessions).not.toHaveBeenCalled();
    expect(session.createSession).not.toHaveBeenCalled();
  });

  it('still needs a session', async () => {
    signIn(null);
    await expect(
      changePassword({ currentPassword: TEMPORARY, newPassword: CHOSEN }),
    ).rejects.toMatchObject(refusedFor('unauthenticated'));
  });
});

describe('user management needs a recent step-up (direct calls included)', () => {
  const calls: Array<[string, () => Promise<unknown>]> = [
    ['createUser', () => createUser({ email: 'x@example.com', name: 'X', role: 'admin' })],
    ['resetUserPassword', () => resetUserPassword('user-editor')],
    ['setUserRole', () => setUserRole('user-editor', 'admin')],
    ['setUserActive', () => setUserActive('user-editor', false)],
  ];

  it('refuses an MFA-verified admin without one, or with one older than 5 minutes', async () => {
    for (const reauthenticatedAt of [null, minutesAgo(5.5), minutesAgo(60)]) {
      signIn(cmsUser('admin', false), true, reauthenticatedAt);
      for (const [name, call] of calls) {
        await expect(call(), name).rejects.toMatchObject(refusedFor('reauth_required'));
      }
    }
    expect(fake.state.updates).toEqual([]);
    expect(fake.state.inserts).toEqual([]);
    expect(session.revokeAllUserSessions).not.toHaveBeenCalled();
  });

  it('does not trust a step-up stamp from the future', async () => {
    signIn(cmsUser('admin', false), true, new Date(Date.now() + 10 * 60 * 1000));
    await expect(setUserActive('user-editor', false)).rejects.toMatchObject(
      refusedFor('reauth_required'),
    );
  });

  it('reports forbidden, not reauth_required, to an editor', async () => {
    signIn(cmsUser('editor', false), false, minutesAgo(1));
    for (const [name, call] of calls) {
      await expect(call(), name).rejects.toMatchObject(refusedFor('forbidden'));
    }
  });

  it('lets a recent step-up through; plain admin access never needs one', async () => {
    signIn(cmsUser('admin', false), true, minutesAgo(4));
    await expect(setUserActive('user-editor', false)).resolves.toEqual({ ok: true, data: true });
    expect(session.revokeAllUserSessions).toHaveBeenCalledWith(fake.db, 'user-editor');
    signIn(cmsUser('admin', false), true, null);
    await expect(requireCmsUser('admin')).resolves.toMatchObject({ role: 'admin' });
  });
});

describe('logout', () => {
  it('needs no guard, so a temporary-password session can always sign out', async () => {
    signIn(cmsUser('provider', true));
    await expect(logout()).resolves.toBeUndefined();
    expect(session.revokeSession).toHaveBeenCalledWith(fake.db, 'cookie-token');
    expect(session.clearSessionCookie).toHaveBeenCalledTimes(1);
  });

  it('also forgets a half-finished MFA challenge of this browser', async () => {
    signIn(null);
    mfa.readChallengeCookie.mockResolvedValueOnce('challenge-token');
    mfa.resolveMfaChallenge.mockResolvedValueOnce({ id: 'challenge-1' });
    await logout();
    expect(mfa.deleteMfaChallenge).toHaveBeenCalledWith(fake.db, 'challenge-1');
    expect(mfa.clearChallengeCookie).toHaveBeenCalledTimes(1);
  });
});
