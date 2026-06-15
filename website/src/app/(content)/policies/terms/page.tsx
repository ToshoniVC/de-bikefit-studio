import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Terms of Service' };

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="font-display text-4xl font-extrabold uppercase tracking-tight">Terms</h1>
      <article className="prose prose-neutral mt-6 max-w-none dark:prose-invert">
        <p className="text-muted-foreground">
          Placeholder terms of service. Replace with your finalised legal copy before launch.
        </p>
      </article>
    </div>
  );
}
