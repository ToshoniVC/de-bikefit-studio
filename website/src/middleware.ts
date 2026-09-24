import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Auth middleware.
 *
 * NOTE: Next.js 16 is migrating `middleware.ts` → `proxy.ts` and prints a
 * deprecation notice on every build. We keep `middleware.ts` because that is
 * the filename Clerk's `clerkMiddleware` expects; it still works in 16.x.
 * Renaming to `proxy.ts` is a follow-up once Clerk supports it.
 *
 * Two independent concerns live here:
 *
 *  1. **Webshop (Clerk).** Unchanged: `/account` and `/checkout` are protected
 *     when Clerk is configured, and the whole thing is a pass-through when it
 *     is not, so the app still runs key-free.
 *
 *  2. **CMS admin.** A cheap presence check on the `cms_session` cookie that
 *     bounces anonymous visitors from `/admin/*` to `/admin/login`. This is a
 *     convenience redirect, NOT the security boundary — the cookie is not
 *     validated here. Real validation happens in the `/admin` layout via
 *     `requireCmsUser()`, which hits the database.
 *
 * Deliberately no database access: middleware runs on the edge runtime, where
 * neither the Neon HTTP client's connection reuse nor PGlite's WASM/filesystem
 * access belongs.
 */

const isProtectedRoute = createRouteMatcher(['/account(.*)', '/checkout(.*)']);

/**
 * Same test as `features.clerk` in `src/lib/env.ts`, but read literally on
 * purpose: middleware runs on the edge runtime, where Next wires up only the
 * variables it finds as literal `process.env.X` reads at build time. The
 * whole-object read in `env.ts` would see nothing there. This is the one
 * documented exception to "env only through `src/lib/env.ts`".
 */
const hasClerk = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
);

/** Must match `SESSION_COOKIE_NAME` in `src/lib/cms/session.ts`. */
const CMS_SESSION_COOKIE = 'cms_session';

/** `/admin/login` is the only admin route an anonymous visitor may reach. */
function isGuardedAdminRoute(pathname: string): boolean {
  if (!pathname.startsWith('/admin')) return false;
  return !(pathname === '/admin/login' || pathname.startsWith('/admin/login/'));
}

/**
 * Returns a redirect to the login page when an admin route is requested
 * without a session cookie, otherwise null.
 */
function guardAdmin(req: NextRequest): NextResponse | null {
  const { pathname, search } = req.nextUrl;
  if (!isGuardedAdminRoute(pathname)) return null;
  if (req.cookies.get(CMS_SESSION_COOKIE)?.value) return null;

  const loginUrl = new URL('/admin/login', req.url);
  // Let the login page send the user back where they were headed.
  loginUrl.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

const clerk = clerkMiddleware(async (auth, req) => {
  const adminRedirect = guardAdmin(req);
  if (adminRedirect) return adminRedirect;

  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export default hasClerk
  ? clerk
  : function middleware(req: NextRequest) {
      return guardAdmin(req) ?? NextResponse.next();
    };

export const config = {
  matcher: [
    // Skip Next internals and static files, run on everything else.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run on API routes.
    '/(api|trpc)(.*)',
  ],
};
