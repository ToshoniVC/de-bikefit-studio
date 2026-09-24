import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
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
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm rounded-xl bg-card p-5 text-center ring-1 ring-foreground/10">
        <h1 className="font-heading text-xl font-semibold tracking-tight">Afmelden</h1>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          Wil je je sessie beëindigen op dit toestel?
        </p>
        <form action={logoutAction}>
          <Button type="submit" size="lg" className="w-full">
            Ja, afmelden
          </Button>
        </form>
        <p className="mt-3 text-xs">
          <Link href="/admin" className="underline underline-offset-4">
            Nee, terug naar het beheer
          </Link>
        </p>
      </div>
    </div>
  );
}
