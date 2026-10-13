import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import {
  ConcurrencyQueueFullError,
  createConcurrencyLimiter,
  type ConcurrencyLimiter,
} from './concurrency';

/**
 * Password hashing with Node's built-in `crypto.scrypt`.
 *
 * Chosen over bcrypt/argon2 on purpose: no native addon, so `npm install` and
 * the Vercel build stay clean, and it is a memory-hard KDF (unlike PBKDF2).
 * Not `server-only`: the CMS scripts (bootstrap, seeds, self-test, CLIs) load
 * it from plain Node.
 *
 * Stored format (single text column, self-describing so parameters can be
 * raised later without a migration):
 *
 *     scrypt$N$r$p$<salt-base64>$<hash-base64>
 *
 * New hashes use {@link PASSWORD_HASH_PARAMS} (N = 2^17, r = 8, p = 1). Older
 * ones (N = 2^15 until October 2026) still verify; `needsRehash()` flags them
 * and `./password-upgrade.ts` replaces them after a successful sign-in.
 *
 * Memory and concurrency:
 * - One scrypt call allocates 128·r·(N + p + 2) bytes and holds them until it
 *   finishes: ~128 MiB for the current set (~32 MiB for the old 2^15 one), for
 *   ~0.25 s on a developer laptop and longer on a shared vCPU.
 * - libuv runs scrypt on its threadpool, 4 threads by default: unbounded, four
 *   hashes would hold 512 MiB while more queue behind them, and the pool's
 *   other users (fs, dns, zlib) would wait too. Vercel functions get 2 GB by
 *   default, and Fluid compute serves several requests from one instance.
 * - So every scrypt call, hashing and verifying, goes through one limiter per
 *   process: 2 at a time (~256 MiB peak), at most 32 waiting; beyond that the
 *   call fails fast with {@link PasswordHasherBusyError}.
 * - What one attacker can trigger is bounded by the database-backed rate
 *   limits: 10 failed sign-ins per 15 minutes per e-mail or IP (`./auth.ts`)
 *   and the re-authentication limits in `./mfa/repo.ts`. The limiter bounds
 *   what all callers together can do to one instance.
 */

export type ScryptParams = { N: number; r: number; p: number };

/** Parameters of every new hash. Raising them means revisiting the maxmem and limiter below. */
export const PASSWORD_HASH_PARAMS = {
  N: 2 ** 17,
  r: 8,
  p: 1,
  saltBytes: 16,
  keyBytes: 64,
} as const;

const MiB = 1024 * 1024;

/**
 * The `maxmem` of every scrypt call. OpenSSL computes {@link scryptMemoryBytes}
 * before allocating and refuses the call when it is larger: the current set
 * needs 128 MiB + 3 KiB, so a round 128 MiB would refuse every hash (Node's
 * default is 32 MiB). 129 MiB leaves ~1 MiB of headroom and is also the memory
 * ceiling for a stored hash.
 */
export const PASSWORD_HASH_MAXMEM = 129 * MiB;

/** Per process: 2 scrypt calls at a time, 32 waiting (see above). */
export const PASSWORD_HASHER_CONCURRENCY = { max: 2, maxQueue: 32 } as const;

/**
 * Bytes one scrypt call allocates, as OpenSSL computes it for the `maxmem`
 * check: V, X and T take 128·r·(N + 2), B takes 128·r·p.
 */
export function scryptMemoryBytes({ N, r, p }: ScryptParams): number {
  return 128 * r * (N + p + 2);
}

/**
 * Every hashing slot of this process is taken and the wait queue is full.
 * Thrown by `hashPassword()` and `verifyPassword()`, never turned into
 * `false`: it says nothing about the password, so callers answer "try again
 * shortly" and do not count it as a failed attempt.
 */
export class PasswordHasherBusyError extends Error {
  constructor() {
    super('password hasher busy');
    this.name = 'PasswordHasherBusyError';
  }
}

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: ScryptParams & { maxmem: number },
) => Promise<Buffer>;

// One limiter per process, even when bundling or dev-server HMR evaluates this
// module more than once (the reason `src/db/cms.ts` caches on globalThis too).
const globalForPasswords = globalThis as unknown as {
  __bikefitPasswordHasher?: ConcurrencyLimiter;
};
const hasher = (globalForPasswords.__bikefitPasswordHasher ??= createConcurrencyLimiter(
  PASSWORD_HASHER_CONCURRENCY.max,
  PASSWORD_HASHER_CONCURRENCY.maxQueue,
));

/** The only place scrypt runs: NFKC-normalised password, the limiter, the fixed maxmem. */
async function deriveKey(
  password: string,
  salt: Buffer,
  keyBytes: number,
  { N, r, p }: ScryptParams,
): Promise<Buffer> {
  const normalized = password.normalize('NFKC');
  try {
    return await hasher.run(() =>
      scrypt(normalized, salt, keyBytes, { N, r, p, maxmem: PASSWORD_HASH_MAXMEM }),
    );
  } catch (error) {
    if (error instanceof ConcurrencyQueueFullError) throw new PasswordHasherBusyError();
    throw error;
  }
}

