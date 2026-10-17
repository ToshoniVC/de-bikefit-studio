import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cmsOfferings, cmsOfferingVariants } from '@/db/cms-offering-schema';
import { cmsAuditLog, cmsServices, type CmsRole, type CmsUserPublic } from '@/db/cms-schema';
import { saveOfferingAction } from './offerings';
import type { ActionState } from './state';

/**
 * Beheer → Aanbod, called directly as a forged POST would: the guard is the
 * real one in `src/lib/offers/repo.ts` (`offering.manage`, admin), the
 * session lookup and the database are doubles (as in `services.test.ts`). On
 * a real database the same flows run in `npm run cms:selftest`, section 14d.
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

/** A thrown `redirect()` as Next signals it; `unstable_rethrow` passes it on. */
class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}

const fake = vi.hoisted(() => {
  /** Rows per table; a function answers per call (e.g. a row that exists, then no clash). */
  const rows = new Map<unknown, unknown[] | (() => unknown[])>();
  const reads: unknown[] = [];
  const writes: Array<{ kind: string; table: unknown; values?: unknown }> = [];
  let inserted = 0;
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
        return chain(() => {
          const entry = rows.get(table);
          return typeof entry === 'function' ? entry() : (entry ?? []);
        });
      },
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        writes.push({ kind: 'insert', table, values });
        inserted += 1;
        const id = `row-${inserted}`;
        const returning = async () => [{ ...(values as object), id }];
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
  return { rows, reads, writes, db, reset: () => void (inserted = 0) };
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
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof RedirectSignal) throw error;
  },
}));

const FORBIDDEN = 'Je hebt geen toestemming voor deze actie.';
const IDLE: ActionState = { ok: null, message: '' };

