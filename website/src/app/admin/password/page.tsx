import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PasswordForm } from '@/components/admin/password-form';
import { getCurrentCmsUser } from '@/lib/cms/auth';

export const metadata: Metadata = {
  title: 'Wachtwoord wijzigen · Beheer',
  robots: { index: false, follow: false },
};

/**
 * Blocking gate for `must_change_password`. It lives outside the `(dashboard)`
 * group on purpose: the dashboard layout redirects here, so putting it inside
 * would loop.
 */
export default async function ForcedPasswordChangePage() {
  const user = await getCurrentCmsUser();
  if (!user) redirect('/admin/login?next=/admin/password');

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md rounded-xl bg-card p-5 ring-1 ring-foreground/10">
        <h1 className="font-heading text-xl font-semibold tracking-tight">
          {user.mustChangePassword ? 'Kies een nieuw wachtwoord' : 'Wachtwoord wijzigen'}
        </h1>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          {user.mustChangePassword
            ? 'Je account gebruikt nog een tijdelijk wachtwoord. Kies eerst een eigen wachtwoord; daarna kan je verder.'
            : 'Je kan je wachtwoord hier aanpassen.'}
        </p>

        <PasswordForm next="/admin" />

        {user.mustChangePassword ? null : (
          <p className="mt-4 text-xs">
            <Link href="/admin" className="underline underline-offset-4">
              Terug naar het beheer
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
