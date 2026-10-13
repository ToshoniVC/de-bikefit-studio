import { and, desc, eq, gte, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';
import type { CmsDatabase } from '@/db/cms';
import { cmsMfaFactors, cmsMfaRecoveryCodes } from '@/db/cms-mfa-schema';
import { openTotpSecret, sealTotpSecret } from './crypto';
import { generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from './recovery-codes';
import {
  buildOtpauthUri,
  formatSecretForDisplay,
  generateTotpSecret,
  normalizeTotpCode,
  verifyTotp,
} from './totp';

/**
 * Database half of CMS two-step verification: factors and recovery codes.
 * Every function takes an explicit `db` and does no access control of its
 * own — callers are `./flow.ts` (which decides who may do what) and the
 * break-glass CLI. Not `server-only`, like `../session.ts`, so plain Node
 * scripts can load it. The rate limits every code check is reserved against
 * before it calls in here live in `./rate-limit.ts`.
 *
 * Written for neon-http, which has no interactive transactions: every
 * state change that must happen once is a single conditional statement
 * (`UPDATE … WHERE last_used_step < $step RETURNING`, `UPDATE … WHERE used_at
 * IS NULL RETURNING`), and multi-step changes are ordered so that a crash in
 * between leaves the account no less protected (see `confirmEnrolment`).
 */

/** An enrolment that is not confirmed within this time must be started again. */
export const MFA_ENROLMENT_TTL_MS = 10 * 60 * 1000;

// --- Factors -----------------------------------------------------------------------

/** The user's live authenticator: the newest confirmed row. */
export async function getConfirmedFactor(db: CmsDatabase, userId: string) {
  const [factor] = await db
    .select()
    .from(cmsMfaFactors)
    .where(and(eq(cmsMfaFactors.userId, userId), isNotNull(cmsMfaFactors.confirmedAt)))
    .orderBy(desc(cmsMfaFactors.confirmedAt))
    .limit(1);
  return factor ?? null;
}

export async function hasConfirmedFactor(db: CmsDatabase, userId: string): Promise<boolean> {
  return (await getConfirmedFactor(db, userId)) !== null;
}

export type MfaStatus = {
  enrolled: boolean;
  confirmedAt: Date | null;
  lastUsedAt: Date | null;
  recoveryCodesLeft: number;
};

export async function getMfaStatus(db: CmsDatabase, userId: string): Promise<MfaStatus> {
  const factor = await getConfirmedFactor(db, userId);
  return {
    enrolled: factor !== null,
    confirmedAt: factor?.confirmedAt ?? null,
    lastUsedAt: factor?.lastUsedAt ?? null,
    recoveryCodesLeft: await countRecoveryCodesLeft(db, userId),
  };
}

/** User ids with a confirmed factor, for the user list. */
export async function listEnrolledUserIds(db: CmsDatabase): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ userId: cmsMfaFactors.userId })
    .from(cmsMfaFactors)
    .where(isNotNull(cmsMfaFactors.confirmedAt));
  return new Set(rows.map((row) => row.userId));
}

export type StartedEnrolment = {
  /** `otpauth://` URI for the QR code. Contains the secret: display once, never log. */
  otpauthUri: string;
  /** The secret in groups of four, for typing it in by hand. */
  manualKey: string;
};

/**
 * Creates a pending factor bound to `pendingContext` (`challenge:<id>` or
 * `session:<id>`) and returns what the user scans. Replaces any earlier
 * pending enrolment of this user; a confirmed factor stays live until the new
 * one is confirmed.
 */
