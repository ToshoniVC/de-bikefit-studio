import { describe, expect, it } from 'vitest';
import type { CmsRole } from '@/db/cms-schema';
import {
  cmsAccessDenial,
  REAUTH_WINDOW_MS,
  ROLE_MFA_POLICY,
  roleRequiresMfa,
  type CmsAccessRequirement,
  type CmsAuthErrorCode,
  type CmsGuardSubject,
} from './guard';
import { CMS_PERMISSIONS, can, roleAtLeast } from './permissions';

/**
 * The guard per role, as a full matrix: every role (and an unknown one) ×
 * session with or without the second step × temporary password or not ×
 * every requirement a call site can ask for. Which roles need the second step
 * is written out literally below, not read from the code under test; the
 * permission and rank parts follow the matrix that `permissions.test.ts`
 * pins down.
 */

const NOW = new Date('2026-10-16T10:00:00Z');
const JUST_NOW = new Date(NOW.getTime() - 60_000);
const STALE = new Date(NOW.getTime() - REAUTH_WINDOW_MS - 1);

/** Admins and providers: every session must have passed the second step. Editors: optional. */
const EXPECTED_MFA: Record<string, boolean> = {
  admin: true,
  provider: true,
  editor: false,
};
/** Anything else fails closed. Includes names a plain object lookup would trip over. */
const UNKNOWN_ROLES = [
  'owner',
  'superuser',
  '',
  'ADMIN',
  'Editor',
  ' editor',
  'editor ',
  'constructor',
  '__proto__',
  'toString',
  'hasOwnProperty',
];
const ROLES: string[] = ['admin', 'provider', 'editor', 'owner'];

const REQUIREMENTS: CmsAccessRequirement[] = [
  {},
  { allowMustChangePassword: true },
  ...(['provider', 'editor', 'admin'] as const).flatMap((role) => [
    { role },
    { role, allowMustChangePassword: true },
  ]),
  ...CMS_PERMISSIONS.map((permission) => ({ permission })),
  { role: 'admin', recentReauthentication: true },
  { permission: 'provider.self', recentReauthentication: true },
];

/** The documented order: MFA → temporary password → role → permission → recent step-up. */
function expected(
  role: string,
  mfaVerified: boolean,
  mustChangePassword: boolean,
  requirement: CmsAccessRequirement,
  reauthenticatedAt: Date | null,
): CmsAuthErrorCode | null {
  const needsMfa = Object.hasOwn(EXPECTED_MFA, role) ? EXPECTED_MFA[role] : true;
  if (needsMfa && !mfaVerified) return 'mfa_required';
  if (mustChangePassword && requirement.allowMustChangePassword !== true) {
    return 'password_change_required';
  }
  const known = role as CmsRole;
  if (requirement.role && !roleAtLeast(known, requirement.role)) return 'forbidden';
  if (requirement.permission && !can(known, requirement.permission)) return 'forbidden';
  // Of the three stamps used below, only JUST_NOW lies inside the window.
  if (requirement.recentReauthentication && reauthenticatedAt !== JUST_NOW) {
    return 'reauth_required';
  }
  return null;
}

describe('which roles need the second step', () => {
  it('admins and providers always; editors only when they have an authenticator (login)', () => {
    expect(ROLE_MFA_POLICY).toEqual({
      admin: 'required',
      provider: 'required',
      editor: 'optional',
    });
    expect(roleRequiresMfa('admin')).toBe(true);
    expect(roleRequiresMfa('provider')).toBe(true);
    expect(roleRequiresMfa('editor')).toBe(false);
  });

  it('cannot be changed at runtime (the table is frozen)', () => {
    expect(Object.isFrozen(ROLE_MFA_POLICY)).toBe(true);
    expect(() => {
      (ROLE_MFA_POLICY as Record<string, string>).provider = 'optional';
    }).toThrow(TypeError);
    expect(roleRequiresMfa('provider')).toBe(true);
  });

  it('fails closed: every role that is not exactly "editor" needs it', () => {
    for (const role of UNKNOWN_ROLES)
      expect(roleRequiresMfa(role), JSON.stringify(role)).toBe(true);
  });
});

