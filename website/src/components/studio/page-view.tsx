import { Fragment } from 'react';
import Link from 'next/link';
import {
  breadcrumbJsonLd,
  faqJsonLd,
  jsonLdDocument,
  offerServiceJsonLd,
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
 * whole point of structured data. Nested pages (`/aanbod/voetanalyse`) get
 * their published ancestors in between.
 *
 * `requestedService` is the validated `?dienst=` value; only the booking
 * block reads it.
 */
export function StudioPageView({
  studio,
  requestedService = null,
}: {
  studio: StudioPage;
  requestedService?: string | null;
}) {
  const { page, settings, canonical, locale, parents } = studio;
  const origin = absoluteUrl('/').replace(/\/+$/, '');
  const isHome = page.slug === '';
  const blocks = page.snapshot.blocks;

  const trail: BreadcrumbEntry[] = isHome
    ? []
    : [
        { name: 'Home', url: `${origin}/` },
        ...parents.map((parent) => ({ name: parent.title, url: absoluteUrl(parent.path) })),
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
    offerServiceJsonLd(blocks, settings, origin, canonical),
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
            {parents.map((parent) => (
              <Fragment key={parent.path}>
                <li aria-hidden="true">/</li>
                <li>
                  <Link href={parent.path}>{parent.title}</Link>
                </li>
              </Fragment>
            ))}
            <li aria-hidden="true">/</li>
            <li aria-current="page">{page.title}</li>
          </ol>
        </nav>
      ) : null}

      <BlockRenderer blocks={blocks} locale={locale} page={{ slug: page.slug, requestedService }} />
    </>
  );
}
