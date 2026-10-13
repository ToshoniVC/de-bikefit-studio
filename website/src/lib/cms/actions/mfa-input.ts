import { z } from 'zod';
import { PASSWORD_MAX_LENGTH } from '../password';

/**
 * Shape checks for the two-step verification forms (`./mfa.ts`), run before
 * any database work and before a rate-limit reservation: an oversized or
 * non-text field is refused with the form's usual Dutch message and costs no
 * attempt. A plain module, not a `'use server'` file (those may only export
 * async functions), so it is unit-tested (`mfa-input.test.ts`).
 *
 * Bounds:
 * - a code field takes a six-digit code (`123 456` too) or a recovery code
 *   typed with dashes or spaces (16 symbols, `XXXX-XXXX-XXXX-XXXX` is 19
 *   characters; see `normalizeTotpCode` and `normalizeRecoveryCode`): 64,
 *   after trimming, is generous;
 * - a password field takes at most {@link PASSWORD_MAX_LENGTH} characters,
 *   the longest password `validatePasswordStrength()` lets anyone set, and is
 *   never trimmed;
 * - a user id is a UUID; 64 characters, trimmed.
 */

export const MFA_CODE_MAX_LENGTH = 64;
export const USER_ID_MAX_LENGTH = 64;

/** A missing field reads as empty; anything but text (a file in a multipart post) fails. */
const formField = <T extends z.ZodType>(schema: T) => z.preprocess((value) => value ?? '', schema);

/** A code or a recovery code; may be empty here, the form says what is missing. */
const code = formField(z.string().trim().max(MFA_CODE_MAX_LENGTH));
const password = formField(z.string().max(PASSWORD_MAX_LENGTH));

export const mfaCodeForm = z.object({ code });
export const reauthForm = z.object({ password, code });
export const challengePasswordForm = z.object({
  currentPassword: password,
  newPassword: password,
  repeatPassword: password,
});
export const resetUserMfaForm = reauthForm.extend({
  userId: formField(z.string().trim().max(USER_ID_MAX_LENGTH)),
});

export type ParsedForm<T> = { ok: true; data: T } | { ok: false; field: string };

/** Reads the schema's fields from the form; on failure names the first field that does not fit. */
export function parseForm<S extends z.ZodObject>(
  schema: S,
  form: FormData,
): ParsedForm<z.output<S>> {
  const raw = Object.fromEntries(Object.keys(schema.shape).map((name) => [name, form.get(name)]));
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, field: String(parsed.error.issues[0]?.path[0] ?? '') };
}
