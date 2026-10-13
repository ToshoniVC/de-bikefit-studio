import { describe, expect, it } from 'vitest';
import type { CmsRole } from '@/db/cms-schema';
import {
  CMS_AUTH_MESSAGES,
  CmsAuthError,
  assertCmsAccess,
  cmsAccessDenial,
  type CmsAuthErrorCode,
  type CmsGuardSubject,
  roleRequiresMfa,
} from './guard';
import { CMS_PERMISSIONS, can, roleAtLeast } from './permissions';

const ROLES: CmsRole[] = ['provider', 'editor', 'admin'];

/** A session that passed MFA unless said otherwise, so the older blocks test what they did. */
function user(role: CmsRole, mustChangePassword: boolean, mfaVerified = true): CmsGuardSubject {
  return { role, mustChangePassword, mfaVerified };
}

describe('cmsAccessDenial: the MFA gate for admins', () => {
  const REQUIREMENTS = [
    {},
    { allowMustChangePassword: true },
    ...ROLES.map((role) => ({ role, allowMustChangePassword: true })),
    ...CMS_PERMISSIONS.map((permission) => ({ permission })),
  ];

  it('refuses an admin session without MFA for every requirement, opt-in included', () => {
    for (const requirement of REQUIREMENTS) {
      for (const mustChangePassword of [false, true]) {
        expect(
          cmsAccessDenial(user('admin', mustChangePassword, false), requirement),
          JSON.stringify(requirement),
        ).toBe('mfa_required');
      }
    }
  });

  it('reports missing MFA before a temporary password or a missing permission', () => {
    expect(cmsAccessDenial(user('admin', true, false))).toBe('mfa_required');
    expect(cmsAccessDenial(user('admin', false, false), { permission: 'user.manage' })).toBe(
      'mfa_required',
    );
  });

  it('fails closed on anything but mfaVerified === true', () => {
    for (const value of [undefined, null, 'true', 1, {}]) {
      const odd = {
        role: 'admin',
        mustChangePassword: false,
        mfaVerified: value,
      } as unknown as CmsGuardSubject;
      expect(cmsAccessDenial(odd), String(value)).toBe('mfa_required');
    }
    const missing = { role: 'admin', mustChangePassword: false } as CmsGuardSubject;
    expect(cmsAccessDenial(missing)).toBe('mfa_required');
  });

  it('treats an unknown role like an admin (MFA required)', () => {
    const unknown = { role: 'owner', mustChangePassword: false } as unknown as CmsGuardSubject;
    expect(cmsAccessDenial(unknown)).toBe('mfa_required');
    expect(roleRequiresMfa('owner')).toBe(true);
  });

  it('lets an admin session that passed MFA through', () => {
    expect(cmsAccessDenial(user('admin', false, true), { permission: 'user.manage' })).toBeNull();
  });

  it('leaves editors and providers unchanged: no MFA needed', () => {
    expect(roleRequiresMfa('admin')).toBe(true);
    for (const role of ['editor', 'provider'] as const) {
      expect(roleRequiresMfa(role)).toBe(false);
      expect(cmsAccessDenial(user(role, false, false)), role).toBeNull();
      expect(cmsAccessDenial(user(role, true, false)), role).toBe('password_change_required');
      for (const permission of CMS_PERMISSIONS) {
        expect(cmsAccessDenial(user(role, false, false), { permission }), permission).toBe(
          can(role, permission) ? null : 'forbidden',
        );
      }
    }
  });
});

describe('cmsAccessDenial: the temporary-password gate', () => {
  it('refuses a temporary password for every role, role requirement and permission', () => {
    for (const role of ROLES) {
      const temporary = user(role, true);
      expect(cmsAccessDenial(temporary), role).toBe('password_change_required');
      for (const required of ROLES) {
        expect(cmsAccessDenial(temporary, { role: required }), `${role} ≥ ${required}`).toBe(
          'password_change_required',
        );
      }
      for (const permission of CMS_PERMISSIONS) {
        expect(cmsAccessDenial(temporary, { permission }), `${role} ${permission}`).toBe(
          'password_change_required',
        );
      }
    }
  });

  it('reports the temporary password before a missing role or permission', () => {
    expect(cmsAccessDenial(user('editor', true), { role: 'admin' })).toBe(
      'password_change_required',
    );
    expect(cmsAccessDenial(user('provider', true), { permission: 'page.publish' })).toBe(
      'password_change_required',
    );
  });

  it('lets a temporary password through only on the explicit opt-in', () => {
    for (const role of ROLES) {
      expect(cmsAccessDenial(user(role, true), { allowMustChangePassword: true }), role).toBeNull();
      expect(cmsAccessDenial(user(role, true), { allowMustChangePassword: false }), role).toBe(
        'password_change_required',
      );
      // A truthy non-boolean is not an opt-in.
      const sneaky = { allowMustChangePassword: 'yes' as unknown as boolean };
      expect(cmsAccessDenial(user(role, true), sneaky), role).toBe('password_change_required');
    }
  });

  it('fails closed when the flag is missing or not a boolean', () => {
    for (const value of [undefined, null, 'false', 0]) {
      const odd = {
        role: 'admin',
        mustChangePassword: value,
        mfaVerified: true,
      } as unknown as CmsGuardSubject;
      expect(cmsAccessDenial(odd), String(value)).toBe('password_change_required');
    }
  });
});

