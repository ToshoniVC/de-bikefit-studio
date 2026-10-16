import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cmsAuditLog,
  cmsProviders,
  cmsProviderServices,
  cmsServices,
  type CmsRole,
  type CmsUserPublic,
} from '@/db/cms-schema';
import { setProviderServicesAction } from './providers';
import {
  createServiceAction,
  deactivateServiceAction,
  reactivateServiceAction,
  updateServiceAction,
} from './services';
import type { ActionState } from './state';

/**
 * The service catalogue is the admin's (work block 2026-10-16). These call the
 * server actions directly, as a forged POST would, without the admin screens
 * that no longer offer providers a form. The session lookup and the database
 * are doubles (as in `src/lib/email/repo.test.ts`); the decision is the real
 * guard in `src/lib/booking/repo-services.ts`. On a real database the same flows run in
 * `npm run cms:selftest`, section 14c.
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

/**
 * Just enough of a Drizzle handle: `select().from(table)…` resolves to the rows
 * set for that table; every insert / update / delete is recorded.
 */
const fake = vi.hoisted(() => {
  const rows = new Map<unknown, unknown[]>();
  const reads: unknown[] = [];
  const writes: Array<{ kind: string; table: unknown; values?: unknown }> = [];
  const chain = (result: () => unknown[]) => {
    const query: Record<string, unknown> = {};
    for (const method of ['where', 'limit', 'orderBy', 'groupBy', 'leftJoin', 'innerJoin']) {
      query[method] = () => query;
    }
    query.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject);
    return query;
  };
  const db = {
    select: () => ({
      from: (table: unknown) => {
        reads.push(table);
        return chain(() => rows.get(table) ?? []);
      },
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        writes.push({ kind: 'insert', table, values });
        const done = Object.assign(Promise.resolve(), {
          returning: async () => [{ ...(values as object), id: 'new-id' }],
          onConflictDoUpdate: async () => {},
          onConflictDoNothing: async () => {},
        });
        return done;
      },
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => {
        writes.push({ kind: 'update', table, values });
        const where = () =>
          Object.assign(Promise.resolve(), {
            returning: async () => [{ ...(rows.get(table)?.[0] as object), ...(values as object) }],
          });
        return { where };
      },
    }),
    delete: (table: unknown) => {
      writes.push({ kind: 'delete', table });
      return { where: async () => {} };
    },
  };
  return { rows, reads, writes, db };
});

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
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));

const FORBIDDEN = 'Je hebt geen toestemming voor deze actie.';
const IDLE: ActionState = { ok: false, message: '' };

function cmsUser(role: CmsRole): CmsUserPublic {
  const at = new Date('2026-10-16T08:00:00Z');
  return {
    id: `user-${role}`,
    email: `${role}@example.com`,
    name: role,
    role,
    mustChangePassword: false,
    isActive: true,
    createdAt: at,
    updatedAt: at,
    lastLoginAt: null,
  };
}

function signIn(user: CmsUserPublic) {
  session.readSessionCookie.mockResolvedValue('cookie-token');
  session.resolveSession.mockResolvedValue({
    user,
    sessionId: 'session-1',
    mfaVerified: true,
    reauthenticatedAt: new Date(),
    absoluteExpiresAt: null,
    expiresAt: new Date(),
    cookieExpiresAt: new Date(),
    renewed: false,
  });
}

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const entry of Array.isArray(value) ? value : [value]) data.append(key, entry);
  }
  return data;
}

const provider = cmsUser('provider');

