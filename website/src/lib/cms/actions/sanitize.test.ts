import { describe, expect, it } from 'vitest';

import {
  htmlToPlainText,
  isUnsafeUrl,
  plainTextToHtml,
  RICH_TEXT_ALLOWED_TAGS,
  sanitizeBlockData,
  sanitizeRichTextHtml,
} from './sanitize';

/**
 * Representative excerpt of `PRIVACY_HTML` in `scripts/cms-seed.mts` (the seed
 * does not export it: importing the script would run it). Every construct the
 * seeded legal pages use is here: em, h2, h3, strong, ul/li, mailto/tel/https
 * links, an existing `rel`, curly quotes and an en dash.
 */
const PRIVACY_EXCERPT = `<p><em>Laatst bijgewerkt: 24 september 2026</em></p>

<h2>1. Wie zijn wij?</h2>
<p>De Bikefit Studio is een handelsnaam van <strong>Qarakter BV</strong>, ingeschreven onder het nummer <strong>BE 1036.912.281</strong> (RPR Brussel, Nederlandstalige afdeling).</p>
<p>Vragen over deze verklaring of over je gegevens? Mail naar <a href="mailto:info@debikefitstudio.be">info@debikefitstudio.be</a> of bel <a href="tel:+32473952633">0473 95 26 33</a>.</p>

<h2>2. Welke gegevens verwerken wij, en waarom?</h2>
<h3>Als je een afspraak maakt</h3>
<p>Rechtsgrond: de uitvoering van de overeenkomst (art. 6.1.b AVG) en je uitdrukkelijke toestemming (art. 9.2.a AVG).</p>

<h2>3. Hoe lang bewaren wij je gegevens?</h2>
<ul>
<li>Afspraak- en contactgegevens: tot drie jaar na je laatste afspraak.</li>
<li><strong>Vercel Inc.</strong> – hosting van de website.</li>
</ul>

<h2>5. Cookies</h2>
<p>Je keuze kun je altijd aanpassen via de link “Cookies” onderaan elke pagina.</p>
<p>Klacht? <a href="https://www.gegevensbeschermingsautoriteit.be" rel="noopener">www.gegevensbeschermingsautoriteit.be</a>, <a href="mailto:contact@apd-gba.be">contact@apd-gba.be</a>.</p>
<p>Lees ook de <a href="/algemene-voorwaarden">algemene voorwaarden</a> en <a href="#rechten">je rechten</a>.</p>`;

function count(html: string, tag: string): number {
  return (html.match(new RegExp(`<${tag}[\\s>/]`, 'g')) ?? []).length;
}

