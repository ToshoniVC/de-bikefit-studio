import type { Metadata } from 'next';
import Link from 'next/link';

import { MfaSignIn, type MfaSignInStep } from '@/components/admin/mfa/sign-in';
import { AdminAuthFrame } from '@/components/admin/shell';
import { safeAdminPath } from '@/lib/cms/actions/request';
import { getCurrentCmsUser } from '@/lib/cms/auth';
import { cmsAccessDenial } from '@/lib/cms/guard';
import { getCurrentMfaChallenge } from '@/lib/cms/mfa/flow';

export const metadata: Metadata = {
  title: 'Tweestapsverificatie · Beheer',
  robots: { index: false, follow: false },
};

const COPY: Record<MfaSignInStep, { title: string; description: string }> = {
  password: {
    title: 'Kies een nieuw wachtwoord',
    description:
      'Je account gebruikt nog een tijdelijk wachtwoord. Kies eerst een eigen wachtwoord; daarna stel je tweestapsverificatie in.',
  },
  enrol: {
    title: 'Tweestapsverificatie instellen',
    description: 'Koppel een authenticator-app aan je account.',
  },
  verify: {
    title: 'Tweestapsverificatie',
    description: 'Vul de code uit je authenticator-app in.',
  },
  done: {
    title: 'Tweestapsverificatie',
    description: 'Je aanmelding is bevestigd.',
  },
};

/**
 * The second sign-in step for admins, providers and editors who kept an
 * authenticator; the copy is role-neutral. Outside the `(dashboard)` group and
 * exempt from the middleware's cookie check, because no session exists yet:
 * all it has is the short-lived `cms_mfa` challenge, which this page resolves
 * against the database (`getCurrentMfaChallenge()`). Every step it offers is
 * re-checked by its server action (`src/lib/cms/mfa/flow.ts`).
 *
 * `done` keeps the same tree as the other steps on purpose, so the recovery
 * codes in the client component survive the re-render that follows the
 * session cookie being set (`MfaSignIn`).
 */
export default async function AdminMfaPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeAdminPath((await searchParams).next ?? '');
  const challenge = await getCurrentMfaChallenge();
  const user = challenge ? null : await getCurrentCmsUser();
  const signedIn =
    Boolean(user) && cmsAccessDenial(user, { allowMustChangePassword: true }) === null;

  if (!challenge && !signedIn) {
    return (
      <AdminAuthFrame
        title="Aanmelding verlopen"
        description="Deze stap is niet meer geldig. Meld je opnieuw aan met je e-mailadres en wachtwoord."
      >
        <Link
          href={`/admin/login?next=${encodeURIComponent(next)}`}
          className="text-sm underline underline-offset-4 hover:text-primary"
        >
          Naar aanmelden
        </Link>
      </AdminAuthFrame>
    );
  }

  const step: MfaSignInStep = challenge ? challenge.step : 'done';
  return (
    <AdminAuthFrame wide title={COPY[step].title} description={COPY[step].description}>
      <MfaSignIn step={step} next={next} />
    </AdminAuthFrame>
  );
}
