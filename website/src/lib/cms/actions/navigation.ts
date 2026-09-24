'use server';

import { revalidatePath } from 'next/cache';
import { DEFAULT_LOCALE } from '@/db/cms-schema';
import { NAVIGATION_KEYS, type NavigationKey } from '@/lib/cms/blocks';
import { updateNavigation } from '@/lib/cms/repo';
import { isUnsafeUrl } from './sanitize';
import { runAction } from './run';
import { actionError, actionOk, field, type ActionState } from './state';

/** Menu items travel as JSON from the editor; zod validates them in `repo.ts`. */
export async function updateNavigationAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const locale = field(form, 'locale') || DEFAULT_LOCALE;
    const menuKey = field(form, 'menuKey');
    if (!NAVIGATION_KEYS.includes(menuKey as NavigationKey)) {
      return actionError('Onbekend menu.');
    }

    const raw = form.get('items');
    if (typeof raw !== 'string') return actionError('Geen menu-inhoud ontvangen.');

    let items: unknown;
    try {
      items = JSON.parse(raw);
    } catch {
      return actionError('De menu-inhoud is geen geldige JSON.');
    }

    if (hasUnsafeHref(items)) {
      return actionError('Een menulink gebruikt een niet-toegelaten schema.');
    }

    const result = await updateNavigation(locale, menuKey, items);
    if (!result.ok) return actionError(result.message);

    revalidatePath('/admin/navigation');
    return actionOk('Menu opgeslagen.');
  });
}

function hasUnsafeHref(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasUnsafeHref);
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
      key === 'href' && typeof child === 'string' ? isUnsafeUrl(child) : hasUnsafeHref(child),
    );
  }
  return false;
}
