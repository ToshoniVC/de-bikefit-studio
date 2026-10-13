/**
 * Where a `cms_redirects` match sends the visitor, with the query string of
 * the request carried over: `/contact?dienst=coaching` → `/afspraak?dienst=coaching`.
 * Without this a retired page would drop the service context its links carry.
 *
 * Parameters already in the stored target win over the request's; the hash of
 * the stored target is kept at the end. With nothing to add, the stored
 * target is returned untouched. Only the query is appended, never a host, so
 * this cannot turn an internal redirect into an external one.
 *
 * Plain module (no I/O): unit-tested in `redirect-target.test.ts`.
 */

export type RequestSearchParams = Record<string, string | string[] | undefined>;

export function redirectTarget(toPath: string, search: RequestSearchParams): string {
  const hashIndex = toPath.indexOf('#');
  const hash = hashIndex >= 0 ? toPath.slice(hashIndex) : '';
  const beforeHash = hashIndex >= 0 ? toPath.slice(0, hashIndex) : toPath;
  const queryIndex = beforeHash.indexOf('?');
  const path = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  const params = new URLSearchParams(queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : '');

  const own = new Set(params.keys());
  let added = false;
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || own.has(key)) continue;
    for (const entry of Array.isArray(value) ? value : [value]) {
      params.append(key, entry);
      added = true;
    }
  }
  if (!added) return toPath;
  return `${path}?${params.toString()}${hash}`;
}
