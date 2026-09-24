'use server';

import { revalidatePath } from 'next/cache';
import { isBlockType } from '@/lib/cms/blocks';
import { addBlock, deleteBlock, getPageForEdit, reorderBlocks, updateBlock } from '@/lib/cms/repo';
import { sanitizeBlockData } from './sanitize';
import { runAction } from './run';
import { actionError, actionOk, field, type ActionState } from './state';

/**
 * Draft-block server actions. Block payloads travel as one JSON string from the
 * client editor; the server re-sanitises them (links + rich-text HTML) and
 * `repo.updateBlock()` validates against the zod schema in the registry, so the
 * browser form is never trusted.
 */

export async function addBlockAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const pageId = field(form, 'pageId');
    const type = field(form, 'type');
    if (!pageId) return actionError('Onbekende pagina.');
    if (!isBlockType(type)) return actionError('Onbekend bloktype.');

    const result = await addBlock(pageId, type);
    if (!result.ok) return actionError(result.message);

    revalidatePath(`/admin/pages/${pageId}`);
    return actionOk('Blok toegevoegd.');
  });
}

export async function updateBlockAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const blockId = field(form, 'blockId');
    const pageId = field(form, 'pageId');
    const raw = form.get('data');
    if (!blockId) return actionError('Onbekend blok.');
    if (typeof raw !== 'string') return actionError('Geen blokinhoud ontvangen.');

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return actionError('De blokinhoud is geen geldige JSON.');
    }

    const sanitized = sanitizeBlockData(parsed);
    if (!sanitized.ok) return actionError(sanitized.message);

    const result = await updateBlock(blockId, sanitized.data);
    if (!result.ok) return actionError(result.message);

    if (pageId) revalidatePath(`/admin/pages/${pageId}`);
    return actionOk('Blok opgeslagen.');
  });
}

export async function deleteBlockAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const blockId = field(form, 'blockId');
    const pageId = field(form, 'pageId');
    if (!blockId) return actionError('Onbekend blok.');

    const result = await deleteBlock(blockId);
    if (!result.ok) return actionError(result.message);

    if (pageId) revalidatePath(`/admin/pages/${pageId}`);
    return actionOk('Blok verwijderd.');
  });
}

/** Move one block up or down; `reorderBlocks()` re-numbers the whole page. */
export async function moveBlockAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const pageId = field(form, 'pageId');
    const blockId = field(form, 'blockId');
    const direction = field(form, 'direction');
    if (!pageId || !blockId) return actionError('Onbekend blok.');
    if (direction !== 'up' && direction !== 'down') return actionError('Onbekende richting.');

    const page = await getPageForEdit(pageId);
    if (!page) return actionError('Pagina niet gevonden.');

    const order = page.blocks.map((block) => block.id);
    const index = order.indexOf(blockId);
    if (index < 0) return actionError('Blok hoort niet bij deze pagina.');

    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= order.length) return actionOk('Blok staat al op die plaats.');

    [order[index], order[target]] = [order[target], order[index]];

    const result = await reorderBlocks(pageId, order);
    if (!result.ok) return actionError(result.message);

    revalidatePath(`/admin/pages/${pageId}`);
    return actionOk('Volgorde aangepast.');
  });
}
