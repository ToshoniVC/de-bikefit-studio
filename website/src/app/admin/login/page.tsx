import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { LoginForm } from '@/components/admin/login-form';
import { getCurrentCmsUser } from '@/lib/cms/auth';

export const metadata: Metadata = {
  title: 'Aanmelden · Beheer',
  robots: { index: false, follow: false },
};

/**
 * The only admin route an anonymous visitor may reach (see `middleware.ts`).
 * It sits outside the `(dashboard)` route group, so the gated layout never
 * runs here.
 */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const user = await getCurrentCmsUser();
  if (user) redirect(user.mustChangePassword ? '/admin/password' : '/admin');

  const safeNext =
    next && next.startsWith('/admin') && !next.startsWith('//') && !next.includes('\\')
      ? next
      : '/admin';

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm rounded-xl bg-card p-5 ring-1 ring-foreground/10">
        <h1 className="font-heading text-xl font-semibold tracking-tight">Beheer</h1>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          Meld je aan om de website te beheren.
        </p>
        <LoginForm next={safeNext} />
      </div>
    </div>
  );
}
