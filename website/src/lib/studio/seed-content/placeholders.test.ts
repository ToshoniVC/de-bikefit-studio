import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { offerPagePath, offerPriceLabel } from '@/lib/offers/catalogue';
import { DEFAULT_OFFERS, offerBlockData } from '@/lib/offers/defaults';
import { EDITORIAL_SLOTS, editorialImage } from '@/lib/studio/editorial-images';
import { AANBOD_PAGES, TEAM_MEMBERS } from './aanbod';
import { TEAM_PROFILE_PENDING } from './copy';

/**
 * Keeps `docs/content-placeholders.md` (the canonical register of temporary
 * content) in step with the seed: every offer, team member and editorial
 * image that ships as a placeholder must have its rows, with the text the
 * site actually shows.
 */

const REGISTER = readFileSync(
  fileURLToPath(new URL('../../../../docs/content-placeholders.md', import.meta.url)),
  'utf8',
);

type Row = { id: string; cells: string[]; status: string };

function cellsOf(line: string): string[] {
  return line
    .slice(1, -1)
    .split(' | ')
    .map((cell) => cell.trim());
}

const ROWS: Row[] = REGISTER.split('\n')
  .filter((line) => /^\| [A-Z]-\d{2} \|/.test(line))
  .map((line) => {
    const cells = cellsOf(line);
    return { id: cells[0], cells, status: cells[cells.length - 1] };
  });

function row(id: string): Row {
  const found = ROWS.find((entry) => entry.id === id);
  if (!found) throw new Error(`register has no row ${id}`);
  return found;
}

function rowsOf(series: string): Row[] {
  return ROWS.filter((entry) => entry.id.startsWith(`${series}-`));
}

function rowMentioning(series: string, text: string): Row {
  const found = rowsOf(series).filter((entry) => entry.cells.join(' | ').includes(text));
  expect(found, `${series}-row mentioning ${text}`).toHaveLength(1);
  return found[0];
}

const STATUSES = ['open', 'te bevestigen', 'bevestigd'];

describe('content placeholder register', () => {
  it('has unique IDs and a known status on every row', () => {
    expect(ROWS.length).toBeGreaterThan(0);
    expect(new Set(ROWS.map((entry) => entry.id)).size).toBe(ROWS.length);
    for (const entry of ROWS) {
      expect(
        STATUSES.includes(entry.status) || /^afgerond \d{4}-\d{2}-\d{2}$/.test(entry.status),
        `${entry.id}: "${entry.status}"`,
      ).toBe(true);
    }
  });

  it('overview counts match the rows', () => {
    const overview = REGISTER.split('\n')
      .filter((line) => /^\| [A-Z] \|/.test(line))
      .map(cellsOf);
    expect(overview.length).toBeGreaterThan(0);
    for (const [series, , total, open, toConfirm, confirmed, done] of overview) {
      const rows = rowsOf(series);
      const count = (match: (status: string) => boolean) =>
        String(rows.filter((entry) => match(entry.status)).length);
      expect([total, open, toConfirm, confirmed, done], `overview ${series}`).toEqual([
        String(rows.length),
        count((status) => status === 'open'),
        count((status) => status === 'te bevestigen'),
        count((status) => status === 'bevestigd'),
        count((status) => status.startsWith('afgerond')),
      ]);
    }
    const totals = REGISTER.split('\n').find((line) => line.includes('**Totaal**'));
    expect(totals).toContain(`**${ROWS.length}**`);
  });

  it('lists the price, duration and extras of every offer with the text the site shows', () => {
    for (const offer of DEFAULT_OFFERS) {
      const path = `\`${offerPagePath(offer.slug)}\``;
      const data = offerBlockData(offer) as { priceCents: number | null; priceLabel: string };
      const price = rowMentioning('P', path);
      expect(price.cells[2]).toBe(offerPriceLabel(data));
      const duration = rowMentioning('D', path);
      expect(duration.cells[2]).toBe(offer.duration);
      rowMentioning('E', path);
    }
  });

  it('lists every editorial image on every page that uses it', () => {
    for (const slot of EDITORIAL_SLOTS) {
      const ref = editorialImage(slot);
      if (!ref.url) continue;
      const entry = rowMentioning('B', `\`${slot}\``);
      expect(entry.cells[1]).toContain(`public${ref.url}`);
      for (const page of AANBOD_PAGES) {
        if (!JSON.stringify(page.blocks).includes(ref.url)) continue;
        const where = page.slug === '' ? 'home' : `\`/${page.slug}\``;
        expect(entry.cells[2], `${entry.id} on ${where}`).toContain(where);
      }
    }
  });

  it('lists every image slot the rollout leaves empty', () => {
    for (const page of AANBOD_PAGES) {
      const where = page.slug === '' ? 'home' : `\`/${page.slug}\``;
      for (const block of page.blocks) {
        const data = block.data as {
          title?: string;
          variant?: string;
          image?: { mediaId?: string | null; url?: string | null };
        };
        if (!('image' in data) && !['hero', 'imageText', 'offer'].includes(block.type)) continue;
        // The compact subpage header never shows an image.
        if (block.type === 'hero' && data.variant === 'pageHead') continue;
        if (data.image?.mediaId || data.image?.url) continue;
        const entry = rowMentioning('B', `"${data.title}"`);
        expect(entry.cells[2], `${entry.id} on ${where}`).toContain(where);
        expect(entry.cells[1]).toContain('leeg');
      }
    }
  });

  it('lists bio, role, qualifications and portrait for every team member', () => {
    for (const member of TEAM_MEMBERS) {
      for (const field of ['Bio', 'Rol', 'Kwalificaties', 'Afbeelding']) {
        rowMentioning('T', `${member.name} — ${field}`);
      }
      if (member.bio.includes(TEAM_PROFILE_PENDING)) {
        const bio = rowMentioning('T', `${member.name} — Bio`);
        for (const line of member.bio) expect(bio.cells[2]).toContain(line);
      }
      for (const id of member.internalNote.match(/T-\d{2}/g) ?? []) row(id);
      expect(member.internalNote).toMatch(/T-\d{2}/);
    }
  });
});
