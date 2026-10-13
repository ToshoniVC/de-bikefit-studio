import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { StepUpPanel } from '@/components/admin/mfa/step-up';
import { PasswordForm } from '@/components/admin/password-form';
import { AdminAuthFrame } from '@/components/admin/shell';
import { CmsAuthError, requireCmsUser } from '@/lib/cms/auth';
import { roleRequiresMfa } from '@/lib/cms/guard';
import { getStepUpStatus } from '@/lib/cms/mfa/reauth';

export const metadata: Metadata = {
  title: 'Wachtwoord wijzigen · Beheer',
  robots: { index: false, follow: false },
};

/**
 * Blocking gate for `must_change_password`. It lives outside the `(dashboard)`
 * group on purpose: the dashboard layout redirects here, so putting it inside
 * would loop. It is the one admin screen a temporary-password session may
 * render, hence the explicit `allowMustChangePassword`. For an admin the
 * change also needs a recent full authentication: right after signing in it
 * is there; later the step-up form above the password form renews it.
 */
export default async function ForcedPasswordChangePage() {
  let user;
  try {
    user = await requireCmsUser(undefined, { allowMustChangePassword: true });
  } catch (error) {
    if (error instanceof CmsAuthError) redirect('/admin/login?next=/admin/password');
    throw error;
  }
  const stepUp = roleRequiresMfa(user.role) ? await getStepUpStatus() : null;

  return (
    <AdminAuthFrame
      wide
      title={user.mustChangePassword ? 'Kies een nieuw wachtwoord' : 'Wachtwoord wijzigen'}
      description={
        user.mustChangePassword
          ? 'Je account gebruikt nog een tijdelijk wachtwoord. Kies eerst een eigen wachtwoord; daarna kan je verder.'
          : 'Je kan je wachtwoord hier aanpassen.'
      }
    >
      {stepUp ? (
        <div className="mb-5">
          <StepUpPanel
            until={stepUp.until ? stepUp.until.toISOString() : null}
            needsCode={stepUp.needsCode}
            what="je wachtwoord wijzigen"
          />
        </div>
      ) : null}
      <PasswordForm next="/admin" />

      {user.mustChangePassword ? null : (
        <p className="mt-5 text-sm">
          <Link href="/admin" className="underline underline-offset-4 hover:text-primary">
            Terug naar het beheer
          </Link>
        </p>
      )}
    </AdminAuthFrame>
  );
}
