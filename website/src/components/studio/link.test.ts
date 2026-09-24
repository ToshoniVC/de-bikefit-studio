import { describe, expect, it } from 'vitest';
import { isInternalPath, splitArrow } from './link';

describe('isInternalPath', () => {
  it('accepts site-relative paths, with or without query and hash', () => {
    for (const href of ['/', '/bikefit', '/afspraak?dienst=jeugdfit#kies', '/admin/pages']) {
      expect(isInternalPath(href), href).toBe(true);
    }
  });

  it('rejects protocol-relative URLs, which leave the site', () => {
    expect(isInternalPath('//evil.example/path')).toBe(false);
  });

  it('rejects backslash and whitespace disguises of a protocol-relative URL', () => {
    for (const href of [
      '/\\evil.example',
      '\\evil.example',
      '\\\\evil.example',
      '/\t/evil.example',
    ]) {
      expect(isInternalPath(href), JSON.stringify(href)).toBe(false);
    }
  });

  it('rejects absolute URLs, anchors, tel: and mailto: links and relative paths', () => {
    for (const href of [
      'https://debikefitstudio.be/',
      'http://x.test',
      '#vragen',
      'tel:+32473952633',
      'mailto:a@b.be',
      'bikefit',
      '',
    ]) {
      expect(isInternalPath(href), href).toBe(false);
    }
  });
});

describe('splitArrow', () => {
  it('strips a trailing arrow from a CTA label', () => {
    expect(splitArrow('Boek je bikefit →')).toBe('Boek je bikefit');
    expect(splitArrow('Lees meer ->')).toBe('Lees meer');
    expect(splitArrow('Verder &rarr;')).toBe('Verder');
  });

  it('keeps labels without a trailing arrow, and a label that is only an arrow', () => {
    expect(splitArrow('Bel ons')).toBe('Bel ons');
    expect(splitArrow('→ Start')).toBe('→ Start');
    expect(splitArrow('→')).toBe('→');
  });
});
