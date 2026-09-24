import { describe, expect, it } from 'vitest';

import { hasRichMarkup, htmlToPlainText, plainTextToHtml } from './rich-text-plain';

describe('hasRichMarkup', () => {
  it('is false for plain paragraphs and line breaks', () => {
    expect(hasRichMarkup('')).toBe(false);
    expect(hasRichMarkup('<p>Een</p><p>Twee<br />drie</p>')).toBe(false);
    expect(hasRichMarkup('<P>Hoofdletters</P><BR>')).toBe(false);
  });

  it('is true for headings, lists, links and emphasis', () => {
    expect(hasRichMarkup('<h2>Titel</h2><p>tekst</p>')).toBe(true);
    expect(hasRichMarkup('<ul><li>een</li></ul>')).toBe(true);
    expect(hasRichMarkup('<p>Zie <a href="/privacy">privacy</a></p>')).toBe(true);
    expect(hasRichMarkup('<p><strong>vet</strong></p>')).toBe(true);
  });

  it('ignores escaped angle brackets in text', () => {
    expect(hasRichMarkup('<p>1 &lt; 2 &amp;&amp; &lt;h2&gt;</p>')).toBe(false);
  });
});

describe('plainTextToHtml / htmlToPlainText', () => {
  it('round-trips ordinary paragraphs', () => {
    const text = 'Eerste alinea\nmet een regelafbreking\n\nTweede alinea';
    const html = plainTextToHtml(text);
    expect(html).toBe('<p>Eerste alinea<br />met een regelafbreking</p><p>Tweede alinea</p>');
    expect(htmlToPlainText(html)).toBe(text);
  });

  it('escapes markup typed as text', () => {
    expect(plainTextToHtml('<script>x</script>')).toBe('<p>&lt;script&gt;x&lt;/script&gt;</p>');
  });

  it('flattens rich markup to readable text', () => {
    const rich = '<h2>Kop</h2><ul><li>een</li><li>twee</li></ul><p>Zie <a href="/p">hier</a>.</p>';
    expect(htmlToPlainText(rich)).toBe('Kop\n\n• een\n\n• twee\n\nZie hier.');
  });
});
