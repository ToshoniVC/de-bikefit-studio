import { escapeHtml } from '@/lib/html';

/**
 * The plain-text side of the admin's rich-text editor. Pure string helpers with
 * no dependencies, so the client component `field-inputs.tsx` can import them
 * without dragging `sanitize-html` (server-side) into the browser bundle.
 *
 * The sanitising itself happens on the server in
 * `src/lib/cms/actions/sanitize.ts`, on every block write.
 */

const RICH_MARKUP = /<(?!\/?(?:p|br)\b)[a-z][^>]*>/i;

/** `true` when the HTML uses anything beyond `<p>` / `<br>`: headings, lists, links, emphasis. */
export function hasRichMarkup(html: string): boolean {
  return RICH_MARKUP.test(html);
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

/** Blank-line separated plain text → escaped `<p>` paragraphs (the admin textarea's output). */
export function plainTextToHtml(text: string): string {
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br />')}</p>`);
  return paragraphs.join('');
}

/** Stored HTML → the plain text the admin textarea shows. Lossy: headings, lists and links become text. */
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
