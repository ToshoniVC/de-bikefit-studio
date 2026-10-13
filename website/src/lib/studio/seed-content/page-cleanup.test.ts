import { describe, expect, it } from 'vitest';
import { sanitizeRichTextHtml } from '@/lib/cms/actions/sanitize';
import { validateBlocks } from '@/lib/cms/blocks';
import { AANBOD_PAGES, FOOTER_MENU, MAIN_MENU } from './aanbod';
import { AFSPRAAK_PAGE, OTHER_QUESTION_HTML } from './appointment';
import { CADEAUBON_AANBOD_SPEC, cadeaubonAanbodBlocks } from './cadeaubon';
import before from './page-cleanup.fixture.json';
import {
  cleanupBlocks,
  contactEmailAction,
  PAGE_CLEANUP_SPECS,
  pageCleanupProblems,
  retargetContactLinks,
  type CleanupBlock,
} from './page-cleanup';
import { CONTACT_EMAIL } from './shared';

/**
 * `page-cleanup.fixture.json` is the seed definition of the touched pages and
 * menus at staging@9c655fe — what `cms:rollout-aanbod` and
 * `cms:patch-booking-cta` published on staging. These tests prove that the
 * patch turns exactly that into today's seed, and that it refuses or skips
 * everything else.
 */

const TARGETS = [...AANBOD_PAGES, AFSPRAAK_PAGE];

function oldPage(slug: string) {
  const page = before.pages.find((entry) => entry.slug === slug);
  if (!page) throw new Error(`fixture has no page ${slug}`);
  return { ...page, blocks: page.blocks as CleanupBlock[] };
}

function targetPage(slug: string) {
  const page = TARGETS.find((entry) => entry.slug === slug);
  if (!page) throw new Error(`seed has no page ${slug}`);
  return page;
}

/** As stored: validated (defaults filled in) and rich text sanitised. */
function stored(blocks: readonly CleanupBlock[]) {
  const result = validateBlocks(blocks);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.blocks.map((block) => {
    const data = block.data as Record<string, unknown>;
    return block.type === 'richText' && typeof data.html === 'string'
      ? { type: block.type, data: { ...data, html: sanitizeRichTextHtml(data.html) } }
      : { type: block.type, data };
  });
}

