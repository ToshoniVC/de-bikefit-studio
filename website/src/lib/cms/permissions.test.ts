import { describe, expect, it } from 'vitest';
import type { CmsRole } from '@/db/cms-schema';
import {
  CMS_PERMISSIONS,
  ROLE_LABELS,
  ROLE_RANK,
  can,
  permissionsFor,
  roleAtLeast,
  type CmsPermission,
} from './permissions';

/**
 * The role matrix exactly as documented in `docs/cms-architecture.md`
 * (columns: provider, editor, admin). Typed as a full record, so adding a
 * permission without deciding who gets it fails the typecheck.
 */
const MATRIX: Record<CmsPermission, [provider: boolean, editor: boolean, admin: boolean]> = {
  'page.read': [false, true, true],
  'page.create': [false, true, true],
  'page.update': [false, true, true],
  'page.delete': [false, true, true],
  'page.publish': [false, false, true],
  'page.unpublish': [false, false, true],
  'block.update': [false, true, true],
  'block.reorder': [false, true, true],
  'media.read': [false, true, true],
  'media.create': [false, true, true],
  'media.update': [false, true, true],
  'media.delete': [false, true, true],
  'navigation.read': [false, true, true],
  'navigation.update': [false, true, true],
  'redirect.read': [false, true, true],
  'redirect.manage': [false, false, true],
  'settings.read': [false, true, true],
  'settings.update': [false, false, true],
  'user.read': [false, false, true],
  'user.manage': [false, false, true],
  'audit.read': [false, false, true],
  'booking.read': [false, true, true],
  'booking.read.own': [true, false, true],
  'booking.manage': [false, false, true],
  'booking.manage.own': [true, false, true],
  'service.read': [true, true, true],
  'service.create': [true, false, true],
  'service.manage': [false, false, true],
  'service.subscribe.own': [true, false, true],
  'location.read': [true, true, true],
  'location.manage': [false, false, true],
  'provider.read': [false, true, true],
  'provider.manage': [false, false, true],
  'provider.self': [true, false, true],
  'analytics.read': [false, false, true],
};

const COLUMN: Record<CmsRole, 0 | 1 | 2> = { provider: 0, editor: 1, admin: 2 };

describe('CMS role matrix', () => {
  it('documents every permission exactly once', () => {
    expect(Object.keys(MATRIX).sort()).toEqual([...CMS_PERMISSIONS].sort());
    expect(new Set(CMS_PERMISSIONS).size).toBe(CMS_PERMISSIONS.length);
  });

  it.each(['provider', 'editor', 'admin'] as const)(
    'grants %s exactly its documented column',
    (role) => {
      const expected = CMS_PERMISSIONS.filter((permission) => MATRIX[permission][COLUMN[role]]);
      expect(permissionsFor(role)).toEqual(expected);
    },
  );

  it('gives admin every permission', () => {
    for (const permission of CMS_PERMISSIONS)
      expect(can('admin', permission), permission).toBe(true);
  });

  it('keeps user management, publishing, settings changes and the audit log away from editors', () => {
    const adminOnly: CmsPermission[] = [
      'user.read',
      'user.manage',
      'audit.read',
      'settings.update',
      'page.publish',
      'page.unpublish',
      'redirect.manage',
      'booking.manage',
      'provider.manage',
      'analytics.read',
    ];
    for (const permission of adminOnly) expect(can('editor', permission), permission).toBe(false);
    expect(can('editor', 'settings.read')).toBe(true);
    expect(can('editor', 'booking.read')).toBe(true);
  });

  it('limits providers to own-scoped permissions plus reading/creating services and reading locations', () => {
    expect(permissionsFor('provider').sort()).toEqual(
      [
        'booking.manage.own',
        'booking.read.own',
        'location.read',
        'provider.self',
        'service.create',
        'service.read',
        'service.subscribe.own',
      ].sort(),
    );
    const scoped = CMS_PERMISSIONS.filter((p) => p.endsWith('.own') || p.endsWith('.self'));
    for (const permission of scoped) expect(can('provider', permission), permission).toBe(true);
    const contentAreas = [
      'page.',
      'block.',
      'media.',
      'navigation.',
      'redirect.',
      'settings.',
      'user.',
      'audit.',
    ];
    for (const permission of CMS_PERMISSIONS.filter((p) =>
      contentAreas.some((a) => p.startsWith(a)),
    )) {
      expect(can('provider', permission), permission).toBe(false);
    }
  });

  it('denies unknown roles and unknown permissions', () => {
    expect(can('ghost' as CmsRole, 'page.read')).toBe(false);
    expect(can('admin', 'page.explode' as CmsPermission)).toBe(false);
  });
});

describe('role rank', () => {
  it('orders provider < editor < admin', () => {
    expect(ROLE_RANK.provider).toBeLessThan(ROLE_RANK.editor);
    expect(ROLE_RANK.editor).toBeLessThan(ROLE_RANK.admin);
  });

  it('roleAtLeast compares ranks, so providers are not "at least editor"', () => {
    expect(roleAtLeast('admin', 'editor')).toBe(true);
    expect(roleAtLeast('editor', 'editor')).toBe(true);
    expect(roleAtLeast('editor', 'admin')).toBe(false);
    expect(roleAtLeast('provider', 'editor')).toBe(false);
    expect(roleAtLeast('provider', 'provider')).toBe(true);
  });

  it('has a Dutch label for every role', () => {
    expect(ROLE_LABELS).toEqual({ admin: 'Beheerder', editor: 'Redacteur', provider: 'Aanbieder' });
  });
});
