import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { getSession } from '@/lib/session';
import { signOut } from '@/lib/auth-actions';

export const metadata: Metadata = { title: 'Account' };

export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect('/sign-in');

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="font-display text-3xl font-extrabold uppercase tracking-tight">My account</h1>
      <dl className="mt-6 space-y-3 text-sm">
        <div className="flex justify-between border-b py-2">
          <dt className="text-muted-foreground">Email</dt>
          <dd>{session.email}</dd>
        </div>
      </dl>
      <p className="mt-8 text-sm text-muted-foreground">Order history will appear here soon.</p>

      <form action={signOut} className="mt-6">
        <Button type="submit" variant="outline" className="font-display uppercase tracking-wide">
          Sign out
        </Button>
      </form>
    </div>
  );
}
