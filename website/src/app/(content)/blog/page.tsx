import type { Metadata } from 'next';
import Link from 'next/link';
import { getAllPosts } from '@/lib/mdx';

export const metadata: Metadata = {
  title: 'Journal',
  description: 'Stories, build guides and ride reports from Qarakter.',
};

export default async function BlogIndexPage() {
  const posts = await getAllPosts();

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <header className="mb-10">
        <h1 className="font-display text-4xl font-extrabold uppercase tracking-tight">Journal</h1>
        <p className="mt-1 text-muted-foreground">Build guides, ride reports and shop news.</p>
      </header>

      {posts.length === 0 ? (
        <p className="text-muted-foreground">No posts yet. Add an .mdx file to src/content/blog.</p>
      ) : (
        <ul className="divide-y">
          {posts.map((post) => (
            <li key={post.slug} className="py-6">
              <Link href={`/blog/${post.slug}`} className="group block">
                <time className="text-xs uppercase tracking-wide text-muted-foreground">
                  {new Date(post.date).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </time>
                <h2 className="mt-1 font-display text-2xl font-semibold uppercase tracking-tight transition-colors group-hover:text-brand">
                  {post.title}
                </h2>
                <p className="mt-1 text-muted-foreground">{post.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
