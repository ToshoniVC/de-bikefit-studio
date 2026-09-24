/**
 * Content sanitising shared by the block editor (client) and the block write
 * action (server).
 *
 * Deliberately no WYSIWYG and no HTML sanitiser dependency. The `richText`
 * block is edited as plain paragraphs separated by blank lines; the stored
 * `html` is rebuilt from that text with everything escaped, so the only markup
 * that can ever reach `cms_blocks.data.html` is `<p>` and `<br />` that this
 * module wrote itself. The rebuild runs again **server-side** in the action, so
 * a hand-crafted request cannot smuggle markup past the browser form.
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

function unescapeHtml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Blank-line separated plain text → escaped `<p>` paragraphs. */
export function plainTextToHtml(text: string): string {
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br />')}</p>`);
  return paragraphs.join('');
}

/** `<p>` paragraphs → the plain text the editor shows in its textarea. */
export function htmlToPlainText(html: string): string {
  return unescapeHtml(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Re-derives `html` from its own text content, dropping any other markup. */
export function normalizeRichTextHtml(html: string): string {
  return plainTextToHtml(htmlToPlainText(html));
}

const UNSAFE_URL = /^\s*(javascript|data|vbscript|file)\s*:/i;
const URL_KEYS = new Set(['href', 'url', 'mapEmbedUrl', 'phoneHref', 'website', 'canonicalOverride']);

/** `true` when a link value uses a scheme that must never be rendered. */
export function isUnsafeUrl(value: string): boolean {
  // `data:image/...` is still refused here: media belongs in the media library.
  return UNSAFE_URL.test(value);
}

export type SanitizeResult =
  | { ok: true; data: unknown }
  | { ok: false; message: string };

/**
 * Walks arbitrary block data:
 *  - rejects link-ish fields using `javascript:` / `data:` / `vbscript:`,
 *  - re-derives any `html` field from its own text content.
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
      if (key === 'html') return normalizeRichTextHtml(value);
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