function cmsUser(role: CmsRole): CmsUserPublic {
  const at = new Date('2026-10-17T08:00:00Z');
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

/** A new offering: Volwassene/Jeugd, booked directly, a price for Volwassene only. */
const DIRECT = {
  offeringId: '',
  title: 'Bikefit – huidige fiets',
  slug: '',
  category: 'bikefit',
  sortOrder: '20',
  summary: 'Comfortabeler fietsen.',
  contents: 'Een intake.\nEen analyse.',
  isListed: 'on',
  variantMode: 'audience',
  bookingMode: 'direct',
  'duration:adult': '90',
  'buffer:adult': '',
  'price:adult': '149,50',
  'duration:youth': '60',
  'buffer:youth': '10',
  'guardian:youth': 'on',
  'price:youth': '',
};

const writesTo = (table: unknown) => fake.writes.filter((write) => write.table === table);

beforeEach(() => {
  vi.clearAllMocks();
  fake.rows.clear();
  fake.reads.length = 0;
  fake.writes.length = 0;
  fake.reset();
});

describe('saveOfferingAction: who may change the offer', () => {
  it('a provider is refused before anything is read or written', async () => {
    signIn(cmsUser('provider'));
    expect(await saveOfferingAction(IDLE, form(DIRECT))).toEqual({ ok: false, message: FORBIDDEN });
    expect(fake.reads).toEqual([]);
    expect(fake.writes).toEqual([]);
  });

  it('an editor is refused too: the offer writes the booking catalogue', async () => {
    signIn(cmsUser('editor'));
    expect(await saveOfferingAction(IDLE, form(DIRECT))).toEqual({ ok: false, message: FORBIDDEN });
    expect(fake.writes).toEqual([]);
  });

  it('a signed-out request is refused', async () => {
    expect((await saveOfferingAction(IDLE, form(DIRECT))).ok).toBe(false);
    expect(fake.writes).toEqual([]);
  });

  it('the admin creates: the offering row, a service per variant, the variants, an audit entry, then the edit screen', async () => {
    signIn(cmsUser('admin'));
    await expect(saveOfferingAction(IDLE, form(DIRECT))).rejects.toMatchObject({
      url: '/admin/aanbod/row-1?created=1',
    });
    expect(writesTo(cmsOfferings)).toEqual([
      {
        kind: 'insert',
        table: cmsOfferings,
        values: expect.objectContaining({
          locale: 'nl',
          slug: 'bikefit-huidige-fiets',
          title: 'Bikefit – huidige fiets',
          contents: ['Een intake.', 'Een analyse.'],
          isListed: true,
          bookingMode: 'direct',
          variantMode: 'audience',
          updatedBy: 'user-admin',
        }),
      },
    ]);
    expect(writesTo(cmsServices).map((write) => write.values)).toEqual([
      expect.objectContaining({
        slug: 'bikefit-huidige-fiets-volwassene',
        name: 'Bikefit – huidige fiets – Volwassene',
        choiceLabel: 'Volwassene',
        durationMinutes: 90,
        bufferAfterMinutes: null,
        requiresGuardian: false,
        isActive: true,
        createdBy: 'user-admin',
      }),
      expect.objectContaining({
        slug: 'bikefit-huidige-fiets-jeugd',
        choiceLabel: 'Jeugd',
        durationMinutes: 60,
        bufferAfterMinutes: 10,
        requiresGuardian: true,
      }),
    ]);
    expect(writesTo(cmsOfferingVariants).map((write) => write.values ?? write.kind)).toEqual([
      expect.objectContaining({ audience: 'adult', priceCents: 14950 }),
      expect.objectContaining({ audience: 'youth', priceCents: null }),
      'delete',
    ]);
    expect(
      writesTo(cmsAuditLog).map((write) => (write.values as { action: string }).action),
    ).toEqual(['service.create', 'service.create', 'offering.create']);
  });
});

describe('saveOfferingAction: what it refuses (admin)', () => {
  beforeEach(() => signIn(cmsUser('admin')));

  it('direct booking without a duration for every variant', async () => {
    const result = await saveOfferingAction(IDLE, form({ ...DIRECT, 'duration:youth': '' }));
    expect(result).toEqual({
      ok: false,
      message: 'Vul voor Jeugd de duur in om het online te boeken.',
    });
    expect(fake.writes).toEqual([]);
  });

  it('a duration or buffer out of range', async () => {
    expect(
      (await saveOfferingAction(IDLE, form({ ...DIRECT, 'duration:adult': '3' }))).message,
    ).toContain('tussen 5 en 720');
    expect(
      (await saveOfferingAction(IDLE, form({ ...DIRECT, 'buffer:youth': '999' }))).message,
    ).toContain('tussen 0 en 240');
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

  it('a missing title or a malformed slug', async () => {
    expect((await saveOfferingAction(IDLE, form({ ...DIRECT, title: '' }))).message).toBe(
      'Geef het aanbod een titel.',
    );
    expect(
      (await saveOfferingAction(IDLE, form({ ...DIRECT, slug: 'Geen Slug!' }))).message,
    ).toContain('slug');
    expect(fake.writes).toEqual([]);
  });

  it('a slug another offering uses', async () => {
    fake.rows.set(cmsOfferings, [{ id: 'other', slug: 'bikefit-huidige-fiets', locale: 'nl' }]);
    expect((await saveOfferingAction(IDLE, form(DIRECT))).message).toBe(
      'Er bestaat al een aanbod met de slug “bikefit-huidige-fiets”.',
    );
    expect(fake.writes).toEqual([]);
  });

  it('an enquiry needs no duration and may be hidden; an edit keeps the row', async () => {
    const existing = { id: 'off-1', slug: 'coaching', locale: 'nl' };
    let calls = 0;
    // The first read finds the row being edited; the slug check must find no other.
    fake.rows.set(cmsOfferings, () => (calls++ === 0 ? [existing] : []));
    const result = await saveOfferingAction(
      IDLE,
      form({
        offeringId: 'off-1',
        title: 'Coaching',
        slug: 'coaching',
        category: 'begeleiding',
        variantMode: 'single',
        bookingMode: 'enquiry',
        duration: 'Traject in overleg',
        'price:all': '95',
      }),
    );
    expect(result).toEqual({
      ok: true,
      message: 'Aanbod opgeslagen. De website toont het meteen zo.',
    });
    expect(writesTo(cmsOfferings)).toEqual([
      {
        kind: 'update',
        table: cmsOfferings,
        values: expect.objectContaining({
          isListed: false,
          bookingMode: 'enquiry',
          duration: 'Traject in overleg',
        }),
      },
    ]);
    expect(writesTo(cmsServices)).toEqual([]);
    expect(writesTo(cmsOfferingVariants)[0].values).toEqual({
      offeringId: 'off-1',
      audience: 'all',
      serviceId: null,
      priceCents: 9500,
    });
  });
});
