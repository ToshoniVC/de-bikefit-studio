import type { Metadata } from 'next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { signInWithEmail } from '@/lib/auth-actions';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 px-4 py-20 sm:px-6">
      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter your email to continue. (Temporary dev login — no password yet.)
        </p>
      </div>

      <form action={signInWithEmail} className="flex flex-col gap-3">
        <Input
          type="email"
          name="email"
          placeholder="you@example.com"
          required
          autoFocus
          aria-label="Email address"
        />
        {error ? <p className="text-sm text-brand">Please enter a valid email address.</p> : null}
        <Button type="submit" className="font-display uppercase tracking-wide">
          Continue
        </Button>
      </form>
    </div>
  );
}