describe('page cleanup patch (review 13 Oct 2026)', () => {
  it('covers exactly /aanbod, /voor-wie, /ons-team and /afspraak', () => {
    expect(PAGE_CLEANUP_SPECS.map((spec) => spec.slug)).toEqual([
      'aanbod',
      'voor-wie',
      'ons-team',
      'afspraak',
    ]);
  });

  for (const spec of PAGE_CLEANUP_SPECS) {
    it(`/${spec.slug}: turns the staging content into today's seed, without conflicts`, () => {
      const old = oldPage(spec.slug);
      const result = cleanupBlocks(spec, stored(old.blocks));
      expect(result.conflicts).toEqual([]);
      expect(result.changes.length).toBeGreaterThan(0);
      // The gift voucher patch (same day, `cadeaubon.ts`) runs after this one on /aanbod.
      const next =
        spec.slug === CADEAUBON_AANBOD_SPEC.slug
          ? cadeaubonAanbodBlocks(result.next).next
          : result.next;
      expect(next).toEqual(stored(targetPage(spec.slug).blocks));
      expect(pageCleanupProblems(spec.slug, stored(old.blocks)).length).toBeGreaterThan(0);
      expect(pageCleanupProblems(spec.slug, result.next)).toEqual([]);

      const meta = spec.metaDescription;
      expect(meta?.from ?? old.metaDescription).toBe(old.metaDescription);
      expect(meta?.to ?? old.metaDescription).toBe(targetPage(spec.slug).metaDescription);

      const again = cleanupBlocks(spec, result.next);
      expect(again.changes).toEqual([]);
      expect(again.updated).toEqual([]);
      expect(again.conflicts).toEqual([]);
    });
  }

  it('/afspraak opens on "Kies je moment" and keeps the widget settings and phone link', () => {
    const spec = PAGE_CLEANUP_SPECS.find((entry) => entry.slug === 'afspraak')!;
    const result = cleanupBlocks(spec, stored(oldPage('afspraak').blocks));
    expect(result.removed.map((block) => block.type)).toEqual([
      'hero',
      'services',
      'contact',
      'cta',
    ]);
    expect(result.next.map((block) => block.type)).toEqual(['booking', 'richText']);
    const booking = result.next[0].data;
    expect(booking).toMatchObject({ title: 'Kies je moment', eyebrow: '', serviceIds: [] });
    expect(booking.showProviderChoice).toBe(true);
    const html = String(result.next[1].data.html);
    expect(html).toContain('<h3>Andere vraag?</h3>');
    expect(html).toContain(`<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>`);
    expect(html.match(/href="tel:\+32473952633"/g)).toHaveLength(2);
  });

  it('refuses a field an editor changed since the rollout, and leaves it alone', () => {
    const spec = PAGE_CLEANUP_SPECS.find((entry) => entry.slug === 'voor-wie')!;
    const blocks = stored(oldPage('voor-wie').blocks);
    const audience = blocks.find((block) => block.type === 'audience')!;
    audience.data = { ...audience.data, title: 'Een titel van de redactie' };
    const result = cleanupBlocks(spec, blocks);
    expect(result.conflicts).toEqual([
      expect.stringContaining('audience.title: expected "Waar je ook staat"'),
    ]);
    expect(result.next.find((block) => block.type === 'audience')?.data.title).toBe(
      'Een titel van de redactie',
    );
  });

  it('reports a missing or doubled target block instead of guessing', () => {
    const spec = PAGE_CLEANUP_SPECS.find((entry) => entry.slug === 'ons-team')!;
    const blocks = stored(oldPage('ons-team').blocks);
    expect(
      cleanupBlocks(
        spec,
        blocks.filter((block) => block.type !== 'team'),
      ).conflicts,
    ).toEqual(['team: expected one such block, found 0', 'team: expected one such block, found 0']);
    const team = blocks.find((block) => block.type === 'team')!;
    expect(cleanupBlocks(spec, [...blocks, team]).conflicts).toHaveLength(2);
  });

  it('never touches the caller’s block objects', () => {
    const spec = PAGE_CLEANUP_SPECS.find((entry) => entry.slug === 'aanbod')!;
    const blocks = stored(oldPage('aanbod').blocks);
    const snapshot = JSON.stringify(blocks);
    cleanupBlocks(spec, blocks);
    expect(JSON.stringify(blocks)).toBe(snapshot);
  });

  it('"Andere vraag?" survives the rich-text sanitiser unchanged', () => {
    expect(sanitizeRichTextHtml(OTHER_QUESTION_HTML)).toBe(OTHER_QUESTION_HTML);
  });
});

describe('menus: Contact → /afspraak', () => {
  it('turns the staging menus into today’s seed menus, once', () => {
    const main = retargetContactLinks(before.menus.main);
    const footer = retargetContactLinks(before.menus.footer);
    expect(main.items).toEqual(MAIN_MENU);
    expect(footer.items).toEqual(FOOTER_MENU);
    expect([...main.changed, ...footer.changed]).toEqual([
      '"Contact" /contact → /afspraak',
      '"Contact" /contact → /afspraak',
    ]);
    expect(retargetContactLinks(MAIN_MENU).changed).toEqual([]);
  });

  it('keeps query and hash, skips external links and look-alike paths, recurses into children', () => {
    const { items, changed } = retargetContactLinks([
      { label: 'Vraag', href: '/contact?dienst=coaching#boeken', external: false },
      { label: 'Extern', href: '/contact', external: true },
      { label: 'Contacten', href: '/contacten', external: false },
      {
        label: 'Meer',
        href: '/voor-wie',
        external: false,
        children: [{ label: 'Contact', href: '/contact/', external: false }],
      },
    ]);
    expect(items.map((item) => item.href)).toEqual([
      '/afspraak?dienst=coaching#boeken',
      '/contact',
      '/contacten',
      '/voor-wie',
    ]);
    expect(items[3].children?.[0].href).toBe('/afspraak');
    expect(changed).toHaveLength(2);
  });
});

describe('settings: public e-mail address', () => {
  it('fills an empty address, keeps the confirmed one, refuses another one', () => {
    expect(contactEmailAction('')).toBe('set');
    expect(contactEmailAction('  ')).toBe('set');
    expect(contactEmailAction(CONTACT_EMAIL)).toBe('');
    expect(contactEmailAction('iemand@example.be')).toContain('not empty');
  });
});
