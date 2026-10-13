import { describe, expect, it } from 'vitest';
import { validateBlock, validateNavigationItems } from '@/lib/cms/blocks';
import {
  OFFER_CTA_LABEL,
  offerFromPage,
  offerPageSlug,
  sortOffers,
  type CatalogueOffer,
} from '@/lib/offers/catalogue';
import { DEFAULT_OFFERS } from '@/lib/offers/defaults';
import {
  AANBOD_PAGES,
  AANBOD_REDIRECTS,
  FOOTER_MENU,
  MAIN_MENU,
  RETIRED_PAGE_SLUG,
  TEAM_MEMBERS,
} from './aanbod';

function page(slug: string) {
  const found = AANBOD_PAGES.find((entry) => entry.slug === slug);
  if (!found) throw new Error(`no seed page ${slug}`);
  return found;
}

/** What `listPublishedOffers()` would return once these pages are published. */
function catalogue(): CatalogueOffer[] {
  return sortOffers(
    AANBOD_PAGES.map((entry) => offerFromPage({ slug: entry.slug, blocks: entry.blocks })).filter(
      (entry): entry is CatalogueOffer => entry !== null,
    ),
  );
}

const allText = JSON.stringify(AANBOD_PAGES);

describe('aanbod rollout pages', () => {
  it('every block validates against the registry (publish would not be blocked)', () => {
    for (const entry of AANBOD_PAGES) {
      entry.blocks.forEach((block, index) => {
        const result = validateBlock(block.type, block.data);
        expect(result.ok, `${entry.slug || 'home'} block ${index} (${block.type})`).toBe(true);
      });
    }
  });

  it('owns exactly the intended slugs and never the retired one', () => {
    expect(AANBOD_PAGES.map((entry) => entry.slug)).toEqual([
      '',
      'aanbod',
      ...DEFAULT_OFFERS.map((entry) => offerPageSlug(entry.slug)),
      'voor-wie',
      'bikefit',
      'ons-team',
    ]);
    expect(AANBOD_PAGES.some((entry) => entry.slug === RETIRED_PAGE_SLUG)).toBe(false);
  });

  it('home: the first section after the hero is the grouped offer, not "Voor wie"', () => {
    const [hero, first] = page('').blocks;
    expect(hero.type).toBe('hero');
    expect(hero.data.title).toBe('Meer plezier.');
    expect(hero.data.titleEmphasis).toBe('Op jouw fiets.');
    expect(first.type).toBe('offerCatalogue');
    expect((first.data.groups as { category: string }[]).map((group) => group.category)).toEqual([
      'bikefit',
      'begeleiding',
    ]);
    expect((first.data.cta as { href: string }).href).toBe('/aanbod');
  });

  it('/aanbod shows both groups; the catalogue derives all seven offers from their pages', () => {
    const block = page('aanbod').blocks.find((entry) => entry.type === 'offerCatalogue');
    expect(block?.data.showPrices).toBe(true);
    const offers = catalogue();
    expect(offers.map((entry) => entry.slug)).toEqual(DEFAULT_OFFERS.map((entry) => entry.slug));
    expect(offers.filter((entry) => entry.category === 'bikefit')).toHaveLength(5);
    expect(offers.filter((entry) => entry.category === 'begeleiding')).toHaveLength(2);
    for (const entry of offers) {
      expect(entry.path).toBe(`/aanbod/${entry.slug}`);
      expect(entry.priceLabel).toBe('Prijs op aanvraag');
    }
  });

  it('catalogue cards and detail pages agree (one source per offer)', () => {
    for (const defaults of DEFAULT_OFFERS) {
      const detail = page(offerPageSlug(defaults.slug));
      const offerBlocks = detail.blocks.filter((block) => block.type === 'offer');
      expect(offerBlocks).toHaveLength(1);
      const data = offerBlocks[0].data;
      expect(detail.title).toBe(defaults.title);
      expect(data.title).toBe(defaults.title);
      expect(data.ctaLabel).toBe(OFFER_CTA_LABEL);
      expect(data.goal).toBe(defaults.goal);
      expect(data.contents).toEqual(defaults.contents);
      expect(data.extras).toEqual(defaults.extras);
      expect(String(data.extrasNote)).toMatch(/vooraf/);
      expect(data.bookingServiceSlugs).toEqual(defaults.bookingServiceSlugs);
      const card = catalogue().find((entry) => entry.slug === defaults.slug);
      expect(card?.title).toBe(data.title);
      expect(card?.summary).toBe(defaults.summary);
    }
  });

  it('/bikefit keeps the explanation and process, adds 3D analysis, and lists the new Bikefit offer', () => {
    const blocks = page('bikefit').blocks;
    const types = blocks.map((block) => block.type);
    expect(types).toContain('process');
    expect(JSON.stringify(blocks)).toContain('3D-bewegingsanalyse');
    expect(JSON.stringify(blocks)).not.toMatch(/Vier manieren om te boeken|Volwassenenfit/);
    const catalogueBlock = blocks.find((block) => block.type === 'offerCatalogue');
    expect(catalogueBlock?.data.groups).toEqual([expect.objectContaining({ category: 'bikefit' })]);
  });

  it('/voor-wie covers every audience and highlights juniors without a price promise', () => {
    const text = JSON.stringify(page('voor-wie').blocks);
    for (const audience of [
      'Jonge fietsers',
      'Beginners',
      'ervaren',
      'Recreatief',
      'competitief',
      'gravel',
      'mountainbike',
      'Woon-werk',
      'e-bike',
    ]) {
      expect(text).toContain(audience);
    }
    expect(text).toContain('Jonge fietsers groeien. Hun fiets groeit niet vanzelf mee.');
    expect(text).not.toMatch(/€|korting|gratis|\d+\s*%/i);
  });

  it('/ons-team: three real names, only Rutger has a sourced bio, no portraits, no invented credentials', () => {
    const team = page('ons-team').blocks.find((block) => block.type === 'team');
    const members = team?.data.members as typeof TEAM_MEMBERS;
    expect(members.map((member) => member.name)).toEqual([
      'Rutger Roelandts',
      'Robin Van Lierde',
      'Goran Van de Walle',
    ]);
    for (const member of members) {
      expect('image' in member).toBe(false);
    }
    for (const member of members.slice(1)) {
      expect(member.role).toBe('');
      expect(member.bio).toEqual([
        `${member.name.split(' ')[0]} maakt deel uit van het team van De Bikefit Studio.`,
        'Een uitgebreid profiel volgt binnenkort.',
      ]);
      expect(member.internalNote).toMatch(/^OPEN \(register T-/);
    }
  });

  it('makes no medical, guarantee or device-brand claims', () => {
    expect(allText).not.toMatch(
      /garantie|gegarandeerd|garanderen|voorkomt blessures|blessurevrij|geneest|behandel/i,
    );
    expect(allText).not.toMatch(/Retül|Retul|Vicon|Kinetic|Gebiomized|idmatch/i);
    // "diagnose" only ever appears negated.
    for (const match of allText.matchAll(/[^.]*diagnose[^.]*/gi)) {
      expect(match[0]).toMatch(/geen medische diagnose/);
    }
  });

  it('contains no unresolved placeholder text', () => {
    expect(allText).not.toMatch(/TODO|TBD|lorem|\[[A-Z-]+\]|XXX/);
  });
});

describe('aanbod navigation', () => {
  it('main menu: Aanbod, Voor wie, Bikefit, Ons team, Contact — no Home', () => {
    expect(validateNavigationItems(MAIN_MENU).ok).toBe(true);
    expect(MAIN_MENU.map((item) => [item.label, item.href])).toEqual([
      ['Aanbod', '/aanbod'],
      ['Voor wie', '/voor-wie'],
      ['Bikefit', '/bikefit'],
      ['Ons team', '/ons-team'],
      ['Contact', '/contact'],
    ]);
  });

  it('footer keeps FAQ, booking and both legal pages; no link to the retired page', () => {
    expect(validateNavigationItems(FOOTER_MENU).ok).toBe(true);
    const hrefs = FOOTER_MENU.map((item) => item.href);
    for (const href of ['/veelgestelde-vragen', '/afspraak', '/privacy', '/algemene-voorwaarden']) {
      expect(hrefs).toContain(href);
    }
    expect(hrefs).not.toContain('/over-ons');
    expect(hrefs).not.toContain('/');
  });

  it('redirects /over-ons permanently to /ons-team', () => {
    expect(AANBOD_REDIRECTS).toEqual([
      expect.objectContaining({ fromPath: '/over-ons', toPath: '/ons-team', statusCode: 301 }),
    ]);
  });
});