export async function startEnrolment(
  db: CmsDatabase,
  user: { id: string; email: string },
  pendingContext: string,
  issuer: string,
): Promise<StartedEnrolment> {
  const secret = generateTotpSecret();
  const secretEnc = sealTotpSecret(user.id, secret);
  await db
    .delete(cmsMfaFactors)
    .where(and(eq(cmsMfaFactors.userId, user.id), isNull(cmsMfaFactors.confirmedAt)));
  // Data minimisation: abandoned enrolments of anyone are useless after the TTL.
  await db
    .delete(cmsMfaFactors)
    .where(
      and(
        isNull(cmsMfaFactors.confirmedAt),
        lt(cmsMfaFactors.createdAt, new Date(Date.now() - MFA_ENROLMENT_TTL_MS)),
      ),
    );
  await db.insert(cmsMfaFactors).values({ userId: user.id, secretEnc, pendingContext });
  return {
    otpauthUri: buildOtpauthUri({ secret, issuer, accountName: user.email }),
    manualKey: formatSecretForDisplay(secret),
  };
}

export type CodeFailure = 'malformed' | 'invalid' | 'replayed' | 'no_factor' | 'unreadable';

export type ConfirmedEnrolment =
  { ok: true; recoveryCodes: string[] } | { ok: false; reason: CodeFailure | 'no_enrolment' };

/**
 * Confirms the pending enrolment of `pendingContext` with a first code. On
 * success: the factor is live (its step recorded, so the same code cannot be
 * replayed at sign-in), every other factor of the user is deleted, and a
 * fresh set of recovery codes replaces the old one and is returned — the only
 * time those codes exist in plain text. Session revocation is the caller's.
 *
 * Order matters without transactions: the new factor is confirmed before the
 * old one is deleted, so a crash in between leaves two factors (the newest
 * wins), never none.
 */
export async function confirmEnrolment(
  db: CmsDatabase,
  userId: string,
  pendingContext: string,
  code: string,
  nowMs: number = Date.now(),
): Promise<ConfirmedEnrolment> {
  const [pending] = await db
    .select()
    .from(cmsMfaFactors)
    .where(
      and(
        eq(cmsMfaFactors.userId, userId),
        isNull(cmsMfaFactors.confirmedAt),
        eq(cmsMfaFactors.pendingContext, pendingContext),
        gte(cmsMfaFactors.createdAt, new Date(nowMs - MFA_ENROLMENT_TTL_MS)),
      ),
    )
    .orderBy(desc(cmsMfaFactors.createdAt))
    .limit(1);
  if (!pending) return { ok: false, reason: 'no_enrolment' };

  const secret = openTotpSecret(userId, pending.secretEnc);
  if (!secret) return { ok: false, reason: 'unreadable' };
  const result = verifyTotp({ secret, code, nowMs, lastUsedStep: null });
  if (!result.ok) return { ok: false, reason: result.reason };

  const now = new Date(nowMs);
  const confirmed = await db
    .update(cmsMfaFactors)
    .set({ confirmedAt: now, pendingContext: null, lastUsedStep: result.step, lastUsedAt: now })
    .where(and(eq(cmsMfaFactors.id, pending.id), isNull(cmsMfaFactors.confirmedAt)))
    .returning({ id: cmsMfaFactors.id });
  if (confirmed.length !== 1) return { ok: false, reason: 'no_enrolment' };

  await db
    .delete(cmsMfaFactors)
    .where(and(eq(cmsMfaFactors.userId, userId), ne(cmsMfaFactors.id, pending.id)));
  const recoveryCodes = await replaceRecoveryCodes(db, userId);
  return { ok: true, recoveryCodes };
}

/**
 * Verifies a TOTP code against the live factor and records its step with a
 * conditional UPDATE: of two requests carrying the same code, exactly one
 * wins; the other gets `replayed`.
 */
