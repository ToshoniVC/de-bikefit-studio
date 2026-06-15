'use client';

import { SignInButton, UserButton, useUser } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';

/**
 * Clerk-backed auth controls. Only rendered when Clerk is configured (see
 * RootLayout), so it is always inside a ClerkProvider when mounted. Uses the
 * useUser() hook to branch, since this Clerk version doesn't export the
 * <SignedIn>/<SignedOut> control components.
 */
export function HeaderAuth() {
  const { isLoaded, isSignedIn } = useUser();

  if (!isLoaded) {
    return <div className="size-8" aria-hidden />;
  }

  if (isSignedIn) {
    return <UserButton />;
  }

  return (
    <SignInButton mode="modal">
      <Button variant="ghost" size="sm" className="font-display uppercase tracking-wide">
        Sign in
      </Button>
    </SignInButton>
  );
}
