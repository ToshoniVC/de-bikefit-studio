import { and, eq } from 'drizzle-orm';
import type { CmsDatabase } from '@/db/cms';
import { cmsUsers } from '@/db/cms-schema';
import { hashPassword, needsRehash } from './password';

/**
 * Moves a stored password hash to the current scrypt parameters
 * (`PASSWORD_HASH_PARAMS` in `./password.ts`) at the one moment the password
 * is known to be right: after a successful sign-in or re-authentication. Old
 * hashes disappear without a migration and without anyone choosing a new
 * password.
 *
 * Not `server-only`, like `./password.ts` and `./session.ts`: `./auth.ts`
 * imports it, and plain Node scripts (self-test, CLIs) import `./auth.ts`.
 */

/**
 * Call only after `verifyPassword(password, storedHash)` returned true, with
 * the hash that was verified. When that hash is not the current parameter
 * set, hashes `password` again and stores the result, conditionally: the row
 * is only updated while it still holds `storedHash`, so a password change (or
 * another upgrade) that happened in between is never overwritten.
 *
 * Returns whether a row was upgraded. Never throws: a failed upgrade is logged
 * and tried again at the next sign-in, it must not fail this one.
 */
export async function upgradePasswordHashIfNeeded(
  db: CmsDatabase,
  userId: string,
  password: string,
  storedHash: string,
): Promise<boolean> {
  try {
    if (!needsRehash(storedHash)) return false;
    const passwordHash = await hashPassword(password);
    const upgraded = await db
      .update(cmsUsers)
      .set({ passwordHash, updatedAt: new Date() })
      .where(and(eq(cmsUsers.id, userId), eq(cmsUsers.passwordHash, storedHash)))
      .returning({ id: cmsUsers.id });
    return upgraded.length > 0;
  } catch (error) {
    // The error's kind only: a query error would carry the user id and hashes.
    console.error(
      '[cms-auth] password rehash failed',
      error instanceof Error ? error.name : typeof error,
    );
    return false;
  }
}