/** A service the provider created before 16 Oct 2026, when providers could. */
const legacyService = {
  id: 'svc-legacy',
  locale: 'nl',
  slug: 'eigen-dienst',
  name: 'Eigen dienst',
  choiceLabel: '',
  description: '',
  durationMinutes: 60,
  bufferAfterMinutes: 15,
  priceCents: null,
  showPrice: false,
  locationId: null,
  requiresGuardian: false,
  isActive: true,
  sortOrder: 0,
  color: null,
  createdBy: provider.id,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const serviceForm = {
  serviceId: legacyService.id,
  name: 'Eigen dienst',
  durationMinutes: '45',
  price: '95',
  showPrice: 'on',
  isActive: 'on',
};

beforeEach(() => {
  vi.clearAllMocks();
  fake.rows.clear();
  fake.reads.length = 0;
  fake.writes.length = 0;
  fake.rows.set(cmsServices, [legacyService]);
});

describe('service actions: a provider never manages the catalogue (direct calls)', () => {
  it('refuses create, even with a price and "show price" in the body', async () => {
    signIn(provider);
    const result = await createServiceAction(
      IDLE,
      form({ name: 'Nieuwe dienst', durationMinutes: '60', price: '120', showPrice: 'on' }),
    );
    expect(result).toEqual({ ok: false, message: FORBIDDEN });
    expect(fake.writes).toEqual([]);
  });

  it('refuses edit, re-price, deactivate and reactivate of a service they created (legacy created_by)', async () => {
    signIn(provider);
    const results = [
      await updateServiceAction(IDLE, form(serviceForm)),
      await deactivateServiceAction(IDLE, form({ serviceId: legacyService.id })),
      await reactivateServiceAction(IDLE, form({ serviceId: legacyService.id })),
    ];
    for (const result of results) expect(result).toEqual({ ok: false, message: FORBIDDEN });
    // Refused on the permission alone: the row (and its `created_by`) is never read.
    expect(fake.reads).not.toContain(cmsServices);
    expect(fake.writes).toEqual([]);
  });

  it('refuses an editor too (read-only catalogue)', async () => {
    signIn(cmsUser('editor'));
    expect(await updateServiceAction(IDLE, form(serviceForm))).toEqual({
      ok: false,
      message: FORBIDDEN,
    });
    expect(fake.writes).toEqual([]);
  });

  it('lets the admin manage it: edit with price, then deactivate (audited)', async () => {
    signIn(cmsUser('admin'));
    expect(await updateServiceAction(IDLE, form(serviceForm))).toEqual({
      ok: true,
      message: 'Dienst opgeslagen.',
    });
    expect(await deactivateServiceAction(IDLE, form({ serviceId: legacyService.id }))).toEqual({
      ok: true,
      message: 'Dienst gedeactiveerd.',
    });
    const updates = fake.writes.filter((write) => write.kind === 'update');
    expect(updates[0]).toMatchObject({
      table: cmsServices,
      values: { priceCents: 9500, showPrice: true, durationMinutes: 45 },
    });
    expect(updates[1]).toMatchObject({ table: cmsServices, values: { isActive: false } });
    expect(fake.writes.filter((write) => write.table === cmsAuditLog)).toHaveLength(2);
  });
});

describe('subscriptions: own profile, active services only', () => {
  const ownProvider = { id: 'prov-own', userId: provider.id };
  const inactive = { id: 'svc-off', isActive: false };
  const active = { id: legacyService.id, isActive: true };

  it('subscribes the own profile to an active service', async () => {
    signIn(provider);
    fake.rows.set(cmsProviders, [ownProvider]);
    fake.rows.set(cmsServices, [active]);
    const result = await setProviderServicesAction(
      IDLE,
      form({ providerId: ownProvider.id, serviceIds: [active.id] }),
    );
    expect(result.ok).toBe(true);
    expect(fake.writes.some((write) => write.table === cmsServices)).toBe(false);
  });

  it('refuses a new subscription to an inactive service', async () => {
    signIn(provider);
    fake.rows.set(cmsProviders, [ownProvider]);
    fake.rows.set(cmsServices, [active, inactive]);
    fake.rows.set(cmsProviderServices, []);
    const result = await setProviderServicesAction(
      IDLE,
      form({ providerId: ownProvider.id, serviceIds: [active.id, inactive.id] }),
    );
    expect(result).toEqual({
      ok: false,
      message: 'Je kunt je enkel inschrijven voor actieve diensten.',
    });
    expect(fake.writes).toEqual([]);
  });

  it('keeps an existing subscription to a service deactivated since', async () => {
    signIn(provider);
    fake.rows.set(cmsProviders, [ownProvider]);
    fake.rows.set(cmsServices, [inactive]);
    fake.rows.set(cmsProviderServices, [{ serviceId: inactive.id }]);
    const result = await setProviderServicesAction(
      IDLE,
      form({ providerId: ownProvider.id, serviceIds: [inactive.id] }),
    );
    expect(result.ok).toBe(true);
  });

  it("refuses another provider's profile", async () => {
    signIn(provider);
    fake.rows.set(cmsProviders, [{ id: 'prov-other', userId: 'user-someone-else' }]);
    fake.rows.set(cmsServices, [active]);
    const result = await setProviderServicesAction(
      IDLE,
      form({ providerId: 'prov-other', serviceIds: [active.id] }),
    );
    expect(result).toEqual({ ok: false, message: FORBIDDEN });
    expect(fake.writes).toEqual([]);
  });
});