describe('cmsAccessDenial: role × second step × temporary password × requirement', () => {
  it('follows the documented order for every combination', () => {
    let combinations = 0;
    for (const role of ROLES) {
      for (const mfaVerified of [true, false]) {
        for (const mustChangePassword of [false, true]) {
          for (const reauthenticatedAt of [JUST_NOW, STALE, null]) {
            for (const requirement of REQUIREMENTS) {
              const subject = {
                role,
                mustChangePassword,
                mfaVerified,
                reauthenticatedAt,
              } as unknown as CmsGuardSubject;
              const label = `${role} mfa=${mfaVerified} temporary=${mustChangePassword} reauth=${
                reauthenticatedAt?.toISOString() ?? 'none'
              } ${JSON.stringify(requirement)}`;
              expect(cmsAccessDenial(subject, requirement, NOW), label).toBe(
                expected(role, mfaVerified, mustChangePassword, requirement, reauthenticatedAt),
              );
              combinations += 1;
            }
          }
        }
      }
    }
    expect(combinations).toBe(ROLES.length * 2 * 2 * 3 * REQUIREMENTS.length);
  });

  it('an unknown role without the second step is refused before anything else', () => {
    for (const role of UNKNOWN_ROLES) {
      const subject = { role, mustChangePassword: true, mfaVerified: false } as CmsGuardSubject;
      expect(cmsAccessDenial(subject, { allowMustChangePassword: true }), role).toBe(
        'mfa_required',
      );
    }
  });
});

describe('providers, case by case', () => {
  const provider = (mfaVerified: boolean, mustChangePassword: boolean): CmsGuardSubject => ({
    role: 'provider',
    mustChangePassword,
    mfaVerified,
    reauthenticatedAt: JUST_NOW,
  });

  it('a session from before provider MFA is refused, its own agenda included', () => {
    for (const permission of [
      'provider.self',
      'booking.read.own',
      'booking.manage.own',
      'service.read',
      'service.create',
      'service.subscribe.own',
      'location.read',
    ] as const) {
      expect(cmsAccessDenial(provider(false, false), { permission }, NOW), permission).toBe(
        'mfa_required',
      );
    }
    // What the Google OAuth routes and the draft preview ask: nothing but the session.
    expect(cmsAccessDenial(provider(false, false), {}, NOW)).toBe('mfa_required');
  });

  it('the very first sign-in: MFA before the temporary password, then the password', () => {
    // A pre-MFA session never gets to the forced password change.
    expect(cmsAccessDenial(provider(false, true), { allowMustChangePassword: true }, NOW)).toBe(
      'mfa_required',
    );
    // After the second step a temporary password still blocks everything but its change.
    expect(cmsAccessDenial(provider(true, true), { permission: 'provider.self' }, NOW)).toBe(
      'password_change_required',
    );
    expect(
      cmsAccessDenial(provider(true, true), { allowMustChangePassword: true }, NOW),
    ).toBeNull();
    expect(cmsAccessDenial(provider(true, false), { permission: 'provider.self' }, NOW)).toBeNull();
  });

  it('cannot reach user management or anyone else’s second factor, even fully signed in', () => {
    // `adminResetUserMfa()` and `listMfaEnrolledUserIds()` ask for the admin role,
    // user management for the admin role plus a recent step-up.
    for (const requirement of [
      { role: 'admin' as const },
      { role: 'admin' as const, recentReauthentication: true },
      { role: 'editor' as const },
      { permission: 'user.read' as const },
      { permission: 'user.manage' as const },
      { permission: 'provider.manage' as const },
    ]) {
      expect(
        cmsAccessDenial(provider(true, false), requirement, NOW),
        JSON.stringify(requirement),
      ).toBe('forbidden');
    }
  });

  it('a sensitive own change (password) needs a recent step-up, like an admin’s', () => {
    const stepped = (at: Date | null): CmsGuardSubject => ({
      ...provider(true, false),
      reauthenticatedAt: at,
    });
    const ownPassword = { allowMustChangePassword: true, recentReauthentication: true };
    expect(cmsAccessDenial(stepped(JUST_NOW), ownPassword, NOW)).toBeNull();
    expect(cmsAccessDenial(stepped(STALE), ownPassword, NOW)).toBe('reauth_required');
    expect(cmsAccessDenial(stepped(null), ownPassword, NOW)).toBe('reauth_required');
  });
});

describe('editors, unchanged', () => {
  it('a password-only session works, with or without an authenticator on the account', () => {
    const editor = { role: 'editor', mustChangePassword: false, mfaVerified: false } as const;
    expect(cmsAccessDenial(editor, { permission: 'page.update' }, NOW)).toBeNull();
    expect(
      cmsAccessDenial({ ...editor, mfaVerified: true }, { permission: 'page.update' }, NOW),
    ).toBeNull();
    expect(cmsAccessDenial(editor, { permission: 'provider.self' }, NOW)).toBe('forbidden');
    expect(cmsAccessDenial({ ...editor, mustChangePassword: true }, {}, NOW)).toBe(
      'password_change_required',
    );
  });
});
