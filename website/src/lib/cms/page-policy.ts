import type { CmsPageStatus, CmsRole } from '@/db/cms-schema';
import { CMS_AUTH_MESSAGES } from './guard';
import { can } from './permissions';

/**
 * Who may delete which page, kept pure (no database, cookies or Next runtime)
 * so the rule is unit-tested in `page-policy.test.ts` and one decision serves
 * both sides: `repo.deletePage()` enforces it (the real boundary) and the page
 * editor uses it to hide the delete form.
 *
 * Deleting is hard: the row, its draft blocks and the published snapshot are
 * gone, recoverable only from a database backup. For a published page that
 * also takes it off the public site at once (visitors get a 404, the home page
 * included), which is at least what `unpublishPage()` does. So a page that is
 * not a draft needs `page.unpublish` on top of `page.delete`; without that an
 * editor could pull a live page, contradicting "editors change nothing a
 * visitor sees" (`docs/cms-architecture.md` §3, §4). Deleting a draft stays an
 * ordinary `page.delete`, also when an admin took the page offline and its
 * snapshot is still kept. Any status other than `draft` counts as live, so a
 * future status fails closed.
 */

export const PUBLISHED_PAGE_DELETE_DENIED =
  'Een gepubliceerde pagina verwijderen mag alleen een beheerder. Vraag een beheerder om de pagina eerst offline te halen.';

/** `null` when `role` may delete a page in `status`, otherwise the Dutch reason. */
export function pageDeleteDenial(role: CmsRole, status: CmsPageStatus): string | null {
  if (!can(role, 'page.delete')) return CMS_AUTH_MESSAGES.forbidden;
  if (status !== 'draft' && !can(role, 'page.unpublish')) return PUBLISHED_PAGE_DELETE_DENIED;
  return null;
}

/**
 * Whether the delete statement itself must only match drafts for `role`
 * (`page-delete.ts`): the check and the delete are two statements, so a page
 * published in between must not be removed. True for every role refused on a
 * live page, roles without `page.delete` and unknown roles included.
 */
export function mayDeleteOnlyDrafts(role: CmsRole): boolean {
  return pageDeleteDenial(role, 'published') !== null;
}
