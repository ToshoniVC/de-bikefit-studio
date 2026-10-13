import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) on top of HOTP (RFC 4226), pure and dependency-free so the
 * whole module is unit-tested (`totp.test.ts`, including the RFC test
 * vectors). The profile is the one every authenticator understands, including
 * 1Password and free apps such as Aegis, Ente Auth or Google Authenticator:
 * HMAC-SHA1, 6 digits, 30-second steps, a 160-bit secret.
 *
 * Clock tolerance is one step either side ({@link TOTP_WINDOW}), so a code is
 * accepted for at most 90 seconds. A code is only accepted for a step later
 * than the last one used ({@link verifyTotp} `lastUsedStep`), which rejects a
 * replayed code and any code for an earlier step.
 */

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Steps accepted before and after the current one. */
export const TOTP_WINDOW = 1;
/** RFC 4226 §4 recommends 160 bits. */
export const TOTP_SECRET_BYTES = 20;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 without padding, as `otpauth://` URIs expect. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Inverse of {@link base32Encode}; ignores case, spaces and `=` padding. `null` on any other character. */
export function base32Decode(input: string): Buffer | null {
  const clean = input.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): Buffer {
  return randomBytes(TOTP_SECRET_BYTES);
}

export type HmacAlgorithm = 'sha1' | 'sha256' | 'sha512';

/** RFC 4226 HOTP with dynamic truncation. `digits` and `algorithm` exist for the RFC test vectors. */
export function hotp(
  secret: Uint8Array,
  counter: number,
  digits: number = TOTP_DIGITS,
  algorithm: HmacAlgorithm = 'sha1',
): string {
  if (!Number.isSafeInteger(counter) || counter < 0) throw new Error('hotp: invalid counter');
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(algorithm, secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** The RFC 6238 time step `T` for a Unix time in milliseconds. */
export function totpStep(nowMs: number, periodSeconds: number = TOTP_PERIOD_SECONDS): number {
  return Math.floor(nowMs / 1000 / periodSeconds);
}

/** The code for `nowMs`; used by tests and the self-test, never sent anywhere. */
export function totpAt(secret: Uint8Array, nowMs: number): string {
  return hotp(secret, totpStep(nowMs));
}

/** Six digits after removing spaces (authenticators show `123 456`), else `null`. */
export function normalizeTotpCode(input: string): string | null {
  const clean = input.replace(/\s/g, '');
  return new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(clean) ? clean : null;
}

export type TotpVerification =
  { ok: true; step: number } | { ok: false; reason: 'malformed' | 'invalid' | 'replayed' };

/**
 * Checks `code` against the steps `current ± window`. Every candidate is
 * compared (constant time, no early exit) so timing does not reveal which
 * step matched. A match for a step `<= lastUsedStep` is `replayed`: the
 * caller stores the returned `step` atomically as the new `lastUsedStep`
 * (`src/lib/cms/mfa/repo.ts`), so each step can be used once.
 */
export function verifyTotp(input: {
  secret: Uint8Array;
  code: string;
  nowMs: number;
  lastUsedStep: number | null;
  window?: number;
}): TotpVerification {
  const code = normalizeTotpCode(input.code);
  if (!code) return { ok: false, reason: 'malformed' };

  const window = input.window ?? TOTP_WINDOW;
  const current = totpStep(input.nowMs);
  const given = Buffer.from(code);
  let matched: number | null = null;
  for (let step = current - window; step <= current + window; step += 1) {
    if (step < 0) continue;
    const expected = Buffer.from(hotp(input.secret, step));
    if (timingSafeEqual(expected, given) && matched === null) matched = step;
  }

  if (matched === null) return { ok: false, reason: 'invalid' };
  if (input.lastUsedStep !== null && matched <= input.lastUsedStep) {
    return { ok: false, reason: 'replayed' };
  }
  return { ok: true, step: matched };
}

/**
 * `otpauth://totp/…` (Key Uri Format) for the QR code and for apps that
 * accept a pasted link. It contains the secret: it is shown once during
 * enrolment, never logged, never put in a URL the browser navigates to.
 */
export function buildOtpauthUri(input: {
  secret: Uint8Array;
  issuer: string;
  accountName: string;
}): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.accountName)}`;
  // encodeURIComponent, not URLSearchParams: some apps show a `+` for a space.
  const query = [
    ['secret', base32Encode(input.secret)],
    ['issuer', input.issuer],
    ['algorithm', 'SHA1'],
    ['digits', String(TOTP_DIGITS)],
    ['period', String(TOTP_PERIOD_SECONDS)],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return `otpauth://totp/${label}?${query}`;
}

/** The secret as it is typed by hand: base32 in groups of four. */
export function formatSecretForDisplay(secret: Uint8Array): string {
  return base32Encode(secret)
    .replace(/(.{4})/g, '$1 ')
    .trim();
}
