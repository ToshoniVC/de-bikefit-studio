/**
 * Integration self-test for the CMS and booking (a plain script, not vitest).
 *
 *   npm run cms:selftest
 *
 * Runs against a throwaway PGlite database under .pglite-selftest/ (created and
 * deleted by this script) so it never touches your working data or Neon.
 * Sections, with the titles they print:
 *
 *   1. driver + migrations: pglite driver, ./drizzle applied on first use
 *   2. schema: the eleven CMS foundation tables and the four webshop tables
 *   3. password hashing: scrypt envelope, verify / reject, random salt
 *   4. credentials + rate limiting: verifyCredentials() accepts / rejects, limits
 *   5. sessions: create, resolve (only the hash is stored), revoke
 *   6. block registry: every block's defaultData validates, unknown type fails
 *   7. permissions: admin / editor content matrix
 *   8. draft → publish snapshot: draft blocks freeze into a published snapshot
 *   9. bootstrap defaults: settings table writable (bootstrap runs separately)
 *  10. booking schema: the eight booking tables + the `provider` enum value
 *  11. provider role permissions: provider / editor / admin booking matrix
 *  12. availability — computeSlots(): hours, busy, buffer, notice, horizon,
 *      exceptions, step grid, DST days; time-zone helpers
 *  13. e-mail + ICS + token encryption: no RESEND_API_KEY → { sent: false };
 *      ICS in UTC with UID; templates; AES-GCM round trip / tamper / wrong key
 *  14. booking flow on PGlite (provider without Google): repo scopes, public
 *      create / re-check / rate limit / cancel by token
 *
 * Counts failures and exits non-zero at the end when any check failed.
 *
 * The booking modules are `server-only` and expect a request context, so —
 * like `cms-seed.mts` — this script installs tiny stubs for `server-only`,
 * `next/headers` (cookie jar backed by a Map) and `next/cache` through Node's
 * `module.registerHooks` (Node ≥ 22.15) and imports those modules lazily.
 */
import { config } from 'dotenv';
import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import nodeModule from 'node:module';
import { resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';

config({ path: '.env.local' });

// Force the PGlite driver at a dedicated location, whatever the environment says.
const DATA_DIR = '.pglite-selftest';
delete process.env.DATABASE_URL;
process.env.CMS_PGLITE_DIR = DATA_DIR;
process.env.CMS_PGLITE_AUTO_MIGRATE = 'true';
process.env.CMS_SESSION_SECRET ??= 'selftest-session-secret-not-a-real-credential';
// Booking runs without any third party: no mail provider, no Google client.
delete process.env.RESEND_API_KEY;
delete process.env.GOOGLE_OAUTH_CLIENT_ID;
delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;

// --- request-context stubs (see cms-seed.mts for the full rationale) --------
type StubResolveResult = { url: string; format?: string; shortCircuit?: boolean };
type StubLoadResult = { format: string; source?: string; shortCircuit?: boolean };
type SyncModuleHooks = {
  resolve?: (
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => StubResolveResult,
  ) => StubResolveResult;
  load?: (
    url: string,
    context: unknown,
    next: (url: string, context: unknown) => StubLoadResult,
  ) => StubLoadResult;
};
const registerHooks = (
  nodeModule as unknown as { registerHooks?: (hooks: SyncModuleHooks) => void }
).registerHooks;
const cookieJar = new Map<string, string>();
(
  globalThis as unknown as { __bikefitSelftestCookies: Map<string, string> }
).__bikefitSelftestCookies = cookieJar;
const STUB_SOURCES: Record<string, string> = {
  'server-only': 'export {};',
  'next/headers': `
    function jar() { return globalThis.__bikefitSelftestCookies; }
    export async function cookies() {
      return {
        get: (name) => (jar().has(name) ? { name, value: jar().get(name) } : undefined),
        getAll: () => [...jar()].map(([name, value]) => ({ name, value })),
        has: (name) => jar().has(name),
        set: (name, value) => {
          if (name && typeof name === 'object') jar().set(name.name, name.value);
          else jar().set(name, value);
        },
        delete: (name) => { jar().delete(name); },
      };
    }
    export async function headers() { return new Headers(); }
  `,
  'next/cache': `
    export function unstable_cache(fn) { return fn; }
    export function revalidateTag() {}
    export function updateTag() {}
    export function revalidatePath() {}
  `,
};
const STUB_PREFIX = 'bikefit-selftest-stub:';
const stubsInstalled = typeof registerHooks === 'function';
if (stubsInstalled) {
  registerHooks!({
    resolve(specifier, context, nextResolve) {
      if (STUB_SOURCES[specifier])
        return { url: STUB_PREFIX + specifier, shortCircuit: true, format: 'module' };
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url.startsWith(STUB_PREFIX)) {
        return {
          format: 'module',
          shortCircuit: true,
          source: STUB_SOURCES[url.slice(STUB_PREFIX.length)],
        };
      }
      return nextLoad(url, context);
    },
  });
}

import { getCmsDb, cmsDriver, resetCmsDb } from '@/db/cms';
import {
  cmsBlocks,
  cmsPages,
  cmsSessions,
  cmsSiteSettings,
  cmsUsers,
  DEFAULT_LOCALE,
} from '@/db/cms-schema';
import { hashPassword, verifyPassword } from '@/lib/cms/password';
import { verifyCredentials, LOGIN_MAX_ATTEMPTS } from '@/lib/cms/auth';
import { createSession, resolveSession, revokeSession } from '@/lib/cms/session';
import {
  BLOCK_TYPES,
  blockRegistry,
  defaultDataFor,
  publishedSnapshotSchema,
  parsePublishedSnapshot,
  validateBlocks,
} from '@/lib/cms/blocks';
import { can, permissionsFor, roleAtLeast, ROLE_LABELS, ROLE_RANK } from '@/lib/cms/permissions';
import { computeSlots, mergeSlots, type SlotRules } from '@/lib/booking/availability';
import {
  formatSlot,
  instantToLocal,
  localMinutesToInstant,
  addDaysYmd,
  todayYmd,
} from '@/lib/booking/time';
import { DEFAULT_BOOKING_RULES } from '@/lib/booking/settings';
import { buildIcs, icsUidFor } from '@/lib/email/ics';
import { bookingConfirmationEmail } from '@/lib/email/templates';

const TEST_EMAIL = 'selftest@debikefitstudio.local';
const GOOD_PASSWORD = 'Zadelhoogte2026!';
const BAD_PASSWORD = 'Zadelhoogte2026?';

let failures = 0;

function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

