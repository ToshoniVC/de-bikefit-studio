import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Password hashing with Node's built-in `crypto.scrypt`.
 *
 * Chosen over bcrypt/argon2 on purpose: no native addon, so `npm install` and
 * the Vercel build stay clean, and it is a memory-hard KDF (unlike PBKDF2).
 *
 * Stored format (single text column, self-describing so parameters can be
 * raised later without a migration):
 *
 *     scrypt$N$r$p$<salt-base64>$<hash-base64>
 */

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const PREFIX = 'scrypt';
const SALT_BYTES = 16;
const KEY_BYTES = 64;

/** ~64 MB of memory per hash: comfortably above the default 16 MB ceiling. */
const PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const MAXMEM = 256 * 1024 * 1024;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

/** Returns a human-readable reason, or `null` when the password is acceptable. */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Wachtwoord moet minstens ${PASSWORD_MIN_LENGTH} tekens lang zijn.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Wachtwoord mag hoogstens ${PASSWORD_MAX_LENGTH} tekens lang zijn.`;
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Wachtwoord moet minstens één kleine letter, één hoofdletter en één cijfer bevatten.';
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_BYTES, {
    ...PARAMS,
    maxmem: MAXMEM,
  });
  return [
    PREFIX,
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * Constant-time verification. Returns false (never throws) for malformed or
 * unknown hash formats, so a corrupted row cannot 500 the login route.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== PREFIX) return false;

    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    if (salt.length === 0 || expected.length === 0) return false;

    const actual = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: MAXMEM,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Temporary password for `createUser()` / password resets (admin-visible once). */
export function generateTemporaryPassword(): string {
  // Ambiguous glyphs (O/0, l/1/I) removed so the password can be read aloud.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(20);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  // Guarantee the generated value satisfies validatePasswordStrength().
  return `Bf${out}7`;
}
