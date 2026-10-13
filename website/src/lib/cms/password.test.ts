import { randomBytes, scryptSync } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PASSWORD_HASHER_CONCURRENCY,
  PASSWORD_HASH_MAXMEM,
  PASSWORD_HASH_PARAMS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PasswordHasherBusyError,
  generateTemporaryPassword,
  hashPassword,
  needsRehash,
  scryptMemoryBytes,
  validatePasswordStrength,
  verifyPassword,
  type ScryptParams,
} from './password';

/**
 * `crypto.scrypt` is wrapped, not replaced: every call still runs the real
 * KDF, but the test sees its parameters and how many run at once. That is how
 * "refused before any scrypt work" and "at most two at a time" are checked.
 *
 * Each N = 2^17 hash costs ~128 MiB and ~0.25 s or more, so only a handful run
 * here; the limiter tests use the cheapest parameters a stored hash may have.
 */
const kdf = vi.hoisted(() => ({
  calls: [] as Array<{ N: number; r: number; p: number }>,
  inFlight: 0,
  peak: 0,
  /** Next scrypt call fails as OpenSSL does when it cannot allocate. */
  failNext: false,
}));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  type Done = (error: Error | null, key?: Buffer) => void;
  const realScrypt = actual.scrypt as unknown as (...args: unknown[]) => void;
  const scrypt = (...args: unknown[]) => {
    const done = args.pop() as Done;
    const { N, r, p } = args[3] as { N: number; r: number; p: number };
    kdf.calls.push({ N, r, p });
    if (kdf.failNext) {
      kdf.failNext = false;
      setImmediate(() => done(new RangeError('memory limit exceeded')));
      return;
    }
    kdf.inFlight += 1;
    kdf.peak = Math.max(kdf.peak, kdf.inFlight);
    try {
      realScrypt(...args, (error: Error | null, key?: Buffer) => {
        kdf.inFlight -= 1;
        done(error, key);
      });
    } catch (error) {
      kdf.inFlight -= 1;
      throw error;
    }
  };
  return { ...actual, scrypt };
});

const SLOW = 60_000;
const MiB = 1024 * 1024;
const PASSWORD = 'Correct-Horse-9-Battery';
const LEGACY = { N: 2 ** 15, r: 8, p: 1 };
/** In bounds for a stored hash, and ~1000× cheaper than the current set. */
const CHEAP = { N: 2 ** 14, r: 1, p: 1 };

