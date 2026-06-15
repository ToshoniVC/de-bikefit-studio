import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Auth middleware.
 *
 * NOTE: Next.js 16 is migrating `middleware.ts` → `proxy.ts`. We keep
 * `middleware.ts` because that is the filename Clerk's `clerkMiddleware`
 * expects; it still works in 16.x (with a deprecation notice).
 *
 * When Clerk isn't configured this is a pass-through, so every route keeps
 * working during the skeleton phase instead of 500-ing on a missing key.
 */
const isProtectedRoute = createRouteMatcher(['/account(.*)', '/checkout(.*)']);

const hasClerk = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
);

const clerk = clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export default hasClerk
  ? clerk
  : function middleware(_req: NextRequest) {
      return NextResponse.next();
    };

export const config = {
  matcher: [
    // Skip Next internals and static files, run on everything else.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run on API routes.
    '/(api|trpc)(.*)',
  ],
};
