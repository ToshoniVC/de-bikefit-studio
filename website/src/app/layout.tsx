import type { Metadata, Viewport } from 'next';
import { Inter, Barlow_Condensed } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';
import { SiteHeader } from '@/components/layout/header';
import { SiteFooter } from '@/components/layout/footer';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const barlow = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-barlow',
  display: 'swap',
});

// Auth UI is only mounted once Clerk is configured, so the app runs key-free.
const hasClerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export const metadata: Metadata = {
  title: {
    default: 'Qarakter — Boutique Bike Store',
    template: '%s · Qarakter',
  },
  description:
    'Qarakter is a boutique bike store: road, gravel and hand-picked accessories for riders with character.',
};

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
};

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${barlow.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <SiteHeader hasAuth={hasClerk} />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const shell = <RootShell>{children}</RootShell>;
  return hasClerk ? <ClerkProvider>{shell}</ClerkProvider> : shell;
}
