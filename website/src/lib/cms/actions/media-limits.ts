/**
 * Upload limits shared by the client form (accept attribute, inline hint) and
 * the server action that enforces them. A plain module, not a `'use server'`
 * file, because those may only export async functions.
 */

/**
 * Stricter than `repo.createMedia()`'s own 8 MB ceiling. The upload is a
 * server action, so `experimental.serverActions.bodySizeLimit` in
 * `next.config.ts` (6 MB) must stay above this; change them together.
 */
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

/**
 * `repo.createMedia()` refuses anything outside this list as well. PDF is
 * deliberately absent: the foundation's allow-list is images only, and
 * widening it would mean editing Worker A's file.
 */
export const UPLOAD_ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/svg+xml',
] as const;

export type UploadMimeType = (typeof UPLOAD_ALLOWED_TYPES)[number];

export const UPLOAD_ACCEPT = UPLOAD_ALLOWED_TYPES.join(',');

export function isAllowedUploadType(mimeType: string): mimeType is UploadMimeType {
  return (UPLOAD_ALLOWED_TYPES as readonly string[]).includes(mimeType);
}
