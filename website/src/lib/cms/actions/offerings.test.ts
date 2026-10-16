import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cmsOfferings, cmsOfferingVariants } from '@/db/cms-offering-schema';
import {
  cmsAuditLog,
  cmsBlocks,
  cmsPages,
  cmsServices,
  type CmsRole,
  type CmsUserPublic,
} from '@/db/cms-schema';
import { saveOfferingAction } from './offerings';
import type { ActionState } from './state';

/**
 * Beheer → Aanbod, called directly as a forged POST would: the guard is the
 * real one in `src/lib/offers/repo.ts` (`offering.manage`), the session lookup
 * and the database are doubles (as in `services.test.ts`). On a real database
 * the same flows run in `npm run cms:selftest`, section 14d.
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
        const returning = async () => [{ ...(values as object), id: 'offering-1' }];
        return Object.assign(Promise.resolve(), {
          returning,
          onConflictDoUpdate: () => Object.assign(Promise.resolve(), { returning }),
        });
      },
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => {
        writes.push({ kind: 'update', table, values });
        return { where: async () => {} };
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
const IDLE: ActionState = { ok: null, message: '' };

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

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const PAGE = {
  id: 'page-bikefit',
  slug: 'aanbod/bikefit-huidige-fiets',
  locale: 'nl',
  status: 'draft',
  publishedSnapshot: null,
  title: 'Bikefit – huidige fiets',
};
const service = (id: string, isActive = true) => ({ id, isActive, locale: 'nl' });

/** Volwassene/Jeugd, booked directly, a price for Volwassene only. */
const DIRECT = {
  pageId: PAGE.id,
  isListed: 'on',
  variantMode: 'audience',
  bookingMode: 'direct',
  'service:adult': 'svc-adult',
  'price:adult': '149,50',
  'service:youth': 'svc-youth',
  'price:youth': '',
};

const writesTo = (table: unknown) => fake.writes.filter((write) => write.table === table);

beforeEach(() => {
  vi.clearAllMocks();
  fake.rows.clear();
  fake.reads.length = 0;
  fake.writes.length = 0;
  fake.rows.set(cmsPages, [PAGE]);
  fake.rows.set(cmsBlocks, [{ data: { title: 'Bikefit – huidige fiets' } }]);
  fake.rows.set(cmsServices, [service('svc-adult'), service('svc-youth')]);
});

describe('saveOfferingAction: who may change the offering', () => {
  it('a provider is refused before anything is read or written', async () => {
    signIn(cmsUser('provider'));
    expect(await saveOfferingAction(IDLE, form(DIRECT))).toEqual({
      ok: false,
      message: FORBIDDEN,
    });
    expect(fake.reads).not.toContain(cmsPages);
    expect(fake.writes).toEqual([]);
  });

  it('a signed-out request is refused', async () => {
    expect((await saveOfferingAction(IDLE, form(DIRECT))).ok).toBe(false);
    expect(fake.writes).toEqual([]);
  });

  it.each(['editor', 'admin'] as const)(
    '%s saves: settings, both variants, an audit entry',
    async (role) => {
      signIn(cmsUser(role));
      const result = await saveOfferingAction(IDLE, form(DIRECT));
      expect(result.ok).toBe(true);
      expect(writesTo(cmsOfferings)).toEqual([
        {
          kind: 'insert',
          table: cmsOfferings,
          values: expect.objectContaining({
            pageId: PAGE.id,
            isListed: true,
            bookingMode: 'direct',
            variantMode: 'audience',
            updatedBy: `user-${role}`,
          }),
        },
      ]);
      expect(writesTo(cmsOfferingVariants).map((write) => write.values ?? write.kind)).toEqual([
        { offeringId: 'offering-1', audience: 'adult', serviceId: 'svc-adult', priceCents: 14950 },
        { offeringId: 'offering-1', audience: 'youth', serviceId: 'svc-youth', priceCents: null },
        'delete',
      ]);
      expect(writesTo(cmsAuditLog)).toEqual([
        expect.objectContaining({
          values: expect.objectContaining({
            action: 'offering.update',
            entityType: 'cms_offering',
          }),
        }),
      ]);
      // Never the booking catalogue or the subscriptions.
      expect(writesTo(cmsServices)).toEqual([]);
    },
  );
});

describe('saveOfferingAction: what it refuses (editor)', () => {
  beforeEach(() => signIn(cmsUser('editor')));

  it('direct booking without a service for every variant', async () => {
    const result = await saveOfferingAction(IDLE, form({ ...DIRECT, 'service:youth': '' }));
    expect(result).toEqual({
      ok: false,
      message: 'Kies voor Jeugd de dienst waarmee het online geboekt wordt.',
    });
    expect(fake.writes).toEqual([]);
  });

  it('an inactive service for direct booking', async () => {
    fake.rows.set(cmsServices, [service('svc-adult'), service('svc-youth', false)]);
    const result = await saveOfferingAction(IDLE, form(DIRECT));
    expect(result).toEqual({
      ok: false,
      message: 'Kies een actieve dienst om online te boeken (Beheer → Diensten).',
    });
    expect(fake.writes).toEqual([]);
  });

  it('a service that does not exist', async () => {
    fake.rows.set(cmsServices, [service('svc-adult')]);
    expect(await saveOfferingAction(IDLE, form(DIRECT))).toEqual({
      ok: false,
      message: 'Een gekozen dienst bestaat niet (meer).',
    });
    expect(fake.writes).toEqual([]);
  });

  it('a page that is not an offer page, or has no offer block', async () => {
    fake.rows.set(cmsPages, [{ ...PAGE, slug: 'bikefit' }]);
    expect((await saveOfferingAction(IDLE, form(DIRECT))).message).toBe(
      'Dit aanbod bestaat niet (meer).',
    );
    fake.rows.set(cmsPages, [PAGE]);
    fake.rows.set(cmsBlocks, []);
    expect((await saveOfferingAction(IDLE, form(DIRECT))).message).toBe(
      'Deze pagina heeft geen blok “Dienst (aanbod)”.',
    );
    expect(fake.writes).toEqual([]);
  });

  it('a price that is not an amount, or € 0', async () => {
    expect(
      (await saveOfferingAction(IDLE, form({ ...DIRECT, 'price:adult': 'gratis' }))).message,
    ).toContain('Volwassene: geef de prijs in euro');
    expect(
      (await saveOfferingAction(IDLE, form({ ...DIRECT, 'price:adult': '0' }))).message,
    ).toContain('€ 0');
    expect(fake.writes).toEqual([]);
  });

  it('an enquiry needs no service and may be hidden', async () => {
    const result = await saveOfferingAction(
      IDLE,
      form({
        pageId: PAGE.id,
        variantMode: 'single',
        bookingMode: 'enquiry',
        'service:all': '',
        'price:all': '95',
      }),
    );
    expect(result.ok).toBe(true);
    expect(writesTo(cmsOfferings)[0].values).toMatchObject({
      isListed: false,
      bookingMode: 'enquiry',
      variantMode: 'single',
    });
    expect(writesTo(cmsOfferingVariants)[0].values).toEqual({
      offeringId: 'offering-1',
      audience: 'all',
      serviceId: null,
      priceCents: 9500,
    });
  });
});
