import Link from 'next/link';
import { mainNav } from '@/lib/nav';
import { MobileNav } from './mobile-nav';
import { CartSheet } from '@/components/shop/cart-sheet';
import { Button } from '@/components/ui/button';
import { getSession } from '@/lib/session';
import { signOut } from '@/lib/auth-actions';

export async function SiteHeader() {
  const session = await getSession();

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6">
        <div className="flex items-center gap-2">
          <MobileNav />
          <Link
            href="/"
            className="font-display text-2xl font-extrabold uppercase leading-none tracking-tight"
          >
            Qarakter
          </Link>
        </div>

        <nav className="hidden items-center gap-8 font-display text-sm font-semibold uppercase tracking-wide md:flex">
          {mainNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.title}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1">
          {session ? (
            <>
              <Button
                render={<Link href="/account" />}
                variant="ghost"
                size="sm"
                className="font-display uppercase tracking-wide"
              >
                Account
              </Button>
              <form action={signOut}>
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  className="font-display uppercase tracking-wide"
                >
                  Sign out
                </Button>
              </form>
            </>
          ) : (
            <Button
              render={<Link href="/sign-in" />}
              variant="ghost"
              size="sm"
              className="font-display uppercase tracking-wide"
            >
              Sign in
            </Button>
          )}
          <CartSheet />
        </div>
      </div>
    </header>
  );
}
