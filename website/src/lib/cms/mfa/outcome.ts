import 'server-only';
import { eq } from 'drizzle-orm';
import type { CmsDatabase } from '@/db/cms';
import { cmsUsers, type CmsUserPublic } from '@/db/cms-schema';
import { env, isProduction } from '@/lib/env';
import { recordAudit } from '../auth';
import {
  createSession,
  setSessionCookie,
  type CreateSessionOptions,
  type SessionContext,
} from '../session';
import {
  clearChallengeCookie,
  releaseChallengeAttempt,
  reserveChallengeAttempt,
  settleChallengeFailure,
} from './challenge';
import { qrSvgPath } from './qr';
import { releaseMfaAttempt, reserveMfaAttempt, type MfaReservation } from './rate-limit';
import { startEnrolment, type CodeFailure } from './repo';

/**
 * Shared pieces of the MFA flows in `./flow.ts` (sign-in challenge) and
 * `./manage.ts` (signed-in management, break-glass): result type, Dutch
 * messages, enrolment display, attempt reservation and failure bookkeeping,
 * session issuance.
 */

export type MfaError =
  | 'expired'
  | 'rate_limited'
  | 'invalid_code'
  | 'replayed'
  | 'unreadable'
  | 'reauth_failed'
  | 'invalid_password'
  | 'weak_password'
  | 'not_configured'
  | 'not_allowed'
  | 'not_found';

export type MfaResult<T> = { ok: true; data: T } | { ok: false; error: MfaError; message: string };

const MESSAGES: Record<MfaError, string> = {
  expired: 'Je aanmelding is verlopen. Meld je opnieuw aan.',
  rate_limited: 'Te veel foute pogingen. Probeer het over 15 minuten opnieuw.',
  invalid_code: 'Die code klopt niet. Controleer of de tijd op je toestel juist staat.',
  replayed: 'Deze code is al gebruikt. Wacht op de volgende code van je app.',
  unreadable: 'Je authenticator kan niet gecontroleerd worden. Gebruik een herstelcode.',
  reauth_failed: 'Je wachtwoord of je code klopt niet.',
  invalid_password: 'Het huidige wachtwoord is onjuist.',
  weak_password: 'Dit wachtwoord voldoet niet aan de eisen.',
  not_configured:
    'Tweestapsverificatie is op deze server nog niet geconfigureerd. Neem contact op met de beheerder.',
  not_allowed: 'Deze stap is nu niet mogelijk.',
  not_found: 'Gebruiker niet gevonden.',
};

export function fail(error: MfaError, message = MESSAGES[error]) {
  return { ok: false as const, error, message };
}

export function ok<T>(data: T) {
  return { ok: true as const, data };
}

export function codeError(reason: CodeFailure): MfaError {
  if (reason === 'replayed') return 'replayed';
  if (reason === 'unreadable') return 'unreadable';
  return 'invalid_code';
}

export function ipOf(context: SessionContext): string {
  return context.ipAddress ?? 'unknown';
}

/** Name in the authenticator app; non-production deployments are marked so the entries stay apart. */
export function mfaIssuer(): string {
  if (env.VERCEL_ENV === 'production') return 'De Bikefit Studio';
  return isProduction() ? 'De Bikefit Studio (test)' : 'De Bikefit Studio (lokaal)';
}

/** What the enrolment screen shows once. */
export type EnrolmentDisplay = {
  otpauthUri: string;
  manualKey: string;
  qrSize: number;
  qrPath: string;
};

export async function beginEnrolment(
  db: CmsDatabase,
  user: Pick<CmsUserPublic, 'id' | 'email'>,
  pendingContext: string,
): Promise<EnrolmentDisplay> {
  const started = await startEnrolment(db, user, pendingContext, mfaIssuer());
  const qr = qrSvgPath(started.otpauthUri);
  return { ...started, qrSize: qr.size, qrPath: qr.path };
}

/** What a code check holds while it runs: its rate-limit hits and, at sign-in, a challenge slot. */
export type HeldAttempt = {
  reservation: MfaReservation;
  challenge?: { id: string; slot: number };
};

/**
 * Reserves everything a code check counts against, BEFORE the code is looked
 * at: the user + IP, IP and daily hits (`./rate-limit.ts`), then, at sign-in,
 * one slot on the challenge. Nothing is held when it fails: `rate_limited`
 * when a limit is reached, `expired` when the challenge is gone or used up.
 */
export async function holdAttempt(
  db: CmsDatabase,
  userId: string,
  context: SessionContext,
  challengeId?: string,
): Promise<{ ok: true; held: HeldAttempt } | { ok: false; error: 'rate_limited' | 'expired' }> {
  const reserved = await reserveMfaAttempt(db, userId, ipOf(context));
  if (!reserved.ok) return { ok: false, error: 'rate_limited' };
  if (challengeId === undefined) return { ok: true, held: { reservation: reserved.reservation } };
  const slot = await reserveChallengeAttempt(db, challengeId);
  if (slot === null) {
    await releaseMfaAttempt(db, reserved.reservation);
    return { ok: false, error: 'expired' };
  }
  return {
    ok: true,
    held: { reservation: reserved.reservation, challenge: { id: challengeId, slot } },
  };
}

/** Gives everything back: the check succeeded, or its result said nothing about the code. */
export async function releaseAttempt(db: CmsDatabase, held: HeldAttempt): Promise<void> {
  await releaseMfaAttempt(db, held.reservation);
  if (held.challenge) await releaseChallengeAttempt(db, held.challenge.id);
}

/**
 * Settles a failed second step: a guess keeps the hits and the challenge
 * slot it reserved (the last slot deletes the challenge), and every failure
 * is audited. Returns the error to show.
 */
export async function failedCode(
  db: CmsDatabase,
  user: Pick<CmsUserPublic, 'id' | 'email'>,
  stage: string,
  reason: CodeFailure,
  held: HeldAttempt,
) {
  // An unreadable factor (key rotated or lost) is our fault, not a guess: it
  // must not use up the attempts the user needs for a recovery code.
  let stillUsable = true;
  if (reason === 'unreadable') await releaseAttempt(db, held);
  else if (held.challenge) {
    stillUsable = await settleChallengeFailure(db, held.challenge.id, held.challenge.slot);
  }
  await recordAudit(db, user, {
    action: 'auth.mfa_failed',
    entityType: 'cms_user',
    entityId: user.id,
    metadata: { stage, reason },
  });
  return stillUsable ? fail(codeError(reason)) : fail('expired');
}

/**
 * The session after a completed second step: MFA-verified. A sign-in (no
 * `replaces`) opens the step-up window; a session that replaces another
 * inherits that one's absolute end and step-up time instead, so replacing a
 * session never extends either.
 */
export async function issueMfaSession(
  db: CmsDatabase,
  userId: string,
  context: SessionContext,
  replaces?: CreateSessionOptions['replaces'],
) {
  const session = await createSession(db, userId, context, {
    mfaVerified: true,
    reauthenticated: !replaces,
    replaces,
  });
  await setSessionCookie(session.token, session.cookieExpiresAt);
  await clearChallengeCookie();
  await db.update(cmsUsers).set({ lastLoginAt: new Date() }).where(eq(cmsUsers.id, userId));
}
