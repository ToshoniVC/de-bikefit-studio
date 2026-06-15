import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { compileMDX } from 'next-mdx-remote/rsc';
import { getPostBySlug, getPostSlugs } from '@/lib/mdx';

export async function generateStaticParams() {
  const slugs = await getPostSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) return { title: 'Post not found' };
  return { title: post.meta.title, description: post.meta.description };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) notFound();

  const { content } = await compileMDX({
    source: post.content,
    options: { parseFrontmatter: false },
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Link
        href="/blog"
        className="mb-8 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> Back to journal
      </Link>

      <header className="mb-8">
        <time className="text-xs uppercase tracking-wide text-muted-foreground">
          {new Date(post.meta.date).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </time>
        <h1 className="mt-2 font-display text-4xl font-extrabold uppercase leading-tight tracking-tight">
          {post.meta.title}
        </h1>
        {post.meta.author ? (
          <p className="mt-2 text-sm text-muted-foreground">By {post.meta.author}</p>
        ) : null}
      </header>

      <article className="prose prose-neutral max-w-none dark:prose-invert prose-headings:font-display prose-headings:uppercase prose-headings:tracking-tight prose-a:text-brand">
        {content}
      </article>
    </div>
  );
}
