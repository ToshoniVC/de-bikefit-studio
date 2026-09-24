import type { CmsRole } from '@/db/cms-schema';

/**
 * Single source of truth for "who may do what" in the CMS.
 *
 * Three roles:
 *  - **provider** (Aanbieder) — a bookable person: sees and manages their own
 *                 bookings, hours, Google connection and service subscriptions.
 *                 No access to pages, media or settings.
 *  - **editor** — day-to-day content work: pages, blocks, media, navigation,
 *                 plus read-only access to bookings, services, locations and
 *                 providers.
 *  - **admin**  — everything, including publishing, users, redirects, site
 *                 settings, the audit log and all booking management.
 *
 * Worker B must call `can(user.role, '<permission>')` (or `requireCmsUser`
 * with a role) in every server action *and* use it to hide UI. Hiding alone is
 * not enforcement — the server action is the real boundary.
 *
 * `*.own` permissions are scoped: the repo resolves "own" from the signed-in
 * user's `cms_providers` row (see `src/lib/booking/repo.ts`).
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
  // Booking
  'booking.read',
  'booking.read.own',
  'booking.manage',
  'booking.manage.own',
  'service.read',
  'service.create',
  'service.manage',
  'service.subscribe.own',
  'location.read',
  'location.manage',
  'provider.read',
  'provider.manage',
  'provider.self',
  // Analytics dashboard
  'analytics.read',
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
  'booking.read',
  'service.read',
  'location.read',
  'provider.read',
]);

const PROVIDER_PERMISSIONS = new Set<CmsPermission>([
  'booking.read.own',
  'booking.manage.own',
  'service.read',
  'service.create',
  'service.subscribe.own',
  'location.read',
  'provider.self',
]);

export const ROLE_PERMISSIONS: Record<CmsRole, ReadonlySet<CmsPermission>> = {
  admin: new Set<CmsPermission>(CMS_PERMISSIONS),
  editor: EDITOR_PERMISSIONS,
  provider: PROVIDER_PERMISSIONS,
};

export function can(role: CmsRole, permission: CmsPermission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export function permissionsFor(role: CmsRole): CmsPermission[] {
  return CMS_PERMISSIONS.filter((permission) => can(role, permission));
}

/**
 * Role ranking used by `requireCmsUser('admin')`. `provider` ranks 0: it is not
 * "at least editor", so `requireCmsUser('editor')` keeps providers out of the
 * content screens. Gate booking screens on permissions, not on rank.
 */
export const ROLE_RANK: Record<CmsRole, number> = { provider: 0, editor: 1, admin: 2 };

export function roleAtLeast(role: CmsRole, required: CmsRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

/** Dutch labels for the admin UI. */
export const ROLE_LABELS: Record<CmsRole, string> = {
  admin: 'Beheerder',
  editor: 'Redacteur',
  provider: 'Aanbieder',
};
