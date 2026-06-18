import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'About',
  description: 'The story behind Qarakter — a boutique bike store for riders with character.',
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="font-display text-4xl font-extrabold uppercase tracking-tight">About</h1>
      <article className="prose prose-neutral mt-6 max-w-none dark:prose-invert prose-headings:font-display prose-headings:uppercase prose-headings:tracking-tight">
        <p>
          Qarakter is a boutique bike store built by riders, for riders. We curate road and gravel
          machines we&apos;d ride ourselves, build every one by hand, and stand behind them long
          after they leave the shop.
        </p>
        <h2>What we believe</h2>
        <p>
          A bike should fit the rider, not the other way around. That&apos;s why every build is
          checked, dialled and ready to ride — no flat-pack compromises.
        </p>
        <h2>Visit us</h2>
        <p>
          Drop by for a coffee and a chat about your next build, or browse the full range in our{' '}
          <Link href="/shop">shop</Link>.
        </p>
      </article>
    </div>
  );
}
