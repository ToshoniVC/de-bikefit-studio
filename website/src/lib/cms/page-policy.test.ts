import { describe, expect, it } from 'vitest';
import type { CmsPageStatus, CmsRole } from '@/db/cms-schema';
import { CMS_AUTH_MESSAGES } from './guard';
import { PUBLISHED_PAGE_DELETE_DENIED, mayDeleteOnlyDrafts, pageDeleteDenial } from './page-policy';
import { can } from './permissions';

/**
 * AZ-1 (authz review, 14 Oct 2026): an editor could hard-delete a published
 * page, the home page included, although taking a page offline is admin-only.
 * Deleting a live page is at least an unpublish, so it needs `page.unpublish`
 * on top of `page.delete`; drafts stay an ordinary `page.delete`.
 */
describe('pageDeleteDenial', () => {
  it('refuses an editor on a published page, in short Dutch', () => {
    expect(pageDeleteDenial('editor', 'published')).toBe(
      'Een gepubliceerde pagina verwijderen mag alleen een beheerder. Vraag een beheerder om de pagina eerst offline te halen.',
    );
    expect(PUBLISHED_PAGE_DELETE_DENIED).toBe(pageDeleteDenial('editor', 'published'));
  });

  it('lets an admin delete a published page', () => {
    expect(pageDeleteDenial('admin', 'published')).toBeNull();
  });

  it('lets an editor (and an admin) delete a draft', () => {
    expect(pageDeleteDenial('editor', 'draft')).toBeNull();
    expect(pageDeleteDenial('admin', 'draft')).toBeNull();
  });

  it('refuses a provider whatever the status: providers have no page.delete', () => {
    expect(pageDeleteDenial('provider', 'draft')).toBe(CMS_AUTH_MESSAGES.forbidden);
    expect(pageDeleteDenial('provider', 'published')).toBe(CMS_AUTH_MESSAGES.forbidden);
  });

  it('fails closed: an unknown role is refused, an unknown status counts as live', () => {
    expect(pageDeleteDenial('ghost' as CmsRole, 'draft')).toBe(CMS_AUTH_MESSAGES.forbidden);
    expect(pageDeleteDenial('editor', 'scheduled' as CmsPageStatus)).toBe(
      PUBLISHED_PAGE_DELETE_DENIED,
    );
    expect(pageDeleteDenial('admin', 'scheduled' as CmsPageStatus)).toBeNull();
  });

  it('follows the role matrix: page.delete for a draft, page.unpublish as well for a live page', () => {
    for (const role of ['provider', 'editor', 'admin'] as const) {
      expect(pageDeleteDenial(role, 'draft') === null, `${role} / draft`).toBe(
        can(role, 'page.delete'),
      );
      expect(pageDeleteDenial(role, 'published') === null, `${role} / published`).toBe(
        can(role, 'page.delete') && can(role, 'page.unpublish'),
      );
    }
  });
});

/**
 * The same rule once more inside the delete statement (`page-delete.ts`): for
 * these roles it only matches `status = 'draft'`, so a page published between
 * the check and the delete is not removed.
 */
describe('mayDeleteOnlyDrafts', () => {
  it('limits an editor to drafts, not an admin', () => {
    expect(mayDeleteOnlyDrafts('editor')).toBe(true);
    expect(mayDeleteOnlyDrafts('admin')).toBe(false);
  });

  it('fails closed: a provider and an unknown role are limited to drafts too', () => {
    expect(mayDeleteOnlyDrafts('provider')).toBe(true);
    expect(mayDeleteOnlyDrafts('ghost' as CmsRole)).toBe(true);
  });

  it('is the published-page rule of pageDeleteDenial, not a second one', () => {
    for (const role of ['provider', 'editor', 'admin', 'ghost'] as CmsRole[]) {
      expect(mayDeleteOnlyDrafts(role), role).toBe(pageDeleteDenial(role, 'published') !== null);
    }
  });
});
