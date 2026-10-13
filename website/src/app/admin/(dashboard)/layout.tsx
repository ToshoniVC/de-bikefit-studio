import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AdminShell } from '@/components/admin/shell';
import { CmsAuthError, requireCmsUser } from '@/lib/cms/auth';

export const metadata: Metadata = {
  title: { default: 'Beheer', template: '%s · Beheer' },
  robots: { index: false, follow: false },
};

/**
 * The rendering gate for `/admin`.
 *
 * `middleware.ts` only checks that a `cms_session` cookie exists — a forged
 * cookie sails past it and is rejected here, where `requireCmsUser()` resolves
 * the session against the database. A session whose password is still
 * temporary (`password_change_required`) is sent to `/admin/password`; an
 * admin session that did not pass two-step verification (`mfa_required`, e.g.
 * one from before MFA existed) is sent back to sign in, which leads through
 * `/admin/mfa`.
 *
 * Not the only gate: a layout does not stop a server action and does not
 * re-run on every navigation, so every page, action and repo call checks
 * `requireCmsUser()` / `requirePermission()` itself, and those refuse a
 * temporary-password or pre-MFA session as well (`src/lib/cms/guard.ts`).
 *
 * `/admin/login`, `/admin/mfa`, `/admin/password` and `/admin/logout` sit
 * outside this route group so they can render without (or before) a complete
 * session.
 */
export default async function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  let user;
  try {
    user = await requireCmsUser();
  } catch (error) {
    if (error instanceof CmsAuthError) {
      if (error.code === 'password_change_required') redirect('/admin/password');
      redirect(error.code === 'mfa_required' ? '/admin/login?mfa=1' : '/admin/login');
    }
    throw error;
  }

  return <AdminShell user={user}>{children}</AdminShell>;
}
