import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { LoginForm } from '@/components/admin/login-form';
import { AdminAuthFrame } from '@/components/admin/shell';
import { FLASH_TONES } from '@/components/admin/tones';
import { safeAdminPath } from '@/lib/cms/actions/request';
import { getCurrentCmsUser } from '@/lib/cms/auth';
import { cmsAccessDenial } from '@/lib/cms/guard';
import { mfaConfigured } from '@/lib/cms/mfa/crypto';
import { getCurrentMfaChallenge } from '@/lib/cms/mfa/flow';

export const metadata: Metadata = {
  title: 'Aanmelden · Beheer',
  robots: { index: false, follow: false },
};

/**
 * The only admin route an anonymous visitor may reach (see `middleware.ts`),
 * besides the second step at `/admin/mfa`. It sits outside the `(dashboard)`
 * route group, so the gated layout never runs here.
 *
 * Only a session the guard would accept is sent on: an admin or provider
 * session without two-step verification (`mfa_required`) stays here and signs
 * in again, otherwise layout and login page would bounce it back and forth.
 * The copy is role-neutral: admins and providers both see it.
 */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; mfa?: string }>;
}) {
  const { next, mfa } = await searchParams;
  const user = await getCurrentCmsUser();
  const denial = cmsAccessDenial(user, { allowMustChangePassword: true });
  if (user && denial === null) redirect(user.mustChangePassword ? '/admin/password' : '/admin');

  const safeNext = safeAdminPath(next ?? '');

  if (await getCurrentMfaChallenge()) redirect(`/admin/mfa?next=${encodeURIComponent(safeNext)}`);

  return (
    <AdminAuthFrame title="Beheer" description="Meld je aan om de website of je agenda te beheren.">
      {mfaConfigured() ? null : (
        // Operational signal (CMS_MFA_ENCRYPTION_KEY missing or malformed):
        // admins and providers cannot finish signing in. Visible before anyone
        // types a password.
        <p role="alert" className={`mb-4 px-3 py-2 text-sm ${FLASH_TONES.error}`}>
          Tweestapsverificatie is op deze server niet geconfigureerd. Beheerders en aanbieders
          kunnen zich nu niet aanmelden; neem contact op met de technische beheerder.
        </p>
      )}
      {mfa || denial === 'mfa_required' ? (
        <p role="status" className={`mb-4 px-3 py-2 text-sm ${FLASH_TONES.info}`}>
          Je account vraagt naast je wachtwoord ook een code uit je authenticator-app
          (tweestapsverificatie). Meld je opnieuw aan om verder te gaan.
        </p>
      ) : null}
      <LoginForm next={safeNext} />
    </AdminAuthFrame>
  );
}