export async function verifyTotpFactor(
  db: CmsDatabase,
  userId: string,
  code: string,
  nowMs: number = Date.now(),
): Promise<{ ok: true } | { ok: false; reason: CodeFailure }> {
  const factor = await getConfirmedFactor(db, userId);
  if (!factor) return { ok: false, reason: 'no_factor' };
  const secret = openTotpSecret(userId, factor.secretEnc);
  if (!secret) {
    console.error('[cms-mfa] stored factor cannot be decrypted (key changed or data corrupt)');
    return { ok: false, reason: 'unreadable' };
  }
  const result = verifyTotp({ secret, code, nowMs, lastUsedStep: factor.lastUsedStep });
  if (!result.ok) return { ok: false, reason: result.reason };

  const claimed = await db
    .update(cmsMfaFactors)
    .set({ lastUsedStep: result.step, lastUsedAt: new Date(nowMs) })
    .where(
      and(
        eq(cmsMfaFactors.id, factor.id),
        sql`(${cmsMfaFactors.lastUsedStep} IS NULL OR ${cmsMfaFactors.lastUsedStep} < ${result.step})`,
      ),
    )
    .returning({ id: cmsMfaFactors.id });
  return claimed.length === 1 ? { ok: true } : { ok: false, reason: 'replayed' };
}

// --- Recovery codes ----------------------------------------------------------------

export async function countRecoveryCodesLeft(db: CmsDatabase, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(cmsMfaRecoveryCodes)
    .where(and(eq(cmsMfaRecoveryCodes.userId, userId), isNull(cmsMfaRecoveryCodes.usedAt)));
  return Number(row?.count ?? 0);
}

/** Deletes every code of the user and stores the hashes of a fresh set, returned once. */
export async function replaceRecoveryCodes(db: CmsDatabase, userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await db.delete(cmsMfaRecoveryCodes).where(eq(cmsMfaRecoveryCodes.userId, userId));
  await db.insert(cmsMfaRecoveryCodes).values(
    codes.map((code) => ({
      userId,
      codeHash: hashRecoveryCode(userId, normalizeRecoveryCode(code)!),
    })),
  );
  return codes;
}

/** Marks a matching unused code as used, atomically. Only a user with a live factor has usable codes. */
export async function consumeRecoveryCode(
  db: CmsDatabase,
  userId: string,
  input: string,
): Promise<{ ok: true; remaining: number } | { ok: false; reason: CodeFailure }> {
  const normalized = normalizeRecoveryCode(input);
  if (!normalized) return { ok: false, reason: 'malformed' };
  if (!(await hasConfirmedFactor(db, userId))) return { ok: false, reason: 'no_factor' };

  const used = await db
    .update(cmsMfaRecoveryCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(cmsMfaRecoveryCodes.userId, userId),
        eq(cmsMfaRecoveryCodes.codeHash, hashRecoveryCode(userId, normalized)),
        isNull(cmsMfaRecoveryCodes.usedAt),
      ),
    )
    .returning({ id: cmsMfaRecoveryCodes.id });
  if (used.length !== 1) return { ok: false, reason: 'invalid' };
  return { ok: true, remaining: await countRecoveryCodesLeft(db, userId) };
}

// --- Either kind of code -------------------------------------------------------------

export type SecondFactorResult =
  | { ok: true; method: 'totp' | 'recovery'; recoveryCodesLeft?: number }
  | { ok: false; reason: CodeFailure };

/** Six digits → TOTP; otherwise a recovery code. One form field takes both. */
export async function verifySecondFactor(
  db: CmsDatabase,
  userId: string,
  code: string,
  nowMs: number = Date.now(),
): Promise<SecondFactorResult> {
  if (normalizeTotpCode(code)) {
    const result = await verifyTotpFactor(db, userId, code, nowMs);
    return result.ok ? { ok: true, method: 'totp' } : result;
  }
  const result = await consumeRecoveryCode(db, userId, code);
  return result.ok ? { ok: true, method: 'recovery', recoveryCodesLeft: result.remaining } : result;
}

/** Deletes every factor (live or pending) and every recovery code of the user. */
export async function removeAllFactors(db: CmsDatabase, userId: string): Promise<void> {
  await db.delete(cmsMfaFactors).where(eq(cmsMfaFactors.userId, userId));
  await db.delete(cmsMfaRecoveryCodes).where(eq(cmsMfaRecoveryCodes.userId, userId));
}
