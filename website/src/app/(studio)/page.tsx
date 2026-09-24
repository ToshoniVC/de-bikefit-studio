import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StudioPageView } from '@/components/studio/page-view';
import { getSiteSettings } from '@/lib/cms/content';
import { defaultLocale } from '@/lib/studio/locale';
import { buildPageMetadata, notFoundMetadata } from '@/lib/studio/seo';
import { getStudioPage } from '@/lib/studio/site';

/**
 * The site root: the Dutch home page, served from the CMS.
 *
 * It is a real static route rather than a case inside `[...slug]`, so it always
 * wins the routing table and Next can treat it independently.
 *
 * The home page's slug in `cms_pages` is the empty string (see
 * `normalizeSlug()` in `content.ts`).
 */

/**
 * Rendered per request. Published content must go live the moment an admin
 * presses Publish, not at the next deploy — `unstable_cache` in `content.ts`
 * plus `revalidateContent()` already give the caching, so the dynamic render is
 * a thin shell around a cached read. It also keeps `next build` database-free.
 */
export const dynamic = 'force-dynamic';

const HOME_SLUG = '';

export async function generateMetadata(): Promise<Metadata> {
  const studio = await getStudioPage(defaultLocale, HOME_SLUG);
  if (!studio) return notFoundMetadata(await getSiteSettings(defaultLocale));
  return buildPageMetadata(studio);
}

export default async function StudioHomePage() {
  const studio = await getStudioPage(defaultLocale, HOME_SLUG);
  // Nothing published yet (a fresh database before `npm run cms:seed`).
  if (!studio) notFound();
  return <StudioPageView studio={studio} />;
}
