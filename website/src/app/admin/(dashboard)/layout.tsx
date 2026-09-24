import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AdminShell } from '@/components/admin/shell';
import { CmsAuthError, requireCmsUser } from '@/lib/cms/auth';

export const metadata: Metadata = {
  title: { default: 'Beheer', template: '%s · Beheer' },
  robots: { index: false, follow: false },
};

/**
 * The real security boundary for `/admin`.
 *
 * `middleware.ts` only checks that a `cms_session` cookie exists — a forged
 * cookie sails past it and is rejected here, where `requireCmsUser()` resolves
 * the session against the database.
 *
 * `/admin/login`, `/admin/password` and `/admin/logout` sit outside this route
 * group so they can render without (or before) a complete session.
 */
export default async function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let user;
  try {
    user = await requireCmsUser();
  } catch (error) {
    if (error instanceof CmsAuthError) redirect('/admin/login');
    throw error;
  }

  // Blocking gate: nothing in the admin is reachable with a temporary password.
  if (user.mustChangePassword) redirect('/admin/password');

  return <AdminShell user={user}>{children}</AdminShell>;
}
