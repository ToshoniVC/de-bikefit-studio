import 'server-only';
import { eq } from 'drizzle-orm';
import type { CmsDatabase } from '@/db/cms';
import { cmsUsers, type CmsUserPublic } from '@/db/cms-schema';
import { env, isProduction } from '@/lib/env';
import { recordAudit } from '../auth';
import { createSession, setSessionCookie, type SessionContext } from '../session';
import { clearChallengeCookie, recordChallengeFailure } from './challenge';
import { qrSvgPath } from './qr';
import { recordMfaAttempt, startEnrolment, type CodeFailure } from './repo';

/**
 * Shared pieces of the MFA flows in `./flow.ts` (sign-in challenge) and
 * `./manage.ts` (signed-in management, break-glass): result type, Dutch
 * messages, enrolment display, failure bookkeeping, session issuance.
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

/** Records a failed second step everywhere it counts. Returns the error to show. */
export async function failedCode(
  db: CmsDatabase,
  user: Pick<CmsUserPublic, 'id' | 'email'>,
  context: SessionContext,
  stage: string,
  reason: CodeFailure,
  challengeId?: string,
) {
  // An unreadable factor (key rotated or lost) is our fault, not a guess: it
  // must not use up the attempts the user needs for a recovery code.
  const counts = reason !== 'unreadable';
  if (counts) await recordMfaAttempt(db, user.id, ipOf(context), false);
  const stillUsable = challengeId && counts ? await recordChallengeFailure(db, challengeId) : true;
  await recordAudit(db, user, {
    action: 'auth.mfa_failed',
    entityType: 'cms_user',
    entityId: user.id,
    metadata: { stage, reason },
  });
  return stillUsable ? fail(codeError(reason)) : fail('expired');
}

export async function issueMfaSession(db: CmsDatabase, userId: string, context: SessionContext) {
  const session = await createSession(db, userId, context, { mfaVerified: true });
  await setSessionCookie(session.token, session.expiresAt);
  await clearChallengeCookie();
  await db.update(cmsUsers).set({ lastLoginAt: new Date() }).where(eq(cmsUsers.id, userId));
}
