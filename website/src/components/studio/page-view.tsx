import Link from 'next/link';
import {
  breadcrumbJsonLd,
  faqJsonLd,
  jsonLdDocument,
  servicesJsonLd,
  webPageJsonLd,
  type BreadcrumbEntry,
} from '@/lib/studio/jsonld';
import { absoluteUrl, type StudioPage } from '@/lib/studio/site';
import { BlockRenderer } from './blocks';
import { JsonLd } from './json-ld';

/**
 * Renders one published page: its structured data, its breadcrumb and its
 * blocks.
 *
 * The breadcrumb is rendered as visible markup *and* as `BreadcrumbList`
 * JSON-LD from the same array, so the two can never disagree — which is the
 * whole point of structured data.
 */
export function StudioPageView({ studio }: { studio: StudioPage }) {
  const { page, settings, canonical, locale } = studio;
  const origin = absoluteUrl('/').replace(/\/+$/, '');
  const isHome = page.slug === '';
  const blocks = page.snapshot.blocks;

  const trail: BreadcrumbEntry[] = isHome
    ? []
    : [
        { name: 'Home', url: `${origin}/` },
        { name: page.title, url: canonical },
      ];

  const description =
    page.snapshot.seo.metaDescription?.trim() ||
    settings.seo.defaultMetaDescription.trim() ||
    undefined;

  const graph = jsonLdDocument([
    webPageJsonLd({
      origin,
      canonical,
      locale,
      title: page.title,
      description,
      datePublished: page.publishedAt,
      dateModified: page.updatedAt,
      structuredDataType: page.snapshot.seo.structuredDataType,
      hasBreadcrumb: trail.length > 0,
    }),
    trail.length > 0 ? breadcrumbJsonLd(canonical, trail) : null,
    faqJsonLd(blocks, canonical),
    ...servicesJsonLd(blocks, settings, origin),
  ]);

  return (
    <>
      <JsonLd data={graph} />

      {trail.length > 0 ? (
        <nav className="studio-breadcrumb-bar" aria-label="Kruimelpad">
          <ol className="studio-breadcrumb">
            <li>
              <Link href="/">Home</Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page">{page.title}</li>
          </ol>
        </nav>
      ) : null}

      <BlockRenderer blocks={blocks} locale={locale} />
    </>
  );
}