/** A stored hash made with node:crypto directly, the way an older `hashPassword()` did. */
function craftHash(password: string, { N, r, p }: ScryptParams): string {
  const salt = randomBytes(16);
  const key = scryptSync(password.normalize('NFKC'), salt, 64, { N, r, p, maxmem: 256 * MiB });
  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

beforeEach(() => {
  kdf.calls.length = 0;
  kdf.peak = 0;
});

describe('hashPassword / verifyPassword', () => {
  it(
    'writes self-describing, salted N=2^17 hashes that verify only the right password',
    async () => {
      const [first, second] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);
      expect(first).toMatch(/^scrypt\$131072\$8\$1\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{86}==$/);
      expect(first).not.toBe(second);
      expect(first.split('$')[4]).not.toBe(second.split('$')[4]);
      expect(await verifyPassword(PASSWORD, first)).toBe(true);
      expect(await verifyPassword('correct-horse-9-battery', first)).toBe(false);
      expect(needsRehash(first)).toBe(false);
      expect(needsRehash(second)).toBe(false);
      const { N, r, p } = PASSWORD_HASH_PARAMS;
      expect(kdf.calls).toEqual(Array(4).fill({ N, r, p }));
    },
    SLOW,
  );

  it(
    'still verifies a legacy N=2^15 hash, which needs a rehash',
    async () => {
      const legacy = craftHash(PASSWORD, LEGACY);
      expect(legacy.startsWith('scrypt$32768$8$1$')).toBe(true);
      expect(await verifyPassword(PASSWORD, legacy)).toBe(true);
      expect(await verifyPassword('Correct-Horse-9-Batterij', legacy)).toBe(false);
      expect(needsRehash(legacy)).toBe(true);
      expect(kdf.calls).toEqual([LEGACY, LEGACY]);
    },
    SLOW,
  );

  it(
    'runs a full-cost verification for a timing-equaliser hash built from PASSWORD_HASH_PARAMS',
    async () => {
      // The recipe of DUMMY_HASH in ./auth.ts: an unknown e-mail must cost
      // exactly the scrypt work of a real account.
      const { N, r, p, keyBytes } = PASSWORD_HASH_PARAMS;
      const dummy = [
        'scrypt',
        N,
        r,
        p,
        Buffer.from('cms-timing-equaliser').toString('base64'),
        Buffer.alloc(keyBytes).toString('base64'),
      ].join('$');
      expect(await verifyPassword(PASSWORD, dummy)).toBe(false);
      expect(kdf.calls).toEqual([{ N, r, p }]);
    },
    SLOW,
  );

  it('returns false for malformed or out-of-bounds hashes without running scrypt', async () => {
    const salt = Buffer.alloc(16, 1).toString('base64');
    const key = Buffer.alloc(64, 2).toString('base64');
    const at = (N: unknown, r: unknown, p: unknown, s = salt, k = key) =>
      ['scrypt', N, r, p, s, k].join('$');
    const rejected = [
      '',
      'plain-text',
      '$2b$12$abcdefghijklmnopqrstuv',
      `scrypt$32768$8$1$${salt}`,
      `${at(32768, 8, 1)}$extra`,
      `argon2$32768$8$1$${salt}$${key}`,
      // N: not a power of two, outside [2^14, 2^17], not a plain whole number
      at(3, 8, 1),
      at(2 ** 15 + 2, 8, 1),
      at(2 ** 13, 8, 1),
      at(2 ** 18, 8, 1),
      at(2 ** 18, 2, 1), // within the CPU and memory bounds, refused for N alone
      at(2 ** 20, 8, 1),
      at(2 ** 40, 8, 1),
      at(0, 8, 1),
      at(-32768, 8, 1),
      at('x', 8, 1),
      at('032768', 8, 1),
      at('0x8000', 8, 1),
      at('3.2768e4', 8, 1),
      at('32768.0', 8, 1),
      at(' 32768', 8, 1),
      // r, p: more CPU (N·r·p) or memory than the current set
      at(32768, 64, 1),
      at(32768, 8, 16),
      at(2 ** 17, 8, 2),
      at(2 ** 17, 9, 1),
      at(2 ** 14, 128, 1),
      at(32768, 0, 1),
      at(32768, 8, 0),
      at(32768, 8, 1.5),
      // salt and key: missing, too short (a 1-byte key matches 1 password in 256), too long, not canonical base64
      at(32768, 8, 1, ''),
      at(32768, 8, 1, salt, ''),
      at(32768, 8, 1, Buffer.alloc(8).toString('base64')),
      at(32768, 8, 1, salt, Buffer.alloc(1).toString('base64')),
      at(32768, 8, 1, salt, Buffer.alloc(16).toString('base64')),
      at(32768, 8, 1, salt, Buffer.alloc(65).toString('base64')),
      at(32768, 8, 1, salt.replace(/=+$/, '')),
      at(32768, 8, 1, `${salt}!`),
      at(32768, 8, 1, salt, `${key.slice(0, -2)}-_`),
      `scrypt${'$32768'.repeat(500)}`,
    ];
    for (const stored of rejected) {
      await expect(verifyPassword(PASSWORD, stored), stored).resolves.toBe(false);
      expect(needsRehash(stored), stored).toBe(true);
    }
    for (const stored of [null, undefined, 42] as unknown as string[]) {
      await expect(verifyPassword(PASSWORD, stored)).resolves.toBe(false);
      expect(needsRehash(stored)).toBe(true);
    }
    // A well-formed hash, but no password string: still false, still no work.
    await expect(verifyPassword(undefined as unknown as string, at(32768, 8, 1))).resolves.toBe(
      false,
    );
    expect(kdf.calls).toEqual([]);
  });

  it('needsRehash wants exactly the current parameters, salt and key length', () => {
    const { N, r, p } = PASSWORD_HASH_PARAMS;
    const at = (saltBytes: number, keyBytes: number) =>
      [
        'scrypt',
        N,
        r,
        p,
        Buffer.alloc(saltBytes, 1).toString('base64'),
        Buffer.alloc(keyBytes, 2).toString('base64'),
      ].join('$');
    expect(needsRehash(at(16, 64))).toBe(false);
    expect(needsRehash(at(32, 64))).toBe(true);
    expect(needsRehash(at(16, 32))).toBe(true);
    expect(needsRehash(craftHash(PASSWORD, CHEAP))).toBe(true);
  });
});

