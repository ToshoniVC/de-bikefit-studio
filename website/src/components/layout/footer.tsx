import Link from 'next/link';
import { mainNav, shopCategories } from '@/lib/nav';

export function SiteFooter() {
  return (
    <footer className="border-t bg-foreground text-background">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="space-y-3">
          <p className="font-display text-2xl font-extrabold uppercase tracking-tight">Qarakter</p>
          <p className="max-w-xs text-sm text-background/70">
            Boutique bikes for riders with character. Road, gravel and the kit that matters.
          </p>
        </div>

        <FooterColumn title="Explore" items={mainNav} />
        <FooterColumn title="Shop" items={shopCategories} />

        <div className="space-y-3">
          <p className="font-display text-sm font-semibold uppercase tracking-wide">Legal</p>
          <ul className="space-y-2 text-sm text-background/70">
            <li>
              <Link href="/policies/terms" className="hover:text-background">
                Terms
              </Link>
            </li>
            <li>
              <Link href="/policies/privacy" className="hover:text-background">
                Privacy
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-background/10">
        <div className="mx-auto max-w-7xl px-4 py-4 text-xs text-background/50 sm:px-6">
          © {new Date().getFullYear()} Qarakter. All rights reserved.
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, items }: { title: string; items: { title: string; href: string }[] }) {
  return (
    <div className="space-y-3">
      <p className="font-display text-sm font-semibold uppercase tracking-wide">{title}</p>
      <ul className="space-y-2 text-sm text-background/70">
        {items.map((item) => (
          <li key={item.href}>
            <Link href={item.href} className="hover:text-background">
              {item.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
