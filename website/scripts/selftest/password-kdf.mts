/**
 * Self-test section 5d: stored password hashes move to the current scrypt
 * parameters (N = 2^17) at sign-in, on the throwaway PGlite of
 * `cms-selftest.mts`. A throwaway editor starts with a legacy N = 2^15 hash,
 * built with node:crypto exactly as `hashPassword()` wrote it before. Then:
 *
 *  1. `verifyCredentials()` accepts the password and replaces the hash
 *     (`upgradePasswordHashIfNeeded()`, `src/lib/cms/password-upgrade.ts`);
 *  2. the new hash verifies, and a second sign-in leaves it alone (no churn);
 *  3. a wrong password changes nothing;
 *  4. an upgrade computed from a stale hash (the row changed in between, as
 *     with a concurrent password change) is not written.
 *
 * The user and its login attempts are deleted at the end, so later sections
 * find the database as before. Imported lazily by `cms-selftest.mts` after
 * its request-context stubs.
 */
import { randomBytes, scryptSync } from 'node:crypto';
import type { CmsDatabase } from '@/db/cms';

type Check = (label: string, condition: boolean, detail?: string) => void;

const KDF_EMAIL = 'kdf@selftest.local';
const KDF_PASSWORD = 'Trapfrequentie-2026';
const CTX = { ipAddress: '10.20.0.9', userAgent: 'selftest-kdf' };
const LEGACY = { N: 2 ** 15, r: 8, p: 1 };

/** A hash as `hashPassword()` wrote it before N went from 2^15 to 2^17. */
function legacyHash(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password.normalize('NFKC'), salt, 64, {
    ...LEGACY,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    'scrypt',
    LEGACY.N,
    LEGACY.r,
    LEGACY.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

/** `scrypt$N$r$p` only: the self-test output never shows a salt or hash. */
const paramsOf = (hash: string) => hash.split('$').slice(0, 4).join('$');

export async function passwordKdfSection(ctx: {
  db: CmsDatabase;
  check: Check;
  section: (title: string) => void;
}) {
  const { db, check, section } = ctx;
  section('5d. password hash upgrade (scrypt N=2^17)');

  const { eq } = await import('drizzle-orm');
  const { cmsLoginAttempts, cmsUsers } = await import('@/db/cms-schema');
  const auth = await import('@/lib/cms/auth');
  const { needsRehash, verifyPassword } = await import('@/lib/cms/password');
  const { upgradePasswordHashIfNeeded } = await import('@/lib/cms/password-upgrade');

  const legacy = legacyHash(KDF_PASSWORD);
  check(
    'fixture: a legacy N=2^15 hash that verifies and is flagged by needsRehash()',
    legacy.startsWith('scrypt$32768$8$1$') &&
      needsRehash(legacy) &&
      (await verifyPassword(KDF_PASSWORD, legacy)),
    paramsOf(legacy),
  );
  const [user] = await db
    .insert(cmsUsers)
    .values({
      email: KDF_EMAIL,
      name: 'Selftest KDF',
      role: 'editor',
      passwordHash: legacy,
      mustChangePassword: false,
      isActive: true,
    })
    .returning({ id: cmsUsers.id, updatedAt: cmsUsers.updatedAt });

  const stored = async () => {
    const [row] = await db
      .select({ hash: cmsUsers.passwordHash, updatedAt: cmsUsers.updatedAt })
      .from(cmsUsers)
      .where(eq(cmsUsers.id, user.id))
      .limit(1);
    return row ?? { hash: '', updatedAt: new Date(0) };
  };

  try {
    const first = await auth.verifyCredentials(db, KDF_EMAIL, KDF_PASSWORD, CTX);
    check('sign-in with the legacy hash succeeds', first.ok, first.ok ? '' : first.message);
    const upgraded = await stored();
    check(
      'the stored hash is now scrypt N=2^17 (updated_at moved on)',
      upgraded.hash.startsWith('scrypt$131072$8$1$') && upgraded.updatedAt > user.updatedAt,
      paramsOf(upgraded.hash),
    );
    check(
      'the new hash verifies the same password and needs no rehash',
      (await verifyPassword(KDF_PASSWORD, upgraded.hash)) && !needsRehash(upgraded.hash),
    );

    const second = await auth.verifyCredentials(db, KDF_EMAIL, KDF_PASSWORD, CTX);
    check(
      'a second sign-in leaves the hash unchanged (no rehash churn)',
      second.ok && (await stored()).hash === upgraded.hash,
    );

    const wrong = await auth.verifyCredentials(db, KDF_EMAIL, 'Trapfrequentie-2025', CTX);
    check(
      'a wrong password is refused and changes nothing',
      !wrong.ok && wrong.error === 'invalid_credentials' && (await stored()).hash === upgraded.hash,
      wrong.ok ? 'accepted!' : wrong.error,
    );

    // As if a password change landed between someone's verification of the
    // legacy hash and their upgrade: the row no longer holds what they verified.
    const stale = await upgradePasswordHashIfNeeded(db, user.id, KDF_PASSWORD, legacy);
    check(
      'an upgrade from a stale hash (concurrent change) returns false and overwrites nothing',
      stale === false && (await stored()).hash === upgraded.hash,
    );
  } finally {
    await db.delete(cmsLoginAttempts).where(eq(cmsLoginAttempts.email, KDF_EMAIL));
    await db.delete(cmsUsers).where(eq(cmsUsers.id, user.id));
  }

  const [leftUser] = await db
    .select({ id: cmsUsers.id })
    .from(cmsUsers)
    .where(eq(cmsUsers.email, KDF_EMAIL));
  const [leftAttempt] = await db
    .select({ id: cmsLoginAttempts.id })
    .from(cmsLoginAttempts)
    .where(eq(cmsLoginAttempts.email, KDF_EMAIL));
  check('cleanup: the throwaway user and its login attempts are gone', !leftUser && !leftAttempt);
}
