import { desc, eq } from 'drizzle-orm';
import { getCmsDb } from '@/db/cms';
import { cmsUsers, type CmsRole, type CmsUserPublic } from '@/db/cms-schema';
import { authFail, normalizeEmail, recordAudit, requireCmsUser, type AuthResult } from './auth';
import { clearMfaAttempts } from './mfa/repo';
import { generateTemporaryPassword, hashPassword, validatePasswordStrength } from './password';
import { revokeAllUserSessions, toPublicUser } from './session';

/**
 * Admin-only user management, split out of `./auth.ts` (file-size rule).
 * Every function re-checks the admin role itself through `requireCmsUser()`,
 * so the MFA and temporary-password rules of the guard apply here too.
 */

export type CreateUserInput = {
  email: string;
  name: string;
  role: CmsRole;
  /** Omit to have a temporary password generated and returned once. */
  password?: string;
};

export type CreatedUser = { user: CmsUserPublic; temporaryPassword: string | null };

/**
 * Admin-only. New users always start with `mustChangePassword = true`; the
 * returned `temporaryPassword` is the only time the plaintext is available.
 */
export async function createUser(input: CreateUserInput): Promise<AuthResult<CreatedUser>> {
  const actor = await requireCmsUser('admin', { recentReauthentication: true });
  const db = await getCmsDb();
  const email = normalizeEmail(input.email);

  const [existing] = await db
    .select({ id: cmsUsers.id })
    .from(cmsUsers)
    .where(eq(cmsUsers.email, email))
    .limit(1);
  if (existing) return authFail('email_taken');

  const generated = input.password ? null : generateTemporaryPassword();
  const password = input.password ?? generated!;

  const weak = validatePasswordStrength(password);
  if (weak) return authFail('weak_password', weak);

  const [row] = await db
    .insert(cmsUsers)
    .values({
      email,
      name: input.name.trim(),
      role: input.role,
      passwordHash: await hashPassword(password),
      mustChangePassword: true,
      isActive: true,
    })
    .returning();

  await recordAudit(db, actor, {
    action: 'user.create',
    entityType: 'cms_user',
    entityId: row.id,
    summary: `${email} (${input.role})`,
  });

  return { ok: true, data: { user: toPublicUser(row), temporaryPassword: generated } };
}

/** Admin-only. Resets another user's password to a fresh temporary one. */
export async function resetUserPassword(userId: string): Promise<AuthResult<string>> {
  const actor = await requireCmsUser('admin', { recentReauthentication: true });
  const db = await getCmsDb();

  const [row] = await db
    .select({ id: cmsUsers.id })
    .from(cmsUsers)
    .where(eq(cmsUsers.id, userId))
    .limit(1);
  if (!row) return authFail('not_found');

  const temporary = generateTemporaryPassword();
  await db
    .update(cmsUsers)
    .set({
      passwordHash: await hashPassword(temporary),
      mustChangePassword: true,
      updatedAt: new Date(),
    })
    .where(eq(cmsUsers.id, userId));
  await revokeAllUserSessions(db, userId);
  await clearMfaAttempts(db, userId);

  await recordAudit(db, actor, {
    action: 'user.password_reset',
    entityType: 'cms_user',
    entityId: userId,
  });

  return { ok: true, data: temporary };
}

/**
 * Admin-only. Deactivating revokes every session for that user.
 * Admins cannot deactivate or demote themselves (prevents lock-out).
 */
export async function setUserActive(userId: string, isActive: boolean): Promise<AuthResult<true>> {
  const actor = await requireCmsUser('admin', { recentReauthentication: true });
  if (actor.id === userId && !isActive) {
    return authFail('forbidden', 'Je kan je eigen account niet deactiveren.');
  }

  const db = await getCmsDb();
  await db.update(cmsUsers).set({ isActive, updatedAt: new Date() }).where(eq(cmsUsers.id, userId));
  if (!isActive) await revokeAllUserSessions(db, userId);

  await recordAudit(db, actor, {
    action: isActive ? 'user.activate' : 'user.deactivate',
    entityType: 'cms_user',
    entityId: userId,
  });
  return { ok: true, data: true };
}

export async function setUserRole(userId: string, role: CmsRole): Promise<AuthResult<true>> {
  const actor = await requireCmsUser('admin', { recentReauthentication: true });
  if (actor.id === userId && role !== 'admin') {
    return authFail('forbidden', 'Je kan je eigen beheerdersrol niet afnemen.');
  }

  const db = await getCmsDb();
  await db.update(cmsUsers).set({ role, updatedAt: new Date() }).where(eq(cmsUsers.id, userId));
  await recordAudit(db, actor, {
    action: 'user.role_change',
    entityType: 'cms_user',
    entityId: userId,
    summary: role,
  });
  return { ok: true, data: true };
}

export async function listCmsUsers(): Promise<CmsUserPublic[]> {
  await requireCmsUser('admin');
  const db = await getCmsDb();
  const rows = await db.select().from(cmsUsers).orderBy(desc(cmsUsers.createdAt));
  return rows.map(toPublicUser);
}
