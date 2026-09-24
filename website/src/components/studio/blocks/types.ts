import type { BlockTypeData } from '@/lib/cms/blocks';
import type { StudioLocale } from '@/lib/studio/locale';
import type { HeadingLevel } from './section';

/** Every block renderer takes the same four things. */
export type BlockProps<K extends keyof BlockTypeData> = {
  data: BlockTypeData[K];
  /** Stable `id` for deep links, or undefined for sections that get none. */
  anchor?: string;
  /** 1 only for the block that owns the page's single `<h1>`. */
  headingLevel: HeadingLevel;
  locale: StudioLocale;
};
