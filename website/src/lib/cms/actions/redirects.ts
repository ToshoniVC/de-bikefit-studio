'use server';

import { revalidatePath } from 'next/cache';
import { createRedirect, deleteRedirect, updateRedirect } from '@/lib/cms/repo';
import { runAction } from './run';
import { actionError, actionOk, boolField, field, type ActionState } from './state';

/**
 * Redirect server actions — admin only, enforced by `requirePermission`
 * (`redirect.manage`) inside `repo.ts`.
 */

/** `from` must be a site-relative path; `to` a relative path or an https URL. */
function validate(fromPath: string, toPath: string): string | null {
  if (!fromPath.startsWith('/')) return 'Het bronpad moet met “/” beginnen.';
  if (fromPath.startsWith('//')) return 'Het bronpad mag niet met “//” beginnen.';
  if (!toPath) return 'Vul een doel in.';
  if (toPath.startsWith('//')) return 'Het doel mag niet met “//” beginnen.';
  if (toPath.startsWith('/')) return null;
  if (/^https:\/\/[^\s]+$/i.test(toPath)) return null;
  return 'Het doel moet een pad zijn (/pagina) of een volledige https://-URL.';
}

function statusCodeFrom(form: FormData): 301 | 302 {
  return field(form, 'statusCode') === '302' ? 302 : 301;
}

export async function createRedirectAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const fromPath = field(form, 'fromPath');
    const toPath = field(form, 'toPath');

    const invalid = validate(fromPath, toPath);
    if (invalid) return actionError(invalid);

    const result = await createRedirect({
      fromPath,
      toPath,
      statusCode: statusCodeFrom(form),
      isEnabled: boolField(form, 'isEnabled'),
      notes: field(form, 'notes') || null,
    });
    if (!result.ok) return actionError(result.message);

    revalidatePath('/admin/redirects');
    return actionOk(`Redirect ${result.data.fromPath} → ${result.data.toPath} aangemaakt.`);
  });
}

export async function updateRedirectAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const redirectId = field(form, 'redirectId');
    if (!redirectId) return actionError('Onbekende redirect.');

    const fromPath = field(form, 'fromPath');
    const toPath = field(form, 'toPath');
    const invalid = validate(fromPath, toPath);
    if (invalid) return actionError(invalid);

    const result = await updateRedirect(redirectId, {
      fromPath,
      toPath,
      statusCode: statusCodeFrom(form),
      isEnabled: boolField(form, 'isEnabled'),
      notes: field(form, 'notes') || null,
    });
    if (!result.ok) return actionError(result.message);

    revalidatePath('/admin/redirects');
    return actionOk('Redirect opgeslagen.');
  });
}

/** Enable/disable without opening the edit form. */
export async function toggleRedirectAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const redirectId = field(form, 'redirectId');
    if (!redirectId) return actionError('Onbekende redirect.');

    const isEnabled = field(form, 'isEnabled') === 'true';
    const result = await updateRedirect(redirectId, { isEnabled });
    if (!result.ok) return actionError(result.message);

    revalidatePath('/admin/redirects');
    return actionOk(isEnabled ? 'Redirect ingeschakeld.' : 'Redirect uitgeschakeld.');
  });
}

export async function deleteRedirectAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const redirectId = field(form, 'redirectId');
    if (!redirectId) return actionError('Onbekende redirect.');

    const result = await deleteRedirect(redirectId);
    if (!result.ok) return actionError(result.message);

    revalidatePath('/admin/redirects');
    return actionOk('Redirect verwijderd.');
  });
}
