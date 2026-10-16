import type { BlockTypeData } from '@/lib/cms/blocks';
import type { CatalogueOfferEntry } from '@/lib/offers/offer-catalogue';
import type { StudioLocale } from '@/lib/studio/locale';
import type { HeadingLevel } from './section';

/**
 * What a block may know about the page it sits on. Kept small on purpose:
 * the page's own slug (an offer block derives its booking link from
 * `/aanbod/<slug>`), the validated `?dienst=` value, which only the
 * booking block reads, and on an offer page its resolved catalogue entry.
 */
export type BlockPageContext = {
  /** CMS slug of the page ('' = home). */
  slug: string;
  /** `?dienst=` after `parseServiceParam()`; `null` when absent or invalid. */
  requestedService: string | null;
  /** The offer page's catalogue entry with its Beheer → Aanbod settings; absent elsewhere. */
  offer?: CatalogueOfferEntry | null;
};

/** Every block renderer takes the same five things. */
export type BlockProps<K extends keyof BlockTypeData> = {
  data: BlockTypeData[K];
  /** Stable `id` for deep links, or undefined for sections that get none. */
  anchor?: string;
  /** 1 only for the block that owns the page's single `<h1>`. */
  headingLevel: HeadingLevel;
  locale: StudioLocale;
  page: BlockPageContext;
};
