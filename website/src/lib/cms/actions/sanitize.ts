import sanitizeHtml from 'sanitize-html';

// Re-exported for existing callers and tests; the implementation lives in a
// client-safe module so the admin editor never imports `sanitize-html`.
export { htmlToPlainText, plainTextToHtml } from '@/lib/cms/rich-text-plain';

/**
 * Content sanitising for CMS blocks — the ONE place that decides which markup
 * may reach `dangerouslySetInnerHTML` on the public site (CLAUDE.md §4).
 *
 * Write path: `repo.updateBlock()` runs {@link sanitizeBlockData} on every block
 * write before validating it, so the admin action (`actions/blocks.ts`) and the
 * seed (`scripts/cms-seed.mts`, which writes through the repo) store exactly
 * the same thing. `rich-text.tsx` then renders the stored HTML as-is.
 *
 * Rich text is an **allowlist** built on `sanitize-html`
 * ({@link sanitizeRichTextHtml}): the tags in {@link RICH_TEXT_ALLOWED_TAGS},
 * links with `href`/`title`/`rel`/`target` only, `http`/`https`/`mailto`/`tel`
 * or relative/anchor hrefs, `rel="noopener noreferrer"` on every
 * `target="_blank"`, no attributes anywhere else, no styles, no scripts, and
 * empty paragraphs/headings dropped. Change the list only together with a test
 * in `sanitize.test.ts`.
 *
 * The admin's rich-text field (`src/components/admin/blocks/field-inputs.tsx`)
 * has two modes: "Tekst" (plain paragraphs via `plainTextToHtml`, in
 * `src/lib/cms/rich-text-plain.ts`) and "HTML" (the source, for pages such as
 * the legal texts that need headings, lists and links). Both land here.
 */

/** Every element a `richText` block may contain. Anything else is unwrapped (its text kept). */
export const RICH_TEXT_ALLOWED_TAGS = [
  'p',
  'br',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'a',
  'strong',
  'b',
  'em',
  'i',
  'blockquote',
] as const;

/** Link schemes a rich-text `href` may use; relative (`/pad`) and anchor (`#id`) hrefs are always fine. */
export const RICH_TEXT_ALLOWED_SCHEMES = ['http', 'https', 'mailto', 'tel'] as const;

/** Elements removed when they contain no text at all (`<p></p>`, `<p><br /></p>`, `<h2> </h2>`). */
const DROP_WHEN_EMPTY = new Set(['p', 'h2', 'h3', 'h4']);

/** Disallowed elements whose CONTENT is dropped too, not just the tag. */
const DROP_WITH_CONTENT = [
  'script',
  'style',
  'textarea',
  'option',
  'xmp',
  'noscript',
  'noembed',
  'noframes',
  'iframe',
  'object',
  'embed',
  'template',
  'title',
  'head',
  'svg',
  'math',
];

/**
 * `target="_blank"` → `rel` gains `noopener noreferrer` (existing tokens kept);
 * any other `target` value is dropped (same-tab is the default anyway).
 */
function normaliseLink(tagName: string, attribs: sanitizeHtml.Attributes): sanitizeHtml.Tag {
  const next: sanitizeHtml.Attributes = { ...attribs };
  if (next.target?.trim().toLowerCase() === '_blank') {
    const rel = new Set((next.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean));
    rel.add('noopener');
    rel.add('noreferrer');
    next.target = '_blank';
    next.rel = [...rel].join(' ');
  } else {
    delete next.target;
  }
  return { tagName, attribs: next };
}

const RICH_TEXT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...RICH_TEXT_ALLOWED_TAGS],
  allowedAttributes: { a: ['href', 'title', 'rel', 'target'] },
  allowedClasses: {},
  allowedSchemes: [...RICH_TEXT_ALLOWED_SCHEMES],
  allowedSchemesByTag: {},
  allowedSchemesAppliedToAttributes: ['href'],
  // `//evil.example` is an absolute link in disguise; write `https://` instead.
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  nonTextTags: DROP_WITH_CONTENT,
  // No `style` attribute is allowed, so there is nothing for postcss to parse.
  parseStyleAttributes: false,
  enforceHtmlBoundary: false,
  transformTags: { a: normaliseLink },
  exclusiveFilter: (frame) => DROP_WHEN_EMPTY.has(frame.tag) && frame.text.trim() === '',
};

/**
 * Pure allowlist sanitiser for `richText` HTML. Idempotent: running it on its
 * own output changes nothing.
 */
export function sanitizeRichTextHtml(html: string): string {
  return sanitizeHtml(html, RICH_TEXT_OPTIONS).trim();
}

const UNSAFE_URL = /^\s*(javascript|data|vbscript|file)\s*:/i;
const URL_KEYS = new Set([
  'href',
  'url',
  'mapEmbedUrl',
  'phoneHref',
  'website',
  'canonicalOverride',
]);

/** `true` when a link value uses a scheme that must never be rendered. */
export function isUnsafeUrl(value: string): boolean {
  // `data:image/...` is still refused here: media belongs in the media library.
  return UNSAFE_URL.test(value);
}

export type SanitizeResult = { ok: true; data: unknown } | { ok: false; message: string };

/**
 * Walks arbitrary block data:
 *  - rejects link-ish fields using `javascript:` / `data:` / `vbscript:` / `file:`,
 *  - passes any `html` field through {@link sanitizeRichTextHtml}.
 */
export function sanitizeBlockData(data: unknown): SanitizeResult {
  const rejected: string[] = [];

  const walk = (value: unknown, key: string | null): unknown => {
    if (Array.isArray(value)) return value.map((item) => walk(item, key));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
        out[childKey] = walk(childValue, childKey);
      }
      return out;
    }
    if (typeof value === 'string' && key) {
      if (URL_KEYS.has(key) && value !== '' && isUnsafeUrl(value)) {
        rejected.push(key);
        return value;
      }
      if (key === 'html') return sanitizeRichTextHtml(value);
    }
    return value;
  };

  const sanitized = walk(data, null);
  if (rejected.length > 0) {
    return {
      ok: false,
      message: `Onveilige link in veld “${rejected[0]}”. Gebruik een pad (/pagina), https:// of tel:.`,
    };
  }
  return { ok: true, data: sanitized };
}
