import type { BlockInstance } from '@/lib/cms/blocks';
import { sectionAnchors, visibleBlocks } from '@/lib/studio/blocks';
import type { StudioLocale } from '@/lib/studio/locale';
import { AudienceBlock } from './audience';
import { ContactBlock } from './contact';
import { CtaBlock } from './cta';
import { FaqBlock } from './faq';
import { HeroBlock } from './hero';
import { ImageTextBlock } from './image-text';
import { PricingBlock } from './pricing';
import { ProcessBlock } from './process';
import { RichTextBlock } from './rich-text';
import type { HeadingLevel } from './section';
import { ServicesBlock } from './services';
import { TestimonialBlock } from './testimonial';

/**
 * Maps `published_snapshot.blocks` onto components — the only place the public
 * site decides what a block looks like.
 *
 * Three invariants it enforces for the whole page:
 *
 *  1. **One `<h1>`.** The first hero owns it; if a page somehow has no hero,
 *     the first visible section does. Every other section heading is an `<h2>`.
 *  2. **Placeholders never reach a visitor.** `visibleBlocks()` drops the
 *     `pricing` and `testimonial` blocks while `isPlaceholder` is set.
 *  3. **Stable anchors.** `sectionAnchors()` gives each section a readable
 *     `id` (`#werkwijze`, `#vragen`) that navigation can deep link to.
 *
 * The switch is exhaustive over the registry: adding a block type there makes
 * this file fail to typecheck until a renderer exists for it.
 */
export function BlockRenderer({
  blocks,
  locale,
}: {
  blocks: readonly BlockInstance[];
  locale: StudioLocale;
}) {
  const anchors = sectionAnchors(blocks);
  const visible = visibleBlocks(blocks);
  const headingOwner = visible.find((block) => block.type === 'hero')?.id ?? visible[0]?.id;

  return (
    <>
      {visible.map((block) => (
        <StudioBlock
          key={block.id}
          block={block}
          anchor={anchors.get(block.id)}
          headingLevel={block.id === headingOwner ? 1 : 2}
          locale={locale}
        />
      ))}
    </>
  );
}

function StudioBlock({
  block,
  anchor,
  headingLevel,
  locale,
}: {
  block: BlockInstance;
  anchor?: string;
  headingLevel: HeadingLevel;
  locale: StudioLocale;
}) {
  const common = { anchor, headingLevel, locale };

  switch (block.type) {
    case 'hero':
      return <HeroBlock data={block.data} {...common} />;
    case 'richText':
      return <RichTextBlock data={block.data} {...common} />;
    case 'services':
      return <ServicesBlock data={block.data} {...common} />;
    case 'process':
      return <ProcessBlock data={block.data} {...common} />;
    case 'audience':
      return <AudienceBlock data={block.data} {...common} />;
    case 'faq':
      return <FaqBlock data={block.data} {...common} />;
    case 'cta':
      return <CtaBlock data={block.data} {...common} />;
    case 'imageText':
      return <ImageTextBlock data={block.data} {...common} />;
    case 'pricing':
      return <PricingBlock data={block.data} {...common} />;
    case 'contact':
      return <ContactBlock data={block.data} {...common} />;
    case 'testimonial':
      return <TestimonialBlock data={block.data} {...common} />;
    default: {
      // Exhaustiveness guard: a new registry type lands here as a type error.
      const exhaustive: never = block;
      void exhaustive;
      return null;
    }
  }
}