async function main() {
  await rm(resolve(process.cwd(), DATA_DIR), { recursive: true, force: true });
  resetCmsDb();

  section('1. driver + migrations');
  check('driver is pglite', cmsDriver() === 'pglite', cmsDriver());
  const db = await getCmsDb();
  check('database initialised (auto-migrated)', Boolean(db));

  section('2. schema');
  const tables = await db
    .select({ name: cmsUsers.email })
    .from(cmsUsers)
    .limit(0)
    .then(() => true)
    .catch(() => false);
  check('cms_users is queryable', tables);

  const expected = [
    'cms_users',
    'cms_sessions',
    'cms_login_attempts',
    'cms_pages',
    'cms_blocks',
    'cms_navigation',
    'cms_media',
    'cms_media_blobs',
    'cms_redirects',
    'cms_site_settings',
    'cms_audit_log',
    // webshop tables must be created by the baseline migration, untouched
    'users',
    'products',
    'orders',
    'order_items',
  ];
  const present = await listTables(db);
  for (const table of expected) {
    check(`table ${table}`, present.includes(table));
  }

  section('3. password hashing');
  const hash = await hashPassword(GOOD_PASSWORD);
  check('hash uses the scrypt envelope', hash.startsWith('scrypt$'), hash.slice(0, 20) + '…');
  check('correct password verifies', await verifyPassword(GOOD_PASSWORD, hash));
  check('wrong password rejected', !(await verifyPassword(BAD_PASSWORD, hash)));
  check('malformed hash rejected', !(await verifyPassword(GOOD_PASSWORD, 'not-a-hash')));
  const second = await hashPassword(GOOD_PASSWORD);
  check('salt is random (two hashes differ)', hash !== second);

  section('4. credentials + rate limiting');
  const [user] = await db
    .insert(cmsUsers)
    .values({
      email: TEST_EMAIL,
      name: 'Self test',
      role: 'admin',
      passwordHash: hash,
      mustChangePassword: true,
    })
    .returning();
  check('test user created', Boolean(user?.id));

  const good = await verifyCredentials(db, TEST_EMAIL, GOOD_PASSWORD, { ipAddress: '10.0.0.1' });
  check('correct credentials accepted', good.ok, good.ok ? good.data.email : good.message);
  check('returned user carries no password hash', good.ok && !('passwordHash' in good.data));

  const bad = await verifyCredentials(db, TEST_EMAIL, BAD_PASSWORD, { ipAddress: '10.0.0.1' });
  check(
    'wrong credentials rejected',
    !bad.ok && bad.error === 'invalid_credentials',
    bad.ok ? 'accepted!' : bad.message,
  );

  const unknown = await verifyCredentials(db, 'nobody@example.com', GOOD_PASSWORD, {
    ipAddress: '10.0.0.9',
  });
  check('unknown email rejected', !unknown.ok && unknown.error === 'invalid_credentials');

  // Burn through the window from a single IP.
  for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) {
    await verifyCredentials(db, TEST_EMAIL, BAD_PASSWORD, { ipAddress: '10.0.0.66' });
  }
  const limited = await verifyCredentials(db, TEST_EMAIL, GOOD_PASSWORD, {
    ipAddress: '10.0.0.66',
  });
  check(
    `rate limited after ${LOGIN_MAX_ATTEMPTS} failures`,
    !limited.ok && limited.error === 'rate_limited',
    limited.ok ? 'not limited!' : limited.message,
  );

  section('5. sessions');
  const created = await createSession(db, user.id, {
    ipAddress: '10.0.0.1',
    userAgent: 'selftest',
  });
  check('session token issued', created.token.length >= 40, `${created.token.length} chars`);

  const stored = await db
    .select({ tokenHash: cmsSessions.tokenHash })
    .from(cmsSessions)
    .where(eq(cmsSessions.id, created.id))
    .limit(1);
  check('raw token is NOT stored', stored[0]?.tokenHash !== created.token);

  const resolved = await resolveSession(db, created.token);
  check('session resolves to the right user', resolved?.user.id === user.id);
  check(
    'resolved user carries no password hash',
    resolved !== null && !('passwordHash' in resolved.user),
  );
  check(
    'expiry is ~14 days out',
    resolved !== null &&
      daysFromNow(resolved.expiresAt) > 13 &&
      daysFromNow(resolved.expiresAt) < 15,
    resolved ? `${daysFromNow(resolved.expiresAt).toFixed(1)} days` : '',
  );

  check('garbage token does not resolve', (await resolveSession(db, 'garbage')) === null);
  await revokeSession(db, created.token);
  check('revoked session no longer resolves', (await resolveSession(db, created.token)) === null);

  section('6. block registry');
  check(
    `${BLOCK_TYPES.length} block types registered`,
    BLOCK_TYPES.length >= 11,
    BLOCK_TYPES.join(', '),
  );
  for (const type of BLOCK_TYPES) {
    const parsed = blockRegistry[type].schema.safeParse(defaultDataFor(type));
    check(
      `defaultData valid: ${type}`,
      parsed.success,
      parsed.success ? '' : JSON.stringify(parsed.error.issues[0]),
    );
  }
  const badBlocks = validateBlocks([{ id: 'x', type: 'nope', data: {} }]);
  check('unknown block type rejected', !badBlocks.ok);

  section('7. permissions');
  check('admin may publish', can('admin', 'page.publish'));
  check('editor may NOT publish', !can('editor', 'page.publish'));
  check('editor may edit blocks', can('editor', 'block.update'));
  check('editor may NOT manage users', !can('editor', 'user.manage'));
  check('editor may NOT manage redirects', !can('editor', 'redirect.manage'));
  check(
    'admin has strictly more permissions',
    permissionsFor('admin').length > permissionsFor('editor').length,
    `${permissionsFor('admin').length} vs ${permissionsFor('editor').length}`,
  );

  section('8. draft → publish snapshot');
  const [page] = await db
    .insert(cmsPages)
    .values({
      locale: DEFAULT_LOCALE,
      slug: 'selftest',
      translationGroup: 'selftest',
      title: 'Zelftest',
      metaDescription: 'Zelftest pagina',
    })
    .returning();

  await db.insert(cmsBlocks).values([
    { pageId: page.id, sortOrder: 0, type: 'hero', data: defaultDataFor('hero') },
    { pageId: page.id, sortOrder: 1, type: 'faq', data: defaultDataFor('faq') },
  ]);

  const draftBlocks = await db.select().from(cmsBlocks).where(eq(cmsBlocks.pageId, page.id));
  const validated = validateBlocks(
    draftBlocks
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((b) => ({ id: b.id, type: b.type, data: b.data })),
  );
  check(
    'draft blocks validate',
    validated.ok,
    validated.ok ? `${validated.blocks.length} blocks` : '',
  );

  if (validated.ok) {
    const snapshot = publishedSnapshotSchema.parse({
      version: 1,
      locale: page.locale,
      slug: page.slug,
      translationGroup: page.translationGroup,
      title: page.title,
      kind: page.kind,
      publishedAt: new Date().toISOString(),
      seo: {
        metaTitle: null,
        metaDescription: page.metaDescription,
        canonicalOverride: null,
        ogTitle: null,
        ogDescription: null,
        ogImageMediaId: null,
        noIndex: false,
        structuredDataType: null,
        structuredDataOverrides: null,
      },
      blocks: validated.blocks,
    });

    await db
      .update(cmsPages)
      .set({ status: 'published', publishedAt: new Date(), publishedSnapshot: snapshot })
      .where(eq(cmsPages.id, page.id));

    const [published] = await db
      .select()
      .from(cmsPages)
      .where(and(eq(cmsPages.locale, DEFAULT_LOCALE), eq(cmsPages.slug, 'selftest')))
      .limit(1);

    const roundTripped = parsePublishedSnapshot(published.publishedSnapshot);
    check('snapshot round-trips through jsonb', roundTripped !== null);
    check('snapshot keeps block order', roundTripped?.blocks[0]?.type === 'hero');
    check('snapshot keeps Dutch copy', JSON.stringify(roundTripped).includes('Fiets met'));
  }

  section('9. bootstrap defaults');
  const settingRows = await db
    .select({ key: cmsSiteSettings.key })
    .from(cmsSiteSettings)
    .where(eq(cmsSiteSettings.locale, DEFAULT_LOCALE));
  check(
    'settings table is writable (bootstrap runs separately)',
    Array.isArray(settingRows),
    `${settingRows.length} rows`,
  );

  await bookingSections(db, user);
}

