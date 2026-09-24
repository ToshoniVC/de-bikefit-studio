import { describe, expect, it } from 'vitest';

import { escapeHtml } from './html';

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>Tom & Jerry</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;Tom &amp; Jerry&lt;/a&gt;',
    );
  });

  it('escapes an ampersand that already starts an entity (no double-decoding tricks)', () => {
    expect(escapeHtml('&lt;script&gt;')).toBe('&amp;lt;script&amp;gt;');
  });

  it('leaves ordinary text, accents and typographic quotes alone', () => {
    const text = 'Één fiets, “Cookies” – pagina’s';
    expect(escapeHtml(text)).toBe(text);
  });

  it('returns an empty string unchanged', () => {
    expect(escapeHtml('')).toBe('');
  });
});
