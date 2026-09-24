import type { JsonLdNode } from '@/lib/studio/jsonld';

/**
 * Renders a JSON-LD document inside `<script type="application/ld+json">`.
 *
 * Server-rendered, so crawlers and answer engines that do not execute
 * JavaScript still see it.
 *
 * `</script>` inside a JSON string would close the element early, so `<`, `>`
 * and `&` are escaped to their `\u00xx` forms. That is still valid JSON (and
 * still the same string once parsed), it just cannot terminate the element.
 */
export function JsonLd({ data }: { data: JsonLdNode }) {
  const json = JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');

  return (
    <script
      type="application/ld+json"
      // The payload is JSON we just serialised ourselves and escaped above.
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
