/**
 * HTML escaping for strings the app assembles by hand (e-mail templates, the
 * plain-text side of the rich-text editor). Plain module: safe on the server,
 * in client components and in scripts.
 *
 * This is the only `escapeHtml` in the app (CLAUDE.md §3, "No duplicate
 * helpers"). It is NOT a sanitiser: markup that must survive goes through
 * `sanitizeRichTextHtml()` in `src/lib/cms/actions/sanitize.ts` instead.
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes `& < > " '`, so the value is safe as HTML text and inside a quoted attribute. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}
