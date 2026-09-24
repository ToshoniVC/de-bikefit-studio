import type { BlockInstance, SiteSettings } from '@/lib/cms/blocks';
import { isBookableServicesBlock, visibleBlocks } from './blocks';
import { localeTag, type StudioLocale } from './locale';

/**
 * Structured data (JSON-LD) for the public site.
 *
 * Three rules, applied without exception:
 *
 *  1. **Nothing is invented.** Every value comes from a published snapshot or
 *     from `cms_site_settings`. Fields with no known value (street address,
 *     e-mail, VAT number, prices, ratings) are omitted entirely rather than
 *     filled with a plausible guess.
 *  2. **It mirrors what is on screen.** The FAQ questions and answers are the
 *     same strings the `faq` block renders; `Service` entries are the same
 *     cards the `services` block renders. Placeholder blocks are hidden on the
 *     page *and* absent here.
 *  3. **One `@graph` per page.** Nodes reference each other by `@id`, so the
 *     Organization is declared once and reused.
 */

export type JsonLdNode = Record<string, unknown>;

/** Drops empty strings, empty arrays, null and undefined. */
function compact(node: JsonLdNode): JsonLdNode {
  const out: JsonLdNode = {};
  for (const [key, value] of Object.entries(node)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

export function organizationId(origin: string): string {
  return `${origin}/#organization`;
}

export function webSiteId(origin: string): string {
  return `${origin}/#website`;
}

/** `tel:+32473952633` → `+32473952633`; anything else is passed through. */
function telephoneOf(settings: SiteSettings): string {
  const href = settings.contact.phoneHref.trim();
  if (href.toLowerCase().startsWith('tel:')) return href.slice(4);
  return href || settings.contact.phoneLabel.trim();
}

function postalAddress(settings: SiteSettings): JsonLdNode | undefined {
  const { addressLines, postalCode, city, country } = settings.contact;
  const address = compact({
    '@type': 'PostalAddress',
    streetAddress: addressLines.filter(Boolean).join(', '),
    postalCode,
    addressLocality: city,
    addressCountry: country,
  });
  // Only worth emitting when we know more than the country default.
  return Object.keys(address).length > 2 ? address : undefined;
}

/**
 * The studio itself. `organization.type` is an editable setting so the schema
 * type can be narrowed (e.g. `HealthAndBeautyBusiness`, `SportsActivityLocation`)
 * without a code change; it falls back to `LocalBusiness`.
 */
export function organizationJsonLd(
  settings: SiteSettings,
  origin: string,
  options: { logoUrl?: string | null } = {},
): JsonLdNode {
  const { organization, site, contact } = settings;

  return compact({
    '@type': organization.type.trim() || 'LocalBusiness',
    '@id': organizationId(origin),
    name: site.name,
    legalName: organization.legalName,
    url: origin + '/',
    logo: options.logoUrl ?? undefined,
    image: options.logoUrl ?? undefined,
    description: site.mission || settings.seo.defaultMetaDescription,
    slogan: site.tagline,
    telephone: telephoneOf(settings),
    email: contact.email,
    vatID: organization.vatNumber,
    address: postalAddress(settings),
    areaServed: organization.areaServed,
    sameAs: organization.sameAs,
    priceRange: organization.priceRange,
    geo:
      organization.latitude !== null && organization.longitude !== null
        ? {
            '@type': 'GeoCoordinates',
            latitude: organization.latitude,
            longitude: organization.longitude,
          }
        : undefined,
  });
}

export function webSiteJsonLd(
  settings: SiteSettings,
  origin: string,
  locale: StudioLocale,
): JsonLdNode {
  return compact({
    '@type': 'WebSite',
    '@id': webSiteId(origin),
    url: origin + '/',
    name: settings.site.name,
    description: settings.seo.defaultMetaDescription,
    inLanguage: localeTag(locale),
    publisher: { '@id': organizationId(origin) },
  });
}

const PAGE_TYPES = new Set(['WebPage', 'AboutPage', 'ContactPage', 'CollectionPage']);

export type WebPageInput = {
  origin: string;
  canonical: string;
  locale: StudioLocale;
  title: string;
  description?: string;
  datePublished?: string | null;
  dateModified?: string | null;
  structuredDataType?: string | null;
  hasBreadcrumb: boolean;
};

export function webPageJsonLd(input: WebPageInput): JsonLdNode {
  const type =
    input.structuredDataType && PAGE_TYPES.has(input.structuredDataType)
      ? input.structuredDataType
      : 'WebPage';

  return compact({
    '@type': type,
    '@id': `${input.canonical}#webpage`,
    url: input.canonical,
    name: input.title,
    description: input.description,
    inLanguage: localeTag(input.locale),
    isPartOf: { '@id': webSiteId(input.origin) },
    about: { '@id': organizationId(input.origin) },
    datePublished: input.datePublished ?? undefined,
    dateModified: input.dateModified ?? undefined,
    breadcrumb: input.hasBreadcrumb ? { '@id': `${input.canonical}#breadcrumb` } : undefined,
  });
}

export type BreadcrumbEntry = { name: string; url: string };

export function breadcrumbJsonLd(canonical: string, trail: BreadcrumbEntry[]): JsonLdNode {
  return {
    '@type': 'BreadcrumbList',
    '@id': `${canonical}#breadcrumb`,
    itemListElement: trail.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: entry.name,
      item: entry.url,
    })),
  };
}

/**
 * FAQPage from the `faq` blocks that opted in via `emitStructuredData`.
 * Questions and answers are byte-identical to the rendered ones.
 */
export function faqJsonLd(
  blocks: readonly BlockInstance[],
  canonical: string,
): JsonLdNode | null {
  const items = visibleBlocks(blocks)
    .filter((block) => block.type === 'faq' && block.data.emitStructuredData)
    .flatMap((block) => (block.type === 'faq' ? block.data.items : []));

  if (items.length === 0) return null;

  return {
    '@type': 'FAQPage',
    '@id': `${canonical}#faq`,
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}

/**
 * `Service` nodes for the bookable fits. Name and description only — no price
 * (none exists), no aggregate rating (no real reviews exist).
 */
export function servicesJsonLd(
  blocks: readonly BlockInstance[],
  settings: SiteSettings,
  origin: string,
): JsonLdNode[] {
  return visibleBlocks(blocks)
    .filter(isBookableServicesBlock)
    .flatMap((block) => (block.type === 'services' ? block.data.cards : []))
    .map((card) =>
      compact({
        '@type': 'Service',
        name: card.title,
        description: card.body,
        provider: { '@id': organizationId(origin) },
        areaServed: settings.organization.areaServed,
      }),
    );
}

/** Wraps nodes into the single `@graph` document a page emits. */
export function jsonLdDocument(nodes: Array<JsonLdNode | null | undefined>): JsonLdNode {
  return {
    '@context': 'https://schema.org',
    '@graph': nodes.filter((node): node is JsonLdNode => Boolean(node)),
  };
}