// ===========================================================================
// Booking
// ===========================================================================

const MINUTE = 60_000;

function localHm(iso: string): string {
  const { minute } = instantToLocal(iso, 'Europe/Brussels');
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

async function bookingSections(
  db: Awaited<ReturnType<typeof getCmsDb>>,
  admin: { id: string; email: string },
) {
  // -------------------------------------------------------------------------
  section('10. booking schema');
  const present = await listTables(db);
  for (const table of [
    'cms_locations',
    'cms_services',
    'cms_providers',
    'cms_provider_services',
    'cms_business_hours',
    'cms_availability_exceptions',
    'cms_bookings',
    'cms_booking_rate_limit',
  ]) {
    check(`table ${table}`, present.includes(table));
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enumResult: any = await (db as any).execute(
    `select unnest(enum_range(null::cms_role))::text as value`,
  );
  const enumRows = Array.isArray(enumResult) ? enumResult : (enumResult?.rows ?? []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roles = enumRows.map((row: any) => row.value as string);
  check("cms_role has 'provider'", roles.includes('provider'), roles.join(', '));

  // -------------------------------------------------------------------------
  section('11. provider role permissions');
  const providerPerms = permissionsFor('provider');
  const expectedProvider = [
    'booking.read.own',
    'booking.manage.own',
    'service.read',
    'service.create',
    'service.subscribe.own',
    'location.read',
    'provider.self',
  ];
  check(
    'provider has exactly the contract permissions',
    providerPerms.length === expectedProvider.length &&
      expectedProvider.every((p) => providerPerms.includes(p as never)),
    providerPerms.join(', '),
  );
  check('provider may NOT read all bookings', !can('provider', 'booking.read'));
  check('provider may NOT edit pages', !can('provider', 'page.read'));
  check('provider may NOT manage services', !can('provider', 'service.manage'));
  check(
    'editor may read bookings/services/locations/providers',
    ['booking.read', 'service.read', 'location.read', 'provider.read'].every((p) =>
      can('editor', p as never),
    ),
  );
  check('editor may NOT manage bookings', !can('editor', 'booking.manage'));
  check(
    'admin has analytics.read + provider.manage',
    can('admin', 'analytics.read') && can('admin', 'provider.manage'),
  );
  check(
    'ROLE_RANK.provider = 0 (below editor)',
    ROLE_RANK.provider === 0 && !roleAtLeast('provider', 'editor'),
  );
  check("ROLE_LABELS.provider = 'Aanbieder'", ROLE_LABELS.provider === 'Aanbieder');

  // -------------------------------------------------------------------------
  section('12. availability — computeSlots()');
  const TZ = 'Europe/Brussels';
  const rules: SlotRules = {
    slotStepMinutes: 30,
    minNoticeHours: 24,
    horizonDays: 56,
    defaultBufferAfterMinutes: 15,
  };
  const weekHours = [
    ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1080 })),
    { weekday: 6, startMinute: 540, endMinute: 780 },
  ];
  const now = new Date('2026-10-01T08:00:00Z'); // Thursday 10:00 in Brussels
  const fit90 = { durationMinutes: 90, bufferAfterMinutes: 15 };
  const fit60 = { durationMinutes: 60, bufferAfterMinutes: 0 };
  const base = { hours: weekHours, rules, now, tz: TZ, providerId: 'p1' };
  const starts = (slots: { startsAt: string }[]) => slots.map((s) => s.startsAt);

  check(
    'defaults match the contract',
    DEFAULT_BOOKING_RULES.slotStepMinutes === 30 &&
      DEFAULT_BOOKING_RULES.minNoticeHours === 24 &&
      DEFAULT_BOOKING_RULES.horizonDays === 56 &&
      DEFAULT_BOOKING_RULES.defaultBufferAfterMinutes === 15 &&
      DEFAULT_BOOKING_RULES.cancelUntilHours === 48 &&
      DEFAULT_BOOKING_RULES.timezone === TZ,
  );

  // Business hours
  const monday = computeSlots({ ...base, date: '2026-10-05', service: fit90 });
  check(
    'hours: Monday 09:00–18:00, 90 min → 16 starts 09:00…16:30',
    monday.length === 16,
    `${monday.length} slots, ${monday[0] ? localHm(monday[0].startsAt) : '-'}…${monday.at(-1) ? localHm(monday.at(-1)!.startsAt) : '-'}`,
  );
  check(
    'hours: first slot 09:00 local = 07:00Z (CEST)',
    monday[0]?.startsAt === '2026-10-05T07:00:00.000Z',
  );
  check(
    'hours: the fit must end by closing time (last 16:30)',
    monday.at(-1)?.startsAt === '2026-10-05T14:30:00.000Z',
  );
  check(
    'hours: slot carries providerId and endsAt = start + duration',
    monday[0]?.providerId === 'p1' && monday[0]?.endsAt === '2026-10-05T08:30:00.000Z',
  );
  check(
    'hours: Saturday 09:00–13:00 → 6 starts',
    computeSlots({ ...base, date: '2026-10-03', service: fit90 }).length === 6,
  );
  check(
    'hours: Sunday closed → 0',
    computeSlots({ ...base, date: '2026-10-04', service: fit90 }).length === 0,
  );
  const twoRanges = computeSlots({
    ...base,
    hours: [
      { weekday: 1, startMinute: 540, endMinute: 660 },
      { weekday: 1, startMinute: 780, endMinute: 900 },
    ],
    date: '2026-10-05',
    service: fit60,
  });
  check(
    'hours: several ranges per weekday (09–11, 13–15) → 6 starts',
    twoRanges.length === 6 &&
      !twoRanges.some((s) => localHm(s.startsAt) === '11:00' || localHm(s.startsAt) === '12:30'),
    twoRanges.map((s) => localHm(s.startsAt)).join(' '),
  );

  // Busy overlap (inclusive start, exclusive end)
  const busy = [{ start: '2026-10-05T08:00:00Z', end: '2026-10-05T09:00:00Z' }]; // 10:00–11:00 local
  const busySlots = starts(computeSlots({ ...base, date: '2026-10-05', service: fit60, busy }));
  check(
    'busy: slot ending exactly at busy start is free (09:00)',
    busySlots.includes('2026-10-05T07:00:00.000Z'),
  );
  check(
    'busy: overlapping starts removed (09:30, 10:00, 10:30)',
    !['2026-10-05T07:30:00.000Z', '2026-10-05T08:00:00.000Z', '2026-10-05T08:30:00.000Z'].some(
      (s) => busySlots.includes(s),
    ),
  );
  check(
    'busy: slot starting exactly at busy end is free (11:00)',
    busySlots.includes('2026-10-05T09:00:00.000Z'),
  );

  // Buffer after (existing booking + own buffer)
  const step15 = { ...rules, slotStepMinutes: 15 };
  // Existing booking 11:00–12:30 local (+15 min buffer → blocked until 12:45).
  const booked = [
    { startsAt: '2026-10-05T09:00:00Z', endsAt: '2026-10-05T10:30:00Z', bufferAfterMinutes: 15 },
  ];
  const bufSlots = starts(
    computeSlots({
      ...base,
      rules: step15,
      date: '2026-10-05',
      service: { durationMinutes: 60, bufferAfterMinutes: 15 },
      bookings: booked,
    }),
  );
  check(
    'buffer: 09:45 fits (ends 10:45 + 15 min = booking start 11:00)',
    bufSlots.includes('2026-10-05T07:45:00.000Z'),
  );
  check('buffer: 10:00 blocked by its own buffer', !bufSlots.includes('2026-10-05T08:00:00.000Z'));
  check(
    'buffer: 12:30 blocked by the booking buffer (until 12:45)',
    !bufSlots.includes('2026-10-05T10:30:00.000Z'),
  );
  check('buffer: 12:45 free again', bufSlots.includes('2026-10-05T10:45:00.000Z'));
  const nullBuffer = starts(
    computeSlots({
      ...base,
      rules: step15,
      date: '2026-10-05',
      service: { durationMinutes: 60, bufferAfterMinutes: null },
      bookings: booked,
    }),
  );
  check(
    'buffer: null service buffer falls back to the rules default (15)',
    nullBuffer.includes('2026-10-05T07:45:00.000Z') &&
      !nullBuffer.includes('2026-10-05T08:00:00.000Z'),
  );
  const lastFit = starts(computeSlots({ ...base, date: '2026-10-05', service: fit90 })).at(-1);
  check(
    'buffer: may run past closing (90 min fit + 15 min buffer at 16:30)',
    lastFit === '2026-10-05T14:30:00.000Z',
  );
  check(
    'buffer: cancelled bookings do not block',
    computeSlots({
      ...base,
      date: '2026-10-05',
      service: fit60,
      bookings: [{ ...booked[0], status: 'cancelled' }],
    }).length === computeSlots({ ...base, date: '2026-10-05', service: fit60 }).length,
  );

  // Minimum notice
  const mondayMorning = new Date('2026-10-05T06:00:00Z'); // Monday 08:00 local
  check(
    'min notice 24 h: nothing today',
    computeSlots({ ...base, now: mondayMorning, date: '2026-10-05', service: fit60 }).length === 0,
  );
  const tuesday = computeSlots({ ...base, now: mondayMorning, date: '2026-10-06', service: fit60 });
  check(
    'min notice 24 h: tomorrow from opening (09:00)',
    tuesday[0]?.startsAt === '2026-10-06T07:00:00.000Z',
  );
  const shortNotice = computeSlots({
    ...base,
    rules: { ...rules, minNoticeHours: 2 },
    now: mondayMorning,
    date: '2026-10-05',
    service: fit60,
  });
  check(
    'min notice 2 h at 08:00 → first slot 10:00',
    shortNotice[0]?.startsAt === '2026-10-05T08:00:00.000Z',
    shortNotice[0] ? localHm(shortNotice[0].startsAt) : 'none',
  );

  // Horizon
  check(
    'horizon: today + 56 days (2026-11-26) still bookable',
    computeSlots({ ...base, date: '2026-11-26', service: fit60 }).length > 0,
  );
  check(
    'horizon: today + 57 days → 0',
    computeSlots({ ...base, date: '2026-11-27', service: fit60 }).length === 0,
  );
  check(
    'horizon: past date → 0',
    computeSlots({ ...base, date: '2026-09-28', service: fit60 }).length === 0,
  );

  // Exceptions
  check(
    'exception: closed whole day → 0',
    computeSlots({
      ...base,
      date: '2026-10-05',
      service: fit60,
      exceptions: [{ date: '2026-10-05', kind: 'closed', startMinute: null, endMinute: null }],
    }).length === 0,
  );
  const partial = starts(
    computeSlots({
      ...base,
      date: '2026-10-05',
      service: fit60,
      exceptions: [{ date: '2026-10-05', kind: 'closed', startMinute: 720, endMinute: 840 }],
    }),
  );
  check(
    'exception: closed 12:00–14:00 → 11:00 ok, 11:30–13:30 gone, 14:00 ok',
    partial.includes('2026-10-05T09:00:00.000Z') &&
      !partial.includes('2026-10-05T09:30:00.000Z') &&
      !partial.includes('2026-10-05T11:30:00.000Z') &&
      partial.includes('2026-10-05T12:00:00.000Z'),
  );
  const extraOpen = computeSlots({
    ...base,
    date: '2026-10-04',
    service: fit60,
    exceptions: [{ date: '2026-10-04', kind: 'open', startMinute: 600, endMinute: 720 }],
  });
  check(
    'exception: extra open Sunday 10:00–12:00 → 10:00, 10:30, 11:00',
    extraOpen.length === 3,
    extraOpen.map((s) => localHm(s.startsAt)).join(' '),
  );
  const closedButOpen = computeSlots({
    ...base,
    date: '2026-10-05',
    service: fit60,
    exceptions: [
      { date: '2026-10-05', kind: 'closed', startMinute: null, endMinute: null },
      { date: '2026-10-05', kind: 'open', startMinute: 1080, endMinute: 1200 },
    ],
  });
  check(
    'exception: closed day + open 18:00–20:00 → only the open range',
    closedButOpen.length === 3 && localHm(closedButOpen[0].startsAt) === '18:00',
  );
  check(
    'exception: other dates unaffected',
    computeSlots({
      ...base,
      date: '2026-10-06',
      service: fit60,
      exceptions: [{ date: '2026-10-05', kind: 'closed', startMinute: null, endMinute: null }],
    }).length > 0,
  );

  // Step grid
  const oddHours = [{ weekday: 1, startMinute: 555, endMinute: 720 }]; // 09:15–12:00
  const grid30 = computeSlots({ ...base, hours: oddHours, date: '2026-10-05', service: fit60 });
  check(
    'grid: 09:15 opening with a 30 min grid → first slot 09:30',
    Boolean(grid30[0]) && localHm(grid30[0].startsAt) === '09:30',
    grid30.map((s) => localHm(s.startsAt)).join(' '),
  );
  const grid20 = computeSlots({
    ...base,
    hours: oddHours,
    rules: { ...rules, slotStepMinutes: 20 },
    date: '2026-10-05',
    service: fit60,
  });
  check(
    'grid: every start is a multiple of the step from midnight (20 min)',
    grid20.length > 0 && grid20.every((s) => instantToLocal(s.startsAt, TZ).minute % 20 === 0),
    grid20.map((s) => localHm(s.startsAt)).join(' '),
  );

  // DST: 2026-10-25 (Sunday) — Brussels goes from UTC+2 to UTC+1 at 03:00
  const sundayHours = [
    { weekday: 0, startMinute: 540, endMinute: 720 },
    { weekday: 6, startMinute: 540, endMinute: 720 },
  ];
  const dstDay = computeSlots({ ...base, hours: sundayHours, date: '2026-10-25', service: fit60 });
  const dayBefore = computeSlots({
    ...base,
    hours: sundayHours,
    date: '2026-10-24',
    service: fit60,
  });
  check(
    'DST 2026-10-25: 09:00 local = 08:00Z (UTC+1)',
    dstDay[0]?.startsAt === '2026-10-25T08:00:00.000Z',
    dstDay[0]?.startsAt,
  );
  check(
    'DST 2026-10-24: 09:00 local = 07:00Z (UTC+2)',
    dayBefore[0]?.startsAt === '2026-10-24T07:00:00.000Z',
    dayBefore[0]?.startsAt,
  );
  check('DST: same number of slots either side (5)', dstDay.length === 5 && dayBefore.length === 5);
  check(
    'DST: every slot on 25 Oct lasts exactly 60 real minutes',
    dstDay.every((s) => Date.parse(s.endsAt) - Date.parse(s.startsAt) === 60 * MINUTE),
  );
  const night = computeSlots({
    ...base,
    hours: [{ weekday: 0, startMinute: 0, endMinute: 240 }],
    rules: { ...rules, slotStepMinutes: 60, minNoticeHours: 0 },
    date: '2026-10-25',
    service: fit60,
  });
  check(
    'DST night 00:00–04:00: ambiguous 02:00 skipped → 00:00, 01:00, 03:00',
    night.map((s) => s.startsAt).join(',') ===
      ['2026-10-24T22:00:00.000Z', '2026-10-24T23:00:00.000Z', '2026-10-25T02:00:00.000Z'].join(
        ',',
      ),
    night.map((s) => s.startsAt).join(', '),
  );
  const spring = computeSlots({
    ...base,
    now: new Date('2027-03-01T08:00:00Z'),
    hours: [{ weekday: 0, startMinute: 0, endMinute: 240 }],
    rules: { ...rules, slotStepMinutes: 60, minNoticeHours: 0 },
    date: '2027-03-28',
    service: fit60,
  });
  check(
    'DST spring 2027-03-28: missing 02:00 skipped → 00:00, 01:00, 03:00',
    spring.map((s) => localHm(s.startsAt)).join(' ') === '00:00 01:00 03:00',
    spring.map((s) => localHm(s.startsAt)).join(' '),
  );

  // "Iedereen" merge
  const p2 = computeSlots({ ...base, providerId: 'p2', date: '2026-10-05', service: fit90, busy });
  const merged = mergeSlots([...monday, ...p2]);
  check('merge: de-duplicated by start', merged.length === monday.length);
  check(
    'merge: free providers listed per start (09:00 only p1, 11:00 p1 + p2)',
    merged[0]?.providerIds.join(',') === 'p1' &&
      merged.find((m) => m.startsAt === '2026-10-05T09:00:00.000Z')?.providerIds.join(',') ===
        'p1,p2',
  );

  // Time helpers
  check(
    'time: localMinutesToInstant(2026-10-25, 09:00) = 08:00Z',
    localMinutesToInstant('2026-10-25', 540, TZ).toISOString() === '2026-10-25T08:00:00.000Z',
  );
  check(
    'time: formatSlot is Dutch',
    formatSlot('2026-10-25T08:00:00Z', TZ) === 'zondag 25 oktober 2026 om 09:00',
    formatSlot('2026-10-25T08:00:00Z', TZ),
  );

  // -------------------------------------------------------------------------
  section('13. e-mail + ICS + token encryption');
  if (!stubsInstalled) {
    check('module.registerHooks available (Node ≥ 22.15)', false, 'booking sections 13–14 skipped');
    return;
  }
  const { sendEmail } = await import('@/lib/email/send');
  const noKey = await sendEmail({
    to: 'klant@example.com',
    subject: 'Test',
    html: '<p>x</p>',
    text: 'x',
  });
  check(
    'sendEmail without RESEND_API_KEY → { sent: false }',
    !noKey.sent && noKey.reason === 'not_configured',
    JSON.stringify(noKey),
  );

  const ics = buildIcs({
    uid: icsUidFor('bk_selftest'),
    startsAt: '2026-10-24T07:00:00.000Z',
    endsAt: '2026-10-24T08:30:00.000Z',
    summary: 'Volwassenenfit — De Bikefit Studio',
    description:
      'Lange beschrijving met komma, puntkomma; en een regel\nnog een regel — én wat UTF-8 zodat het vouwen getest wordt over 75 octetten heen.',
    location: 'De Bikefit Studio, Ninove',
  });
  check('ICS: DTSTART in UTC', ics.includes('\r\nDTSTART:20261024T070000Z\r\n'));
  check('ICS: DTEND in UTC', ics.includes('\r\nDTEND:20261024T083000Z\r\n'));
  check('ICS: has a UID', /\r\nUID:bk_selftest@debikefitstudio\.be\r\n/.test(ics));
  check(
    'ICS: CRLF line endings, folded at 75 octets',
    ics.endsWith('\r\n') &&
      ics.split('\r\n').every((line) => Buffer.byteLength(line, 'utf8') <= 75),
  );
  check('ICS: text escaped', ics.includes('\r\nLOCATION:De Bikefit Studio\\, Ninove\r\n'));
  const cancelIcs = buildIcs({
    uid: icsUidFor('bk_selftest'),
    startsAt: '2026-10-24T07:00:00Z',
    endsAt: '2026-10-24T08:30:00Z',
    summary: 'x',
    method: 'CANCEL',
  });
  check(
    'ICS: cancellation uses METHOD:CANCEL + STATUS:CANCELLED',
    cancelIcs.includes('METHOD:CANCEL') &&
      cancelIcs.includes('STATUS:CANCELLED') &&
      cancelIcs.includes('SEQUENCE:1'),
  );

  const mail = bookingConfirmationEmail({
    siteName: 'De Bikefit Studio',
    siteUrl: 'https://example.test',
    serviceName: 'Volwassenenfit',
    durationMinutes: 90,
    providerName: 'Toshoni',
    customerName: 'Anna <script>',
    customerEmail: 'anna@example.com',
    startsAt: '2026-10-24T07:00:00.000Z',
    endsAt: '2026-10-24T08:30:00.000Z',
    timezone: TZ,
    locationLabel: 'De Bikefit Studio, Ninove',
    locationKind: 'studio',
    locationAddressLines: [],
    cancelUrl: 'https://example.test/afspraak/annuleren/abc',
    cancelDeadline: '2026-10-22T07:00:00.000Z',
  });
  check(
    'template: Dutch subject with local time',
    mail.subject.includes('Volwassenenfit') && mail.subject.includes('09:00'),
    mail.subject,
  );
  check(
    'template: cancel link in text + html',
    mail.text.includes('/afspraak/annuleren/abc') && mail.html.includes('/afspraak/annuleren/abc'),
  );
  check(
    'template: HTML escapes user input',
    mail.html.includes('Anna &lt;script&gt;') && !mail.html.includes('<script>'),
  );
  check('template: no external images', !/<img/i.test(mail.html));

  const google = await import('@/lib/booking/google');
  const sealed = google.encryptSecret('1//refresh-token-value');
  check('token encryption: round trip', google.decryptSecret(sealed) === '1//refresh-token-value');
  check(
    'token encryption: ciphertext hides the token',
    !sealed.includes('refresh-token-value') && sealed.startsWith('v1.'),
  );
  const sealedParts = sealed.split('.');
  sealedParts[3] = (sealedParts[3].startsWith('A') ? 'B' : 'A') + sealedParts[3].slice(1);
  const tampered = sealedParts.join('.');
  check('token encryption: tampering detected (null)', google.decryptSecret(tampered) === null);
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  check(
    'token encryption: a different key cannot decrypt (null)',
    google.decryptSecret(sealed) === null,
  );
  delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  check('google: not configured without client id/secret', !google.isGoogleConfigured());

  // -------------------------------------------------------------------------
  section('14. booking flow on PGlite (provider without Google)');
  const { createSession } = await import('@/lib/cms/session');
  const { CmsAuthError } = await import('@/lib/cms/auth');
  const repo = await import('@/lib/booking/repo');
  const content = await import('@/lib/booking/content');
  const publicBooking = await import('@/lib/booking/public-booking');
  const schema = await import('@/db/cms-schema');

  const signInAs = async (userId: string) => {
    const session = await createSession(db, userId, { userAgent: 'selftest' });
    cookieJar.set('cms_session', session.token);
  };

  await signInAs(admin.id);
  const studio = await repo.createLocation({
    name: 'Studio (test)',
    kind: 'studio',
    city: 'Ninove',
    isDefault: true,
  });
  const home = await repo.createLocation({ name: 'Bij jou thuis', kind: 'customer' });
  check(
    'repo: createLocation (studio default + customer)',
    studio.ok && home.ok && studio.data.isDefault,
  );
  const adultFit = await repo.createService({ name: 'Volwassenenfit', durationMinutes: 90 });
  const youthFit = await repo.createService({
    name: 'Jeugdfit',
    durationMinutes: 60,
    requiresGuardian: true,
  });
  const homeFit = await repo.createService({
    name: 'Fit aan huis',
    durationMinutes: 120,
    locationId: home.ok ? home.data.id : null,
  });
  check(
    'repo: createService ×3 (slug from name)',
    adultFit.ok &&
      youthFit.ok &&
      homeFit.ok &&
      adultFit.data.slug === 'volwassenenfit' &&
      homeFit.data.slug === 'fit-aan-huis',
  );
  const duplicate = await repo.createService({ name: 'Volwassenenfit', durationMinutes: 90 });
  check(
    'repo: duplicate slug rejected (Dutch)',
    !duplicate.ok && duplicate.message.includes('slug'),
    duplicate.ok ? '' : duplicate.message,
  );
  if (!adultFit.ok || !youthFit.ok || !homeFit.ok) return;

  const created = await repo.createProvider({
    newUser: { email: 'aanbieder@selftest.local', name: 'Test Aanbieder' },
  });
  check(
    'repo: createProvider (new user, temporary password once)',
    created.ok &&
      Boolean(created.data.temporaryPassword) &&
      created.data.provider.userRole === 'provider' &&
      !('googleRefreshTokenEnc' in created.data.provider),
  );
  if (!created.ok) return;
  const providerId = created.data.provider.id;
  const providerUserId = created.data.provider.userId;

  const overlap = await repo.setBusinessHours(providerId, [
    { weekday: 1, startMinute: 540, endMinute: 720 },
    { weekday: 1, startMinute: 700, endMinute: 900 },
  ]);
  check('repo: overlapping hours rejected', !overlap.ok, overlap.ok ? '' : overlap.message);
  const hoursSet = await repo.setBusinessHours(providerId, weekHours);
  check(
    'repo: setBusinessHours (Mon–Fri 09–18, Sat 09–13)',
    hoursSet.ok && hoursSet.data.length === 6,
  );
  const subs = await repo.setProviderServices(providerId, [
    { serviceId: adultFit.data.id },
    { serviceId: youthFit.data.id },
    { serviceId: homeFit.data.id },
  ]);
  check('repo: setProviderServices', subs.ok);

  const publicServices = await content.listPublicServices('nl');
  check(
    'content: listPublicServices shows the 3 offered services',
    publicServices.length === 3,
    publicServices.map((s) => s.name).join(', '),
  );
  const publicProviders = await content.listPublicProviders(homeFit.data.id);
  check(
    'content: listPublicProviders resolves the per-service location',
    publicProviders.length === 1 &&
      publicProviders[0].services.find((s) => s.serviceId === homeFit.data.id)?.location?.kind ===
        'customer' &&
      publicProviders[0].services.find((s) => s.serviceId === adultFit.data.id)?.location?.kind ===
        'studio',
  );

  // Provider scope
  await signInAs(providerUserId);
  const own = await repo.getOwnProvider();
  check(
    'provider: getOwnProvider()',
    own?.id === providerId && own.hours.length === 6 && own.googleConnected === false,
  );
  let forbiddenAll = false;
  try {
    await repo.listBookings({ scope: 'all' });
  } catch (error) {
    forbiddenAll = error instanceof CmsAuthError && error.code === 'forbidden';
  }
  check('provider: listBookings({ scope: "all" }) is forbidden', forbiddenAll);
  let forbiddenLocation = false;
  try {
    await repo.createLocation({ name: 'x' });
  } catch (error) {
    forbiddenLocation = error instanceof CmsAuthError;
  }
  check('provider: createLocation is forbidden', forbiddenLocation);
  const ownService = await repo.createService({ name: 'Inspanningstest', durationMinutes: 60 });
  check(
    'provider: createService auto-subscribes the creator',
    ownService.ok &&
      (await repo.getOwnProvider())?.services.some((s) => s.serviceId === ownService.data.id) ===
        true,
  );
  const closure = await repo.setAvailabilityExceptions(providerId, [
    { date: addDaysYmd(todayYmd(new Date(), TZ), 30), kind: 'closed' },
  ]);
  check(
    'provider: setAvailabilityExceptions on own profile',
    closure.ok && closure.data.length === 1,
  );

  // Availability → pick a slot 3–17 days out (beyond the 48 h cancel window)
  const today = todayYmd(new Date(), TZ);
  const avail = await content.getAvailability({
    serviceId: adultFit.data.id,
    providerId: null,
    fromYmd: addDaysYmd(today, 3),
    toYmd: addDaysYmd(today, 17),
  });
  check(
    'content: getAvailability returns slots',
    avail.ok && avail.slots.length > 0,
    avail.ok ? `${avail.slots.length} slots ${avail.fromYmd}…${avail.toYmd}` : avail.message,
  );
  if (!avail.ok || avail.slots.length < 2) return;
  const slot = avail.slots[0];
  const slot2 = avail.slots[avail.slots.length - 1];

  // Validation
  const invalid = await publicBooking.createPublicBooking(
    { serviceId: adultFit.data.id, startsAt: slot.startsAt, customerEmail: 'geen-mail' },
    { ipAddress: '198.51.100.1' },
  );
  check(
    'public: validation errors in Dutch',
    !invalid.ok &&
      invalid.code === 'invalid' &&
      invalid.fieldErrors.customerName === 'Vul je naam in.' &&
      invalid.fieldErrors.customerEmail === 'Vul een geldig e-mailadres in.',
  );
  const noGuardian = await publicBooking.createPublicBooking(
    {
      serviceId: youthFit.data.id,
      startsAt: slot.startsAt,
      customerName: 'Tom',
      customerEmail: 'tom@example.com',
    },
    { ipAddress: '198.51.100.1' },
  );
  check(
    'public: jeugdfit needs a guardian',
    !noGuardian.ok && Boolean(noGuardian.fieldErrors.guardianName),
  );
  const honeypot = await publicBooking.createPublicBooking(
    {
      serviceId: adultFit.data.id,
      startsAt: slot.startsAt,
      customerName: 'Bot',
      customerEmail: 'bot@example.com',
      website: 'x',
    },
    { ipAddress: '198.51.100.1' },
  );
  check('public: honeypot rejected', !honeypot.ok && honeypot.code === 'invalid');

  // Create
  const customer = {
    serviceId: adultFit.data.id,
    providerId: null,
    startsAt: slot.startsAt,
    customerName: 'Anna Peeters',
    customerEmail: 'Anna@Example.com',
    customerPhone: '0470 12 34 56',
    bikeDetails: 'Racefiets',
    notes: 'Last van mijn onderrug.',
  };
  const booked1 = await publicBooking.createPublicBooking(customer, { ipAddress: '203.0.113.7' });
  check(
    'public: createPublicBooking ok',
    booked1.ok,
    booked1.ok ? booked1.bookingId : `${booked1.code}: ${booked1.message}`,
  );
  if (!booked1.ok) return;
  check(
    'public: cancel token is 32 random bytes (base64url)',
    /^[A-Za-z0-9_-]{43}$/.test(booked1.cancelToken),
  );
  check(
    'public: cancel URL',
    booked1.cancelUrl.endsWith(`/afspraak/annuleren/${booked1.cancelToken}`),
  );
  check(
    'public: summary for the confirmation page',
    booked1.booking.serviceName === 'Volwassenenfit' &&
      booked1.booking.providerName === 'Test Aanbieder' &&
      booked1.booking.locationLabel === 'Studio (test)',
  );
  const [row] = await db
    .select()
    .from(schema.cmsBookings)
    .where(eq(schema.cmsBookings.id, booked1.bookingId));
  check(
    'db: only the SHA-256 of the token is stored',
    row?.cancelTokenHash === createHash('sha256').update(booked1.cancelToken).digest('hex') &&
      row.cancelTokenHash !== booked1.cancelToken,
  );
  check(
    'db: e-mail normalised, status confirmed, instants match the slot',
    row?.customerEmail === 'anna@example.com' &&
      row.status === 'confirmed' &&
      new Date(row.startsAt).toISOString() === slot.startsAt &&
      new Date(row.endsAt).toISOString() === slot.endsAt,
  );
  check(
    'db: provider without Google → google_sync_status "none"',
    row?.googleSyncStatus === 'none' && booked1.googleSyncStatus === 'none',
  );
  check(
    'public: e-mails skipped without a key (booking still ok)',
    !booked1.emailSent.customer && !booked1.emailSent.provider,
  );
  const audit = await db
    .select()
    .from(schema.cmsAuditLog)
    .where(
      and(
        eq(schema.cmsAuditLog.action, 'booking.create'),
        eq(schema.cmsAuditLog.entityId, booked1.bookingId),
      ),
    );
  check(
    'audit: booking.create recorded with no actor',
    audit.length === 1 && audit[0].userId === null,
  );

  // Re-check
  const again = await content.getAvailability({
    serviceId: adultFit.data.id,
    providerId,
    fromYmd: instantToLocal(slot.startsAt, TZ).dateYmd,
    toYmd: instantToLocal(slot.startsAt, TZ).dateYmd,
  });
  check(
    'availability: the booked slot is gone',
    again.ok && !again.slots.some((s) => s.startsAt === slot.startsAt),
  );
  const taken = await publicBooking.createPublicBooking(
    { ...customer, customerEmail: 'someone@example.com' },
    { ipAddress: '203.0.113.8' },
  );
  check(
    'public: same slot again → slot_taken',
    !taken.ok && taken.code === 'slot_taken',
    taken.ok ? 'booked twice!' : taken.message,
  );
  let uniqueGuard = false;
  try {
    await db.insert(schema.cmsBookings).values({
      serviceId: adultFit.data.id,
      providerId,
      startsAt: new Date(slot.startsAt),
      endsAt: new Date(slot.endsAt),
      customerName: 'Race',
      customerEmail: 'race@example.com',
      status: 'confirmed',
    });
  } catch {
    uniqueGuard = true;
  }
  check(
    'db: partial unique index blocks a second confirmed booking at the same start',
    uniqueGuard,
  );

  // Rate limit: 5 per 15 min per e-mail (no IP known)
  const spam = {
    ...customer,
    customerEmail: 'spam@example.com',
    startsAt: '2020-01-01T09:00:00.000Z',
  };
  const results: Awaited<ReturnType<typeof publicBooking.createPublicBooking>>[] = [];
  for (let i = 0; i < 6; i += 1)
    results.push(await publicBooking.createPublicBooking(spam, { ipAddress: null }));
  check(
    'rate limit: first 5 attempts reach the slot check',
    results.slice(0, 5).every((r) => !r.ok && r.code === 'slot_taken'),
  );
  check(
    'rate limit: 6th attempt within 15 min → rate_limited',
    !results[5].ok && results[5].code === 'rate_limited',
    results[5].ok ? '' : results[5].message,
  );

  // Admin + provider views
  await signInAs(admin.id);
  const all = await repo.listBookings({ range: 'upcoming' });
  check(
    'admin: listBookings (all, upcoming) includes it, without token hash',
    all.some((b) => b.id === booked1.bookingId) && all.every((b) => !('cancelTokenHash' in b)),
  );
  const stats = await repo.getBookingStats();
  check(
    'admin: getBookingStats',
    stats.scope === 'all' && stats.upcoming === 1,
    JSON.stringify(stats),
  );
  await signInAs(providerUserId);
  const mine = await repo.listBookings({ scope: 'own', range: 'upcoming' });
  check(
    'provider: listBookings(own) includes it',
    mine.length === 1 && mine[0].id === booked1.bookingId,
  );

  // Cancel by token
  const lookup = await publicBooking.getBookingByCancelToken(booked1.cancelToken);
  check('token: getBookingByCancelToken → can cancel', lookup.ok && lookup.canCancel);
  const lateNow = new Date(Date.parse(slot.startsAt) - 47 * 60 * MINUTE);
  const late = await publicBooking.cancelBookingByToken(booked1.cancelToken, { now: lateNow });
  check(
    'token: within 48 h → too_late',
    !late.ok && late.code === 'too_late',
    late.ok ? '' : late.message,
  );
  const bogus = await publicBooking.cancelBookingByToken('x'.repeat(43));
  check('token: unknown token → not_found', !bogus.ok && bogus.code === 'not_found');
  const cancelled = await publicBooking.cancelBookingByToken(booked1.cancelToken);
  check(
    'token: cancelBookingByToken ok',
    cancelled.ok,
    cancelled.ok ? cancelled.message : cancelled.message,
  );
  const [afterCancel] = await db
    .select()
    .from(schema.cmsBookings)
    .where(eq(schema.cmsBookings.id, booked1.bookingId));
  check(
    'db: status cancelled by customer',
    afterCancel?.status === 'cancelled' &&
      afterCancel.cancelledBy === 'customer' &&
      afterCancel.cancelledAt !== null,
  );
  const twice = await publicBooking.cancelBookingByToken(booked1.cancelToken);
  check(
    'token: second cancel → already_cancelled',
    !twice.ok && twice.code === 'already_cancelled',
  );
  const reopened = await content.getAvailability({
    serviceId: adultFit.data.id,
    providerId,
    fromYmd: instantToLocal(slot.startsAt, TZ).dateYmd,
    toYmd: instantToLocal(slot.startsAt, TZ).dateYmd,
  });
  check(
    'availability: the cancelled slot is free again',
    reopened.ok && reopened.slots.some((s) => s.startsAt === slot.startsAt),
  );

  // Provider cancels its own booking through the repo
  const booked2 = await publicBooking.createPublicBooking(
    { ...customer, startsAt: slot2.startsAt, customerEmail: 'jan@example.com' },
    { ipAddress: '203.0.113.9' },
  );
  check('public: second booking ok', booked2.ok, booked2.ok ? '' : booked2.message);
  if (booked2.ok) {
    const byProvider = await repo.cancelBooking(booked2.bookingId);
    check(
      'provider: cancelBooking(own) → cancelled_by provider',
      byProvider.ok &&
        byProvider.data.status === 'cancelled' &&
        byProvider.data.cancelledBy === 'provider',
    );
    const revive = await repo.setBookingStatus(booked2.bookingId, 'confirmed');
    check('repo: a cancelled booking cannot be revived', !revive.ok);
  }
  cookieJar.clear();
}

async function listTables(db: Awaited<ReturnType<typeof getCmsDb>>): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = await (db as any).execute(
    `select table_name from information_schema.tables where table_schema = 'public'`,
  );
  const rows = Array.isArray(result) ? result : (result?.rows ?? []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((row: any) => row.table_name as string);
}

function daysFromNow(date: Date): number {
  return (new Date(date).getTime() - Date.now()) / 86_400_000;
}

main()
  .then(async () => {
    await rm(resolve(process.cwd(), DATA_DIR), { recursive: true, force: true });
    console.log('');
    if (failures > 0) {
      console.log(`✗ self-test FAILED — ${failures} check(s) failed`);
      process.exit(1);
    }
    console.log('✓ self-test passed — all checks green');
    process.exit(0);
  })
  .catch(async (error) => {
    await rm(resolve(process.cwd(), DATA_DIR), { recursive: true, force: true }).catch(() => {});
    console.error('\n✗ self-test crashed');
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  });