describe('scrypt memory and maxmem', () => {
  it('needs 128·r·(N+p+2) bytes: ~32 MiB for the old set, ~128 MiB for the new one, under maxmem', () => {
    expect(scryptMemoryBytes(LEGACY)).toBe(32 * MiB + 3 * 1024);
    expect(scryptMemoryBytes(PASSWORD_HASH_PARAMS)).toBe(128 * MiB + 3 * 1024);
    // Why maxmem cannot be a round 128 MiB, nor Node's default of 32 MiB.
    expect(scryptMemoryBytes(PASSWORD_HASH_PARAMS)).toBeGreaterThan(128 * MiB);
    expect(scryptMemoryBytes(PASSWORD_HASH_PARAMS)).toBeLessThanOrEqual(PASSWORD_HASH_MAXMEM);
    expect(scryptMemoryBytes(LEGACY)).toBeLessThanOrEqual(PASSWORD_HASH_MAXMEM);
    expect(PASSWORD_HASH_MAXMEM - scryptMemoryBytes(PASSWORD_HASH_PARAMS)).toBeLessThan(MiB);
  });

  it('matches the figure OpenSSL checks maxmem against, to the byte', () => {
    const outcome = (params: ScryptParams, maxmem: number) => {
      try {
        scryptSync('x', 'salt', 16, { ...params, maxmem });
        return 'ok';
      } catch (error) {
        return (error as { code?: string }).code;
      }
    };
    const refused = 'ERR_CRYPTO_INVALID_SCRYPT_PARAMS';
    expect(outcome(CHEAP, scryptMemoryBytes(CHEAP) - 1)).toBe(refused);
    expect(outcome(CHEAP, scryptMemoryBytes(CHEAP))).toBe('ok');
    // Refused before anything is allocated, so these cost nothing.
    const { N, r, p } = PASSWORD_HASH_PARAMS;
    expect(outcome({ N, r, p }, scryptMemoryBytes({ N, r, p }) - 1)).toBe(refused);
    expect(outcome({ N, r, p }, 128 * MiB)).toBe(refused);
  });
});

describe('an operational scrypt failure', () => {
  it('is thrown and logged, never reported as a wrong password; the slot is freed', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stored = craftHash(PASSWORD, CHEAP);
    kdf.failNext = true;
    await expect(verifyPassword(PASSWORD, stored)).rejects.toThrow('memory limit exceeded');
    expect(log).toHaveBeenCalledWith('[cms-auth] scrypt failed', 'RangeError');
    log.mockRestore();
    expect(await verifyPassword(PASSWORD, stored)).toBe(true);
  });
});

describe('the per-process hashing limiter', () => {
  it('lets at most two scrypt computations run at once', async () => {
    const stored = craftHash(PASSWORD, CHEAP);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => verifyPassword(PASSWORD, stored)),
    );
    expect(results).toEqual(Array(8).fill(true));
    expect(kdf.calls).toHaveLength(8);
    expect(kdf.peak).toBe(PASSWORD_HASHER_CONCURRENCY.max);
  });

  it(
    'refuses work beyond the wait queue with PasswordHasherBusyError (not false), then recovers',
    async () => {
      const { max, maxQueue } = PASSWORD_HASHER_CONCURRENCY;
      const stored = craftHash(PASSWORD, CHEAP);
      // All in one synchronous stretch: nothing can finish in between.
      const accepted = Promise.allSettled(
        Array.from({ length: max + maxQueue }, () => verifyPassword(PASSWORD, stored)),
      );
      const overflow = await Promise.allSettled([
        verifyPassword(PASSWORD, stored),
        hashPassword(PASSWORD),
      ]);

      for (const outcome of overflow) {
        expect(outcome.status).toBe('rejected');
        expect((outcome as PromiseRejectedResult).reason).toBeInstanceOf(PasswordHasherBusyError);
      }
      expect(
        (await accepted).map((outcome) => outcome.status === 'fulfilled' && outcome.value),
      ).toEqual(Array(max + maxQueue).fill(true));
      // The refused calls never reached scrypt, and the queue drained in order.
      expect(kdf.calls).toEqual(Array(max + maxQueue).fill(CHEAP));
      expect(kdf.peak).toBe(max);
      expect(await verifyPassword(PASSWORD, stored)).toBe(true);
    },
    SLOW,
  );
});

describe('generateTemporaryPassword', () => {
  it('always meets the password policy and avoids ambiguous characters', () => {
    const samples = Array.from({ length: 50 }, () => generateTemporaryPassword());
    for (const password of samples) {
      expect(validatePasswordStrength(password), password).toBeNull();
      expect(password).toMatch(/^Bf[A-HJ-NP-Za-km-np-z2-9]{20}7$/);
    }
    expect(new Set(samples).size).toBe(samples.length);
  });
});

describe('validatePasswordStrength', () => {
  it('enforces the length limits', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(validatePasswordStrength('Kort1')).toContain(`${PASSWORD_MIN_LENGTH}`);
    expect(validatePasswordStrength(`Aa1${'x'.repeat(PASSWORD_MAX_LENGTH)}`)).toContain(
      `${PASSWORD_MAX_LENGTH}`,
    );
  });

  it('requires a lowercase letter, an uppercase letter and a digit', () => {
    expect(validatePasswordStrength('alleenkleineletters1')).toMatch(/hoofdletter/);
    expect(validatePasswordStrength('ALLEENHOOFDLETTERS1')).toMatch(/kleine letter/);
    expect(validatePasswordStrength('GeenCijfersHierIn')).toMatch(/cijfer/);
    expect(validatePasswordStrength('GoedWachtwoord12')).toBeNull();
  });
});
