import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { AdminAuthFrame } from '@/components/admin/shell';
import { logoutAction } from '@/lib/cms/actions/auth';

export const metadata: Metadata = {
  title: 'Afmelden · Beheer',
  robots: { index: false, follow: false },
};

/**
 * Sign-out is a POST (a server action), never a plain GET link: a GET logout
 * can be triggered by any third-party page embedding the URL.
 */
export default function AdminLogoutPage() {
  return (
    <AdminAuthFrame
      centered
      title="Afmelden"
      description="Wil je je sessie beëindigen op dit toestel?"
    >
      <form action={logoutAction}>
        <Button type="submit" size="lg" className="w-full">
          Ja, afmelden
        </Button>
      </form>
      <p className="mt-4 text-sm">
        <Link href="/admin" className="underline underline-offset-4 hover:text-primary">
          Nee, terug naar het beheer
        </Link>
      </p>
    </AdminAuthFrame>
  );
}