describe('sanitizeRichTextHtml — allowed structure', () => {
  it('keeps every allowlisted element', () => {
    const html =
      '<h2>Kop</h2><h3>Sub</h3><h4>Klein</h4>' +
      '<p>Een <strong>vet</strong>, <b>b</b>, <em>schuin</em>, <i>i</i><br />regel</p>' +
      '<ul><li>een</li></ul><ol><li>twee</li></ol>' +
      '<blockquote><p>Citaat</p></blockquote>' +
      '<p><a href="https://example.be/pad" title="Uitleg">link</a></p>';
    expect(sanitizeRichTextHtml(html)).toBe(html);
  });

  it('exposes exactly the agreed allowlist', () => {
    expect([...RICH_TEXT_ALLOWED_TAGS].sort()).toEqual(
      [
        'a',
        'b',
        'blockquote',
        'br',
        'em',
        'h2',
        'h3',
        'h4',
        'i',
        'li',
        'ol',
        'p',
        'strong',
        'ul',
      ].sort(),
    );
  });

  it('keeps relative, anchor, mailto, tel, http and https hrefs', () => {
    for (const href of [
      '/privacy',
      '#rechten',
      'mailto:a@b.be',
      'tel:+32473952633',
      'http://a.be',
      'https://a.be',
    ]) {
      expect(sanitizeRichTextHtml(`<p><a href="${href}">x</a></p>`)).toBe(
        `<p><a href="${href}">x</a></p>`,
      );
    }
  });

  it('unwraps elements outside the allowlist but keeps their text', () => {
    expect(sanitizeRichTextHtml('<div><span>tekst</span></div>')).toBe('tekst');
    expect(sanitizeRichTextHtml('<h1>Titel</h1><p>x</p>')).toBe('Titel<p>x</p>');
    expect(sanitizeRichTextHtml('<p>a<img src="x.png" alt="beeld" />b</p>')).toBe('<p>ab</p>');
  });

  it('keeps text escaped', () => {
    expect(sanitizeRichTextHtml('<p>1 &lt; 2 &amp; 3 &gt; 2</p>')).toBe(
      '<p>1 &lt; 2 &amp; 3 &gt; 2</p>',
    );
    expect(sanitizeRichTextHtml('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
  });

  it('collapses empty paragraphs and headings', () => {
    expect(
      sanitizeRichTextHtml('<p></p><p> </p><p><br></p><p>&nbsp;</p><h2> </h2><p>tekst</p>'),
    ).toBe('<p>tekst</p>');
    expect(sanitizeRichTextHtml('<p></p>')).toBe('');
  });

  it('is idempotent', () => {
    const once = sanitizeRichTextHtml(
      PRIVACY_EXCERPT + '<p onclick="x()"><a href="/a" target="_blank">x</a></p>',
    );
    expect(sanitizeRichTextHtml(once)).toBe(once);
  });
});

describe('sanitizeRichTextHtml — dangerous input', () => {
  it('removes script and style elements with their content', () => {
    expect(sanitizeRichTextHtml('<p>a</p><script>alert(1)</script><p>b</p>')).toBe(
      '<p>a</p><p>b</p>',
    );
    expect(sanitizeRichTextHtml('<style>p{color:red}</style><p>b</p>')).toBe('<p>b</p>');
    expect(sanitizeRichTextHtml('<p>a<script src="https://evil.example/x.js"></script></p>')).toBe(
      '<p>a</p>',
    );
  });

  it('removes iframes, objects and embeds with their content', () => {
    expect(
      sanitizeRichTextHtml('<iframe src="https://evil.example">fallback</iframe><p>b</p>'),
    ).toBe('<p>b</p>');
    expect(
      sanitizeRichTextHtml('<object data="x.swf">alt</object><embed src="x.swf" /><p>b</p>'),
    ).toBe('<p>b</p>');
    expect(sanitizeRichTextHtml('<svg><script>alert(1)</script></svg><p>b</p>')).toBe('<p>b</p>');
  });

  it('removes event handlers, style, class and id attributes', () => {
    expect(
      sanitizeRichTextHtml(
        '<p onclick="alert(1)" style="color:red" class="x" id="y">a</p><a href="/x" onmouseover="alert(1)">b</a>',
      ),
    ).toBe('<p>a</p><a href="/x">b</a>');
    expect(sanitizeRichTextHtml('<h2 onload="x()">Kop</h2>')).toBe('<h2>Kop</h2>');
  });

  it('removes javascript:, data: and vbscript: hrefs, however they are disguised', () => {
    const hrefs = [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'jav&#x61;script:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ];
    for (const href of hrefs) {
      expect(sanitizeRichTextHtml(`<p><a href="${href}">x</a></p>`)).toBe('<p><a>x</a></p>');
    }
  });

  it('removes protocol-relative hrefs', () => {
    expect(sanitizeRichTextHtml('<a href="//evil.example/x">x</a>')).toBe('<a>x</a>');
  });

  it('drops comments', () => {
    expect(sanitizeRichTextHtml('<p>a<!-- <script>x</script> -->b</p>')).toBe('<p>ab</p>');
  });
});

describe('sanitizeRichTextHtml — links opening a new tab', () => {
  it('adds rel="noopener noreferrer" to target="_blank"', () => {
    expect(sanitizeRichTextHtml('<a href="https://a.be" target="_blank">x</a>')).toBe(
      '<a href="https://a.be" target="_blank" rel="noopener noreferrer">x</a>',
    );
  });

  it('keeps existing rel tokens and does not duplicate', () => {
    expect(
      sanitizeRichTextHtml('<a href="https://a.be" rel="nofollow noopener" target="_BLANK">x</a>'),
    ).toBe('<a href="https://a.be" rel="nofollow noopener noreferrer" target="_blank">x</a>');
  });

  it('drops any other target and leaves rel alone without one', () => {
    expect(sanitizeRichTextHtml('<a href="/x" target="_top">x</a>')).toBe('<a href="/x">x</a>');
    expect(sanitizeRichTextHtml('<a href="https://a.be" rel="noopener">x</a>')).toBe(
      '<a href="https://a.be" rel="noopener">x</a>',
    );
  });
});

describe('sanitizeRichTextHtml — seeded legal pages', () => {
  it('keeps the privacy statement structure intact', () => {
    const out = sanitizeRichTextHtml(PRIVACY_EXCERPT);
    for (const tag of ['h2', 'h3', 'ul', 'li', 'a', 'strong', 'em', 'p']) {
      expect(count(out, tag), tag).toBe(count(PRIVACY_EXCERPT, tag));
    }
    expect(out).toContain('<a href="mailto:info@debikefitstudio.be">info@debikefitstudio.be</a>');
    expect(out).toContain('<a href="tel:+32473952633">0473 95 26 33</a>');
    expect(out).toContain(
      '<a href="https://www.gegevensbeschermingsautoriteit.be" rel="noopener">',
    );
    expect(out).toContain('<a href="/algemene-voorwaarden">');
    expect(out).toContain('<a href="#rechten">');
    expect(out).toContain('“Cookies”');
    expect(out).toContain('<strong>Vercel Inc.</strong> – hosting');
  });

  it('changes nothing but surrounding whitespace in the seeded markup', () => {
    expect(sanitizeRichTextHtml(PRIVACY_EXCERPT)).toBe(PRIVACY_EXCERPT.trim());
  });
});

describe('sanitizeBlockData', () => {
  it('sanitises every html field, however deep', () => {
    const result = sanitizeBlockData({
      title: '<b>kept as plain text field</b>',
      html: '<p onclick="x()">a</p><script>x</script>',
      items: [{ html: '<h2>Kop</h2><iframe src="x"></iframe>' }],
    });
    expect(result).toEqual({
      ok: true,
      data: {
        title: '<b>kept as plain text field</b>',
        html: '<p>a</p>',
        items: [{ html: '<h2>Kop</h2>' }],
      },
    });
  });

  it('refuses unsafe link fields with a Dutch message', () => {
    const result = sanitizeBlockData({ cta: { href: 'javascript:alert(1)', label: 'x' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('href');
  });

  it('accepts safe link fields and leaves them untouched', () => {
    const data = {
      href: '/afspraak',
      phoneHref: 'tel:+32473952633',
      website: 'https://a.be',
      url: '',
    };
    expect(sanitizeBlockData(data)).toEqual({ ok: true, data });
  });
});

describe('isUnsafeUrl', () => {
  it('flags script-capable and data schemes only', () => {
    expect(isUnsafeUrl('javascript:alert(1)')).toBe(true);
    expect(isUnsafeUrl('  DATA:image/png;base64,xx')).toBe(true);
    expect(isUnsafeUrl('vbscript:x')).toBe(true);
    expect(isUnsafeUrl('file:///x')).toBe(true);
    expect(isUnsafeUrl('https://a.be')).toBe(false);
    expect(isUnsafeUrl('/pad')).toBe(false);
    expect(isUnsafeUrl('tel:+32')).toBe(false);
  });
});

describe('plain-text editor helpers', () => {
  it('builds escaped paragraphs from blank-line separated text', () => {
    expect(plainTextToHtml('Een <b>\nregel\n\nTwee & drie')).toBe(
      '<p>Een &lt;b&gt;<br />regel</p><p>Twee &amp; drie</p>',
    );
  });

  it('round-trips plain paragraphs through the sanitiser', () => {
    const html = plainTextToHtml('Een "quote" & \'apostrof\'\n\nTwee');
    expect(htmlToPlainText(sanitizeRichTextHtml(html))).toBe('Een "quote" & \'apostrof\'\n\nTwee');
  });
});
