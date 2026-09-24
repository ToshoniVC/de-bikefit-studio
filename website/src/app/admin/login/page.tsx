import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { LoginForm } from '@/components/admin/login-form';
import { AdminAuthFrame } from '@/components/admin/shell';
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
    <AdminAuthFrame title="Beheer" description="Meld je aan om de website te beheren.">
      <LoginForm next={safeNext} />
    </AdminAuthFrame>
  );
}