describe('cmsAccessDenial: roles and permissions', () => {
  const PASSWORD_STATES = [
    { mustChangePassword: false, allowMustChangePassword: false },
    { mustChangePassword: false, allowMustChangePassword: true },
    { mustChangePassword: true, allowMustChangePassword: true },
  ];

  it('follows roleAtLeast() once the password check passes (the opt-in grants no rank)', () => {
    for (const { mustChangePassword, allowMustChangePassword } of PASSWORD_STATES) {
      for (const role of ROLES) {
        for (const required of ROLES) {
          const expected: CmsAuthErrorCode | null = roleAtLeast(role, required)
            ? null
            : 'forbidden';
          expect(
            cmsAccessDenial(user(role, mustChangePassword), {
              role: required,
              allowMustChangePassword,
            }),
            `${role} ≥ ${required} (temporary: ${mustChangePassword})`,
          ).toBe(expected);
        }
      }
    }
  });

  it('follows can() once the password check passes (the opt-in grants no permission)', () => {
    for (const { mustChangePassword, allowMustChangePassword } of PASSWORD_STATES) {
      for (const role of ROLES) {
        for (const permission of CMS_PERMISSIONS) {
          const expected: CmsAuthErrorCode | null = can(role, permission) ? null : 'forbidden';
          expect(
            cmsAccessDenial(user(role, mustChangePassword), {
              permission,
              allowMustChangePassword,
            }),
            `${role} ${permission} (temporary: ${mustChangePassword})`,
          ).toBe(expected);
        }
      }
    }
  });

  it('checks role and permission together when both are required', () => {
    expect(
      cmsAccessDenial(user('admin', false), { role: 'editor', permission: 'page.publish' }),
    ).toBeNull();
    expect(
      cmsAccessDenial(user('editor', false), { role: 'editor', permission: 'page.publish' }),
    ).toBe('forbidden');
    expect(
      cmsAccessDenial(user('provider', false), { role: 'editor', permission: 'service.read' }),
    ).toBe('forbidden');
  });

  it('allows any signed-in user with a permanent password when nothing is required', () => {
    for (const role of ROLES) expect(cmsAccessDenial(user(role, false)), role).toBeNull();
  });
});

describe('cmsAccessDenial: no user', () => {
  it('is unauthenticated, whatever the requirement or opt-in', () => {
    for (const nobody of [null, undefined]) {
      expect(cmsAccessDenial(nobody)).toBe('unauthenticated');
      expect(cmsAccessDenial(nobody, { allowMustChangePassword: true })).toBe('unauthenticated');
      expect(cmsAccessDenial(nobody, { role: 'provider' })).toBe('unauthenticated');
      expect(cmsAccessDenial(nobody, { permission: 'service.read' })).toBe('unauthenticated');
    }
  });
});

describe('assertCmsAccess', () => {
  it('returns the very same user object when access is granted', () => {
    const admin = {
      id: 'u1',
      email: 'a@example.com',
      role: 'admin' as const,
      mustChangePassword: false,
      mfaVerified: true,
    };
    expect(assertCmsAccess(admin, { permission: 'user.manage' })).toBe(admin);
    const temporary = { ...admin, mustChangePassword: true };
    expect(assertCmsAccess(temporary, { allowMustChangePassword: true })).toBe(temporary);
  });

  it('throws a CmsAuthError carrying the code and its Dutch message', () => {
    const cases: Array<[CmsGuardSubject | null, CmsAuthErrorCode]> = [
      [null, 'unauthenticated'],
      [user('admin', false, false), 'mfa_required'],
      [user('admin', true), 'password_change_required'],
      [user('editor', false), 'forbidden'],
    ];
    for (const [subject, code] of cases) {
      let caught: unknown;
      try {
        assertCmsAccess(subject, { role: 'admin' });
      } catch (error) {
        caught = error;
      }
      expect(caught, code).toBeInstanceOf(CmsAuthError);
      expect(caught, code).toBeInstanceOf(Error);
      expect((caught as CmsAuthError).code).toBe(code);
      expect((caught as CmsAuthError).message).toBe(CMS_AUTH_MESSAGES[code]);
      expect((caught as CmsAuthError).name).toBe('CmsAuthError');
    }
  });
});

describe('CmsAuthError messages', () => {
  it('are short, Dutch and name no internals', () => {
    expect(CMS_AUTH_MESSAGES.password_change_required).toBe('Kies eerst een nieuw wachtwoord.');
    for (const message of Object.values(CMS_AUTH_MESSAGES)) {
      expect(message.length).toBeLessThanOrEqual(60);
      expect(message).not.toMatch(/must_?change|password|mustChange|token|session|sql/i);
    }
  });

  it('keeps an explicit message when one is given', () => {
    expect(new CmsAuthError('forbidden', 'Alleen beheerders.').message).toBe('Alleen beheerders.');
    expect(new CmsAuthError('forbidden').message).toBe(CMS_AUTH_MESSAGES.forbidden);
  });
});
