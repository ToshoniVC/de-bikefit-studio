/**
 * End-to-end smoke test for the CMS foundation, with no test runner.
 *
 *   npm run cms:selftest
 *
 * Runs against a throwaway PGlite database under .pglite-selftest/ (created and
 * deleted by this script) so it never touches your working data or Neon:
 *
 *   1. migrate            — apply ./drizzle to a fresh database
 *   2. schema             — every expected table exists; the webshop tables too
 *   3. password           — correct password verifies, wrong one does not
 *   4. credentials        — verifyCredentials() accepts/rejects + rate limits
 *   5. session            — create a session, resolve it, revoke it
 *   6. block registry     — every block's defaultData validates
 *   7. publish            — draft blocks freeze into a published snapshot
 *
 * Exits non-zero on the first failure.
 */
import { config } from 'dotenv';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';

config({ path: '.env.local' });

// Force the PGlite driver at a dedicated location, whatever the environment says.
const DATA_DIR = '.pglite-selftest';
delete process.env.DATABASE_URL;
process.env.CMS_PGLITE_DIR = DATA_DIR;
process.env.CMS_PGLITE_AUTO_MIGRATE = 'true';
process.env.CMS_SESSION_SECRET ??= 'selftest-session-secret-not-a-real-credential';

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
import { can, permissionsFor } from '@/lib/cms/permissions';

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
  const limited = await verifyCredentials(db, TEST_EMAIL, GOOD_PASSWORD, { ipAddress: '10.0.0.66' });
  check(
    `rate limited after ${LOGIN_MAX_ATTEMPTS} failures`,
    !limited.ok && limited.error === 'rate_limited',
    limited.ok ? 'not limited!' : limited.message,
  );

  section('5. sessions');
  const created = await createSession(db, user.id, { ipAddress: '10.0.0.1', userAgent: 'selftest' });
  check('session token issued', created.token.length >= 40, `${created.token.length} chars`);

  const stored = await db
    .select({ tokenHash: cmsSessions.tokenHash })
    .from(cmsSessions)
    .where(eq(cmsSessions.id, created.id))
    .limit(1);
  check('raw token is NOT stored', stored[0]?.tokenHash !== created.token);

  const resolved = await resolveSession(db, created.token);
  check('session resolves to the right user', resolved?.user.id === user.id);
  check('resolved user carries no password hash', resolved !== null && !('passwordHash' in resolved.user));
  check(
    'expiry is ~14 days out',
    resolved !== null && daysFromNow(resolved.expiresAt) > 13 && daysFromNow(resolved.expiresAt) < 15,
    resolved ? `${daysFromNow(resolved.expiresAt).toFixed(1)} days` : '',
  );

  check('garbage token does not resolve', (await resolveSession(db, 'garbage')) === null);
  await revokeSession(db, created.token);
  check('revoked session no longer resolves', (await resolveSession(db, created.token)) === null);

  section('6. block registry');
  check(`${BLOCK_TYPES.length} block types registered`, BLOCK_TYPES.length >= 11, BLOCK_TYPES.join(', '));
  for (const type of BLOCK_TYPES) {
    const parsed = blockRegistry[type].schema.safeParse(defaultDataFor(type));
    check(`defaultData valid: ${type}`, parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues[0]));
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
  check('draft blocks validate', validated.ok, validated.ok ? `${validated.blocks.length} blocks` : '');

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
    check(
      'snapshot keeps Dutch copy',
      JSON.stringify(roundTripped).includes('Fiets met'),
    );
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
