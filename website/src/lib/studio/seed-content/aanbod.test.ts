import { describe, expect, it } from 'vitest';
import { validateBlock, validateNavigationItems } from '@/lib/cms/blocks';
import { DEFAULT_OFFERS } from '@/lib/offers/defaults';
import {
  AANBOD_PAGES,
  AANBOD_REDIRECTS,
  FOOTER_MENU,
  MAIN_MENU,
  RETIRED_PAGE_SLUG,
  TEAM_MEMBERS,
} from './aanbod';
import { CADEAUBON_CARD } from './cadeaubon';

function page(slug: string) {
  const found = AANBOD_PAGES.find((entry) => entry.slug === slug);
  if (!found) throw new Error(`no seed page ${slug}`);
  return found;
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

  it('owns exactly the intended slugs: no offer sub-pages (offerings are rows), never the retired one', () => {
    expect(AANBOD_PAGES.map((entry) => entry.slug)).toEqual([
      '',
      'aanbod',
      'voor-wie',
      'bikefit',
      'ons-team',
    ]);
    expect(AANBOD_PAGES.some((entry) => entry.slug === RETIRED_PAGE_SLUG)).toBe(false);
    expect(allText).not.toContain('"type":"offer"');
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
    expect(first.data.showPrices).toBe(false);
    expect(first.data.extraCards ?? []).toEqual([]);
  });

  it('/aanbod shows all three groups with prices, and the gift voucher as the one extra card', () => {
    const block = page('aanbod').blocks.find((entry) => entry.type === 'offerCatalogue');
    expect(block?.data.showPrices).toBe(true);
    expect((block?.data.groups as { category: string }[]).map((group) => group.category)).toEqual([
      'bikefit',
      'begeleiding',
      'overige',
    ]);
    expect(block?.data.extraCards).toEqual([CADEAUBON_CARD]);
    expect(CADEAUBON_CARD).toMatchObject({
      category: 'overige',
      href: '/cadeaubon',
      priceLabel: 'Bedrag naar keuze',
    });
  });

  it('the seven offerings are the brief, verbatim: no price, no device brand, an honest duration', () => {
    const text = JSON.stringify(DEFAULT_OFFERS);
    expect(DEFAULT_OFFERS.map((entry) => entry.content.title)).toEqual([
      'Bikefit – aankoop nieuwe fiets',
      'Bikefit – huidige fiets',
      'Voetanalyse',
      'Zadelanalyse',
      'Afstellen schoenplaatjes',
      'Lactaattest',
      'Coaching',
    ]);
    for (const entry of DEFAULT_OFFERS) {
      expect(entry.content.goal).toBe(entry.content.summary);
      expect(entry.content.extrasNote).toMatch(/vooraf/);
      expect(entry.content.image.url).toMatch(/^\/images\/editorial\//);
      expect(entry.content.metaDescription.length).toBeGreaterThan(40);
    }
    expect(text).not.toMatch(/€|\bgratis\b/);
    expect(text).not.toMatch(/Retül|Retul|Vicon|Kinetic|Gebiomized|idmatch/i);
  });

  it('/bikefit keeps the explanation and process, adds 3D analysis, and lists the Bikefit offers', () => {
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
    for (const match of allText.matchAll(/[^.]*diagnose[^.]*/gi)) {
      expect(match[0]).toMatch(/geen medische diagnose/);
    }
  });

  it('contains no unresolved placeholder text', () => {
    expect(allText).not.toMatch(/TODO|TBD|lorem|\[[A-Z-]+\]|XXX/);
  });
});

describe('aanbod navigation', () => {
  it('main menu: Aanbod, Voor wie, Bikefit, Ons team, Contact (→ /afspraak) — no Home', () => {
    expect(validateNavigationItems(MAIN_MENU).ok).toBe(true);
    expect(MAIN_MENU.map((item) => [item.label, item.href])).toEqual([
      ['Aanbod', '/aanbod'],
      ['Voor wie', '/voor-wie'],
      ['Bikefit', '/bikefit'],
      ['Ons team', '/ons-team'],
      ['Contact', '/afspraak'],
    ]);
  });

  it('footer keeps FAQ, booking and both legal pages; no link to the retired page', () => {
    expect(validateNavigationItems(FOOTER_MENU).ok).toBe(true);
    const hrefs = FOOTER_MENU.map((item) => item.href);
    for (const href of ['/veelgestelde-vragen', '/afspraak', '/privacy', '/algemene-voorwaarden']) {
      expect(hrefs).toContain(href);
    }
    expect(hrefs).not.toContain('/over-ons');
    expect(hrefs).not.toContain('/contact');
    expect(hrefs).not.toContain('/');
  });

  it('redirects /over-ons to /ons-team and the old voucher path to /cadeaubon, permanently', () => {
    expect(AANBOD_REDIRECTS).toEqual([
      expect.objectContaining({ fromPath: '/over-ons', toPath: '/ons-team', statusCode: 301 }),
      expect.objectContaining({
        fromPath: '/aanbod/cadeaubon',
        toPath: '/cadeaubon',
        statusCode: 301,
      }),
    ]);
  });
});
