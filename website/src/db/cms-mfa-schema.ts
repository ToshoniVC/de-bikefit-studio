/**
 * CMS two-step verification (TOTP) tables, created by
 * `drizzle/0004_cms_admin_mfa.sql`. Kept apart from `./cms-schema.ts`, which is
 * already past the file-size limit; the same `cms_` prefix and conventions
 * apply, and `drizzle.config.ts` lists both files. Architecture:
 * docs/cms-architecture.md §4 (MFA).
 *
 * Nothing secret is stored in the clear: TOTP secrets are AES-256-GCM sealed
 * (`src/lib/cms/mfa/crypto.ts`), recovery codes and challenge tokens are
 * hashed.
 */
import { pgTable, text, integer, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { cmsUsers } from './cms-schema';

// Same column helpers as `./cms-schema.ts` (not exported there).
const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const userId = () =>
  text('user_id')
    .notNull()
    .references(() => cmsUsers.id, { onDelete: 'cascade' });

/**
 * One row per TOTP authenticator. `confirmed_at` null = an enrolment in
 * progress, bound by `pending_context` to the sign-in challenge or session that
 * started it and usable only for a few minutes. The newest confirmed row is the
 * user's factor; confirming a new one deletes the others, so at most one is
 * live once the confirmation completes.
 *
 * `last_used_step` is the RFC 6238 time step of the last accepted code. It only
 * ever moves forward (a conditional UPDATE), which is what rejects a replayed
 * code.
 */
export const cmsMfaFactors = pgTable(
  'cms_mfa_factors',
  {
    id: id(),
    userId: userId(),
    kind: text('kind').$type<'totp'>().default('totp').notNull(),
    /** `v1.<iv>.<tag>.<ciphertext>`, AAD = the user id. Never sent to the browser after enrolment. */
    secretEnc: text('secret_enc').notNull(),
    pendingContext: text('pending_context'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    lastUsedStep: integer('last_used_step'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('cms_mfa_factors_user_id_idx').on(t.userId)],
);

/** Hashes of one-use recovery codes (`src/lib/cms/mfa/recovery-codes.ts`). */
export const cmsMfaRecoveryCodes = pgTable(
  'cms_mfa_recovery_codes',
  {
    id: id(),
    userId: userId(),
    codeHash: text('code_hash').notNull().unique(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('cms_mfa_recovery_codes_user_id_idx').on(t.userId)],
);

/**
 * The short-lived state between a correct password and a completed second
 * step. It is NOT a session: no guard reads it, it grants no CMS access, and
 * the browser holds its token in the separate `cms_mfa` cookie. The database
 * stores only the token's HMAC, like `cms_sessions`.
 */
export const cmsMfaChallenges = pgTable(
  'cms_mfa_challenges',
  {
    id: id(),
    userId: userId(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    failedAttempts: integer('failed_attempts').default(0).notNull(),
    createdAt: createdAt(),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
  },
  (t) => [
    index('cms_mfa_challenges_user_id_idx').on(t.userId),
    index('cms_mfa_challenges_expires_at_idx').on(t.expiresAt),
  ],
);

/**
 * Second-step attempts (codes at sign-in and re-authentication), for rate
 * limiting per user and per IP. Pruned after a day, like `cms_login_attempts`.
 */
export const cmsMfaAttempts = pgTable(
  'cms_mfa_attempts',
  {
    id: id(),
    userId: userId(),
    ipAddress: text('ip_address').default('unknown').notNull(),
    successful: boolean('successful').default(false).notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('cms_mfa_attempts_user_time_idx').on(t.userId, t.attemptedAt),
    index('cms_mfa_attempts_ip_time_idx').on(t.ipAddress, t.attemptedAt),
  ],
);

export type CmsMfaFactor = typeof cmsMfaFactors.$inferSelect;
