import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const BLOG_DIR = path.join(process.cwd(), 'src/content/blog');

export type PostFrontmatter = {
  title: string;
  description: string;
  date: string; // ISO date string
  author?: string;
  tags?: string[];
  cover?: string;
};

export type PostMeta = PostFrontmatter & { slug: string };

/**
 * Minimal YAML frontmatter parser for the small, controlled set of keys we use
 * in blog posts. Avoids pulling in gray-matter; `next-mdx-remote`'s compileMDX
 * does the actual MDX rendering at the route level.
 */
function parseFrontmatter(raw: string): { data: PostFrontmatter; content: string } {
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(raw);
  if (!match) {
    return { data: { title: '', description: '', date: '' }, content: raw };
  }
  const [, block, content] = match;
  const data: Record<string, unknown> = {};
  for (const line of block.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value: unknown = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    }
    data[key] = value;
  }
  return { data: data as PostFrontmatter, content };
}

export async function getPostSlugs(): Promise<string[]> {
  try {
    const files = await fs.readdir(BLOG_DIR);
    return files.filter((f) => f.endsWith('.mdx')).map((f) => f.replace(/\.mdx$/, ''));
  } catch {
    return [];
  }
}

export async function getPostBySlug(
  slug: string,
): Promise<{ meta: PostMeta; content: string } | null> {
  try {
    const raw = await fs.readFile(path.join(BLOG_DIR, `${slug}.mdx`), 'utf8');
    const { data, content } = parseFrontmatter(raw);
    return { meta: { ...data, slug }, content };
  } catch {
    return null;
  }
}

export async function getAllPosts(): Promise<PostMeta[]> {
  const slugs = await getPostSlugs();
  const posts = await Promise.all(slugs.map((slug) => getPostBySlug(slug)));
  return posts
    .filter((p): p is { meta: PostMeta; content: string } => p !== null)
    .map((p) => p.meta)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}
