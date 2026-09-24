'use server';

import { revalidatePath } from 'next/cache';
import { DEFAULT_LOCALE } from '@/db/cms-schema';
import { createMedia, deleteMedia, restoreMedia, updateMediaAlt } from '@/lib/cms/repo';
import { isAllowedUploadType, UPLOAD_MAX_BYTES } from './media-limits';
import { runAction } from './run';
import { actionError, actionOk, field, type ActionState } from './state';

/**
 * Media server actions.
 *
 * The upload is a **server action**, not a custom route handler, on purpose:
 * Next verifies the Origin/Host of every server-action POST, so multipart
 * uploads inherit that CSRF protection for free. The only custom route in this
 * area is the read-only bytes route (`/api/cms/media/[id]`).
 */

export async function uploadMediaAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) return actionError('Kies een bestand.');

    if (file.size > UPLOAD_MAX_BYTES) {
      return actionError(
        `Bestand is te groot (max ${Math.round(UPLOAD_MAX_BYTES / 1024 / 1024)} MB).`,
      );
    }
    const mimeType = file.type || 'application/octet-stream';
    if (!isAllowedUploadType(mimeType)) {
      return actionError(
        `Bestandstype ${mimeType} is niet toegestaan. Toegelaten: JPEG, PNG, WebP, AVIF, SVG.`,
      );
    }

    const alt = field(form, 'alt');
    const bytes = Buffer.from(await file.arrayBuffer());
    // Strip any directory component a crafted multipart part might carry.
    const filename = (file.name.split(/[\\/]/).pop() ?? 'bestand').slice(0, 200);

    const result = await createMedia({
      filename,
      mimeType,
      data: bytes,
      alt: alt ? { [DEFAULT_LOCALE]: alt } : {},
    });
    if (!result.ok) return actionError(result.message);

    revalidatePath('/admin/media');
    return actionOk(`“${filename}” is geüpload.`);
  });
}

export async function updateMediaAltAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const mediaId = field(form, 'mediaId');
    if (!mediaId) return actionError('Onbekend bestand.');

    const result = await updateMediaAlt(mediaId, { [DEFAULT_LOCALE]: field(form, 'alt') });
    if (!result.ok) return actionError(result.message);

    revalidatePath('/admin/media');
    return actionOk('Alt-tekst opgeslagen.');
  });
}

export async function deleteMediaAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const mediaId = field(form, 'mediaId');
    if (!mediaId) return actionError('Onbekend bestand.');

    const result = await deleteMedia(mediaId);
    if (!result.ok) return actionError(result.message);

    revalidatePath('/admin/media');
    return actionOk('Bestand verwijderd (herstelbaar).');
  });
}

export async function restoreMediaAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const mediaId = field(form, 'mediaId');
    if (!mediaId) return actionError('Onbekend bestand.');

    const result = await restoreMedia(mediaId);
    if (!result.ok) return actionError(result.message);

    revalidatePath('/admin/media');
    return actionOk('Bestand hersteld.');
  });
}
