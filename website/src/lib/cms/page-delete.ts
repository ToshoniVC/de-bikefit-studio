import 'server-only';
import { and, eq } from 'drizzle-orm';
import type { CmsDatabase } from '@/db/cms';
import { cmsPages, type CmsRole } from '@/db/cms-schema';
import { mayDeleteOnlyDrafts, PUBLISHED_PAGE_DELETE_DENIED } from './page-policy';

/**
 * The delete statement of `repo.deletePage()`, which has already refused what
 * `pageDeleteDenial()` refuses for the row it loaded. That check and this
 * delete are two statements (neon-http holds no transaction), so for a role
 * that may not delete a live page (`mayDeleteOnlyDrafts()`) the statement
 * repeats the rule: `WHERE id = $id AND status = 'draft'`, and a page published
 * in between is left alone. Other roles delete by id, as before.
 *
 * Returns `null` when the row was deleted (its draft blocks go by cascade),
 * otherwise the Dutch reason: the refusal while the page still exists, "Pagina
 * niet gevonden." once it is gone. Writes no audit entry and busts no cache;
 * the caller does both, and only after a delete.
 */
export async function deletePageRow(
  db: CmsDatabase,
  pageId: string,
  role: CmsRole,
): Promise<string | null> {
  const deleted = await db
    .delete(cmsPages)
    .where(
      mayDeleteOnlyDrafts(role)
        ? and(eq(cmsPages.id, pageId), eq(cmsPages.status, 'draft'))
        : eq(cmsPages.id, pageId),
    )
    .returning({ id: cmsPages.id });
  if (deleted.length > 0) return null;

  const [still] = await db
    .select({ id: cmsPages.id })
    .from(cmsPages)
    .where(eq(cmsPages.id, pageId))
    .limit(1);
  return still ? PUBLISHED_PAGE_DELETE_DENIED : 'Pagina niet gevonden.';
}
