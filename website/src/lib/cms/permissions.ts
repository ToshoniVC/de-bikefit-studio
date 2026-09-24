import type { CmsRole } from '@/db/cms-schema';

/**
 * Single source of truth for "who may do what" in the CMS.
 *
 * Two roles:
 *  - **editor** — day-to-day content work: pages, blocks, media, navigation.
 *  - **admin**  — everything an editor can do, plus publishing, users,
 *                 redirects, site settings and the audit log.
 *
 * Worker B must call `can(user.role, '<permission>')` (or `requireCmsUser`
 * with a role) in every server action *and* use it to hide UI. Hiding alone is
 * not enforcement — the server action is the real boundary.
 */

export const CMS_PERMISSIONS = [
  // Content
  'page.read',
  'page.create',
  'page.update',
  'page.delete',
  'page.publish',
  'page.unpublish',
  'block.update',
  'block.reorder',
  // Media
  'media.read',
  'media.create',
  'media.update',
  'media.delete',
  // Navigation
  'navigation.read',
  'navigation.update',
  // Admin-only
  'redirect.read',
  'redirect.manage',
  'settings.read',
  'settings.update',
  'user.read',
  'user.manage',
  'audit.read',
] as const;

export type CmsPermission = (typeof CMS_PERMISSIONS)[number];

const EDITOR_PERMISSIONS = new Set<CmsPermission>([
  'page.read',
  'page.create',
  'page.update',
  'page.delete',
  'block.update',
  'block.reorder',
  'media.read',
  'media.create',
  'media.update',
  'media.delete',
  'navigation.read',
  'navigation.update',
  'settings.read',
  'redirect.read',
]);

const ROLE_PERMISSIONS: Record<CmsRole, ReadonlySet<CmsPermission>> = {
  admin: new Set<CmsPermission>(CMS_PERMISSIONS),
  editor: EDITOR_PERMISSIONS,
};

export function can(role: CmsRole, permission: CmsPermission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export function permissionsFor(role: CmsRole): CmsPermission[] {
  return CMS_PERMISSIONS.filter((permission) => can(role, permission));
}

/** Role ranking used by `requireCmsUser('admin')`. */
const ROLE_RANK: Record<CmsRole, number> = { editor: 1, admin: 2 };

export function roleAtLeast(role: CmsRole, required: CmsRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

/** Dutch labels for the admin UI. */
export const ROLE_LABELS: Record<CmsRole, string> = {
  admin: 'Beheerder',
  editor: 'Redacteur',
};
