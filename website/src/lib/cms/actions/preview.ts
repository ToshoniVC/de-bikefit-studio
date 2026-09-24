import 'server-only';
import { getCurrentCmsUser } from '@/lib/cms/auth';

/**
 * Draft-preview gate, exported for Worker C.
 *
 * The public page may only read draft content (`?preview=1`) when this returns
 * true — i.e. the request carries a valid, active CMS session cookie. It hits
 * the database through `getCurrentCmsUser()`, which is `React.cache`d per
 * request, so calling it in a layout and a page costs one lookup.
 *
 * ```ts
 * const draftPreview = searchParams.preview === '1' && (await canPreview());
 * ```
 *
 * Note: this is NOT a plain module — it is `server-only`; never import it from
 * a client component.
 */
export async function canPreview(): Promise<boolean> {
  const user = await getCurrentCmsUser();
  return Boolean(user?.isActive);
}
