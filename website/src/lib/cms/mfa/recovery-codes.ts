import { createHash, randomBytes } from 'node:crypto';

/**
 * One-use recovery codes for CMS two-step verification. Pure and unit-tested
 * (`recovery-codes.test.ts`).
 *
 * - {@link RECOVERY_CODE_COUNT} codes of 16 symbols from a 32-symbol alphabet:
 *   80 random bits each (one byte → one symbol, 256 / 32 has no modulo bias).
 *   Shown once as `XXXX-XXXX-XXXX-XXXX`.
 * - Only `SHA-256("cms-mfa-recovery:v1:<userId>:<code>")` is stored. A fast
 *   hash is sound here because the input is 80 bits of randomness, not a
 *   human-chosen password (brute force needs ~2^79 tries), and the user id in
 *   the input means equal codes for two users never share a hash. It is
 *   deliberately independent of `CMS_MFA_ENCRYPTION_KEY` and
 *   `CMS_SESSION_SECRET`: if a key is rotated or lost, the codes still work
 *   and are how an admin gets back in to re-enrol.
 * - Typing is forgiving: case, spaces and dashes are ignored, and the
 *   look-alikes O → 0 and I/L → 1 are mapped (Crockford base32).
 */

export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_CODE_LENGTH = 16;

/** Crockford base32: no I, L, O or U. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateRecoveryCode(): string {
  const bytes = randomBytes(RECOVERY_CODE_LENGTH);
  let raw = '';
  for (const byte of bytes) raw += ALPHABET[byte % ALPHABET.length];
  return formatRecoveryCode(raw);
}

export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(generateRecoveryCode());
  return [...codes];
}

/** `ABCD-EFGH-JKMN-PQRS` from the 16 bare symbols. */
export function formatRecoveryCode(normalized: string): string {
  return normalized.match(/.{1,4}/g)?.join('-') ?? normalized;
}

/** The 16 bare symbols, or `null` when the input cannot be a recovery code. */
export function normalizeRecoveryCode(input: string): string | null {
  const clean = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (clean.length !== RECOVERY_CODE_LENGTH) return null;
  for (const char of clean) if (!ALPHABET.includes(char)) return null;
  return clean;
}

/** Hex SHA-256 of a normalised code, bound to its owner. */
export function hashRecoveryCode(userId: string, normalized: string): string {
  return createHash('sha256').update(`cms-mfa-recovery:v1:${userId}:${normalized}`).digest('hex');
}
