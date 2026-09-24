'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { DEFAULT_LOCALE } from '@/db/cms-schema';
import { STRUCTURED_DATA_TYPES } from '@/lib/cms/blocks';
import { createPage, deletePage, publishPage, unpublishPage } from '@/lib/cms/repo';
import { updatePageMeta } from '@/lib/cms/repo-admin';
import { isUnsafeUrl } from './sanitize';
import { runAction } from './run';
import { actionError, actionOk, boolField, field, nullableField, type ActionState } from './state';

/**
 * Page + SEO server actions.
 *
 * Every one of these goes through `repo.ts`, which calls `requirePermission()`
 * server-side. The UI also hides what a role cannot do, but that is cosmetic:
 * an editor that posts a publish action still gets a permission error here.
 */

export async function createPageAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const title = field(form, 'title');
    if (!title) return actionError('Geef de pagina een titel.');

    const result = await createPage({
      locale: field(form, 'locale') || DEFAULT_LOCALE,
      slug: field(form, 'slug'),
      title,
      kind: field(form, 'kind') || 'default',
      translationGroup: field(form, 'translationGroup') || undefined,
    });
    if (!result.ok) return actionError(result.message);

    revalidatePath('/admin/pages');
    redirect(`/admin/pages/${result.data.id}`);
  });
}

export async function updatePageAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const pageId = field(form, 'pageId');
    if (!pageId) return actionError('Onbekende pagina.');

    const title = field(form, 'title');
    if (!title) return actionError('Geef de pagina een titel.');

    const canonical = nullableField(form, 'canonicalOverride');
    if (canonical && isUnsafeUrl(canonical)) {
      return actionError('De canonical-URL gebruikt een niet-toegelaten schema.');
    }

    const structuredDataType = field(form, 'structuredDataType');
    if (structuredDataType && !STRUCTURED_DATA_TYPES.includes(structuredDataType as never)) {
      return actionError('Onbekend type structured data.');
    }

    let structuredDataOverrides: Record<string, unknown> | null = null;
    const rawOverrides = field(form, 'structuredDataOverrides');
    if (rawOverrides) {
      try {
        const parsed: unknown = JSON.parse(rawOverrides);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return actionError('Structured data-overrides moeten een JSON-object zijn.');
        }
        structuredDataOverrides = parsed as Record<string, unknown>;
      } catch {
        return actionError('Structured data-overrides zijn geen geldige JSON.');
      }
    }

    const result = await updatePageMeta(pageId, {
      title,
      slug: field(form, 'slug'),
      kind: field(form, 'kind') || 'default',
      translationGroup: field(form, 'translationGroup'),
      metaTitle: nullableField(form, 'metaTitle'),
      metaDescription: nullableField(form, 'metaDescription'),
      canonicalOverride: canonical,
      ogTitle: nullableField(form, 'ogTitle'),
      ogDescription: nullableField(form, 'ogDescription'),
      ogImageMediaId: nullableField(form, 'ogImageMediaId'),
      noIndex: boolField(form, 'noIndex'),
      structuredDataType: structuredDataType === '' ? null : structuredDataType,
      structuredDataOverrides,
    });
    if (!result.ok) return actionError(result.message);

    revalidatePath(`/admin/pages/${pageId}`);
    revalidatePath('/admin/pages');
    return actionOk('Pagina opgeslagen.');
  });
}

export async function deletePageAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const pageId = field(form, 'pageId');
    if (!pageId) return actionError('Onbekende pagina.');
    if (field(form, 'confirm') !== 'VERWIJDER') {
      return actionError('Typ VERWIJDER om de pagina definitief te verwijderen.');
    }

    const result = await deletePage(pageId);
    if (!result.ok) return actionError(result.message);

    revalidatePath('/admin/pages');
    redirect('/admin/pages');
  });
}

export async function publishPageAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const pageId = field(form, 'pageId');
    if (!pageId) return actionError('Onbekende pagina.');

    const result = await publishPage(pageId);
    if (!result.ok) return actionError(result.message);

    revalidatePath(`/admin/pages/${pageId}`);
    revalidatePath('/admin/pages');
    return actionOk('Pagina gepubliceerd.');
  });
}

export async function unpublishPageAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const pageId = field(form, 'pageId');
    if (!pageId) return actionError('Onbekende pagina.');

    const result = await unpublishPage(pageId);
    if (!result.ok) return actionError(result.message);

    revalidatePath(`/admin/pages/${pageId}`);
    revalidatePath('/admin/pages');
    return actionOk('Pagina is offline gehaald. De snapshot blijft bewaard.');
  });
}
