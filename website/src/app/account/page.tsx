import { currentUser } from '@clerk/nextjs/server';
import { FeatureNotice } from '@/components/feature-notice';

const hasClerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export const metadata = { title: 'Account' };

export default async function AccountPage() {
  if (!hasClerk) {
    return (
      <div className="px-4 py-16">
        <FeatureNotice
          title="Auth not configured"
          body="This route is protected by Clerk middleware. Add Clerk keys to .env.local to use it."
        />
      </div>
    );
  }

  const user = await currentUser();

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="font-display text-3xl font-extrabold uppercase tracking-tight">My account</h1>
      <dl className="mt-6 space-y-3 text-sm">
        <div className="flex justify-between border-b py-2">
          <dt className="text-muted-foreground">Name</dt>
          <dd>{[user?.firstName, user?.lastName].filter(Boolean).join(' ') || '—'}</dd>
        </div>
        <div className="flex justify-between border-b py-2">
          <dt className="text-muted-foreground">Email</dt>
          <dd>{user?.emailAddresses?.[0]?.emailAddress ?? '—'}</dd>
        </div>
      </dl>
      <p className="mt-8 text-sm text-muted-foreground">Order history will appear here soon.</p>
    </div>
  );
}