// --- Parsing a stored hash -----------------------------------------------------

const PREFIX = 'scrypt';
/** The cheapest parameters a stored hash may use. */
const MIN_N = 2 ** 14;
/** scrypt's CPU cost grows with N·r·p: a stored hash may not ask for more than a new one. */
const MAX_WORK = PASSWORD_HASH_PARAMS.N * PASSWORD_HASH_PARAMS.r * PASSWORD_HASH_PARAMS.p;
const SALT_BYTES = { min: 16, max: 64 };
/** A short key is easy to match by chance (one byte: 1 password in 256). */
const KEY_BYTES = { min: 32, max: 64 };
/** Well above any valid hash (7-digit parameters, 64-byte salt and key: ~210 characters). */
const MAX_STORED_LENGTH = 256;
const WHOLE_NUMBER = /^[1-9][0-9]{0,6}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

type StoredHash = { params: ScryptParams; salt: Buffer; key: Buffer };

function parseWholeNumber(text: string): number | null {
  return WHOLE_NUMBER.test(text) ? Number(text) : null;
}

/** Canonical base64 only (what `toString('base64')` writes); `Buffer.from` skips junk silently. */
function decodeBase64(text: string): Buffer | null {
  if (!BASE64.test(text)) return null;
  const bytes = Buffer.from(text, 'base64');
  return bytes.toString('base64') === text ? bytes : null;
}

/**
 * The stored hash, or null when it is malformed or asks for more than a new
 * hash costs: N a power of two in [2^14, 2^17], N·r·p no higher than for
 * {@link PASSWORD_HASH_PARAMS}, memory within {@link PASSWORD_HASH_MAXMEM}.
 * Checked before any scrypt call, so a corrupt row costs nothing. Never throws.
 */
function parseStoredHash(stored: string): StoredHash | null {
  if (typeof stored !== 'string' || stored.length > MAX_STORED_LENGTH) return null;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return null;

  const N = parseWholeNumber(parts[1]);
  const r = parseWholeNumber(parts[2]);
  const p = parseWholeNumber(parts[3]);
  if (N === null || r === null || p === null) return null;
  const params = { N, r, p };
  if (
    N < MIN_N ||
    N > PASSWORD_HASH_PARAMS.N ||
    (N & (N - 1)) !== 0 ||
    N * r * p > MAX_WORK ||
    scryptMemoryBytes(params) > PASSWORD_HASH_MAXMEM
  ) {
    return null;
  }

  const salt = decodeBase64(parts[4]);
  const key = decodeBase64(parts[5]);
  if (!salt || salt.length < SALT_BYTES.min || salt.length > SALT_BYTES.max) return null;
  if (!key || key.length < KEY_BYTES.min || key.length > KEY_BYTES.max) return null;
  return { params, salt, key };
}

// --- Public API ----------------------------------------------------------------

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

/** A new hash with {@link PASSWORD_HASH_PARAMS}. Throws {@link PasswordHasherBusyError} when saturated. */
export async function hashPassword(password: string): Promise<string> {
  const { N, r, p, saltBytes, keyBytes } = PASSWORD_HASH_PARAMS;
  const salt = randomBytes(saltBytes);
  const key = await deriveKey(password, salt, keyBytes, PASSWORD_HASH_PARAMS);
  return [PREFIX, N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

/**
 * Constant-time verification with the parameters stored in the hash. Returns
 * false for a wrong password and for a malformed, unknown or out-of-bounds
 * hash (refused before any scrypt work), so a corrupted row cannot 500 the
 * login route. Throws only when scrypt itself could not answer:
 * {@link PasswordHasherBusyError}, or an operational failure (logged), which
 * must not be counted as a wrong password.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof password !== 'string') return false;
  const parsed = parseStoredHash(stored);
  if (!parsed) return false;
  try {
    const actual = await deriveKey(password, parsed.salt, parsed.key.length, parsed.params);
    return actual.length === parsed.key.length && timingSafeEqual(actual, parsed.key);
  } catch (error) {
    // Not an answer about the password (allocation failure on a starved
    // instance, …): never count it as a failed attempt. Logged, then thrown.
    if (!(error instanceof PasswordHasherBusyError)) {
      console.error('[cms-auth] scrypt failed', error instanceof Error ? error.name : typeof error);
    }
    throw error;
  }
}

/**
 * True unless `stored` is a well-formed hash with exactly the current
 * parameters, salt and key length: so true for legacy and malformed hashes.
 * Cheap, no scrypt.
 */
export function needsRehash(stored: string): boolean {
  const parsed = parseStoredHash(stored);
  const { N, r, p, saltBytes, keyBytes } = PASSWORD_HASH_PARAMS;
  return !(
    parsed &&
    parsed.params.N === N &&
    parsed.params.r === r &&
    parsed.params.p === p &&
    parsed.salt.length === saltBytes &&
    parsed.key.length === keyBytes
  );
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
