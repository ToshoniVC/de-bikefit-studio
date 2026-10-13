'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  challengeChangePassword,
  challengeConfirmEnrolment,
  challengeStartEnrolment,
  challengeVerify,
  abandonMfaChallenge,
} from '@/lib/cms/mfa/flow';
import {
  adminResetUserMfa,
  confirmFactorReplacement,
  regenerateRecoveryCodes,
  removeOwnFactor,
  startFactorReplacement,
} from '@/lib/cms/mfa/manage';
import type { EnrolmentDisplay } from '@/lib/cms/mfa/outcome';
import { requestContext, safeAdminPath } from './request';
import { runAction } from './run';
import { actionError, actionOk, field, type ActionState } from './state';

/**
 * Server actions for two-step verification. Each one is a thin shell: all
 * access rules live in `src/lib/cms/mfa/flow.ts` (challenge steps, which need
 * the `cms_mfa` cookie) and `manage.ts` (signed-in, with re-authentication),
 * so a direct POST gets exactly the same checks as the form. Next's
 * Origin/Host check covers cross-site posts.
 *
 * The enrolment secret and the recovery codes travel to the browser once, in
 * `payload` of the response. They never go into a URL, a log line or the
 * database in plain text.
 */

function enrolmentPayload(display: EnrolmentDisplay): Record<string, string> {
  return {
    otpauthUri: display.otpauthUri,
    manualKey: display.manualKey,
    qrSize: String(display.qrSize),
    qrPath: display.qrPath,
  };
}

function codesPayload(codes: string[]): Record<string, string> {
  return { recoveryCodes: codes.join('\n') };
}

/** One field takes a six-digit code or a recovery code. */
function codeField(form: FormData): string {
  return String(form.get('code') ?? '').slice(0, 64);
}

function reauthFields(form: FormData) {
  return { password: String(form.get('password') ?? ''), code: codeField(form) };
}

// --- Sign-in challenge (/admin/mfa) -----------------------------------------

export async function mfaChangePasswordAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const currentPassword = String(form.get('currentPassword') ?? '');
    const newPassword = String(form.get('newPassword') ?? '');
    const repeatPassword = String(form.get('repeatPassword') ?? '');
    const next = safeAdminPath(field(form, 'next'));

    if (!currentPassword || !newPassword) return actionError('Vul alle velden in.');
    if (newPassword !== repeatPassword) {
      return actionError('De twee nieuwe wachtwoorden zijn niet gelijk.');
    }
    if (newPassword === currentPassword) {
      return actionError('Kies een ander wachtwoord dan het huidige.');
    }

    const result = await challengeChangePassword({ currentPassword, newPassword });
    if (!result.ok) return actionError(result.message);
    redirect(`/admin/mfa?next=${encodeURIComponent(next)}`);
  });
}

export async function mfaStartEnrolmentAction(): Promise<ActionState> {
  return runAction(async () => {
    const result = await challengeStartEnrolment();
    if (!result.ok) return actionError(result.message);
    return actionOk('Scan de QR-code met je authenticator-app.', enrolmentPayload(result.data));
  });
}

export async function mfaConfirmEnrolmentAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const code = codeField(form);
    if (!code.trim()) return actionError('Vul de code uit je app in.');
    const result = await challengeConfirmEnrolment(code, await requestContext());
    if (!result.ok) return actionError(result.message);
    return actionOk(
      'Tweestapsverificatie is ingesteld. Bewaar je herstelcodes nu.',
      codesPayload(result.data.recoveryCodes),
    );
  });
}

export async function mfaVerifyAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const code = codeField(form);
    const next = safeAdminPath(field(form, 'next'));
    if (!code.trim()) return actionError('Vul de code uit je app of een herstelcode in.');
    const result = await challengeVerify(code, await requestContext());
    if (!result.ok) return actionError(result.message);
    // A recovery code was spent: show what is left and how to make new ones.
    redirect(result.data.method === 'recovery' ? '/admin/account?herstelcode=gebruikt' : next);
  });
}

export async function mfaCancelAction(): Promise<void> {
  await abandonMfaChallenge();
  redirect('/admin/login');
}

// --- Signed in (/admin/account) ---------------------------------------------

export async function mfaStartReplacementAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const result = await startFactorReplacement(reauthFields(form), await requestContext());
    if (!result.ok) return actionError(result.message);
    return actionOk(
      'Scan de QR-code met je nieuwe authenticator. Je huidige blijft werken tot je bevestigt.',
      enrolmentPayload(result.data),
    );
  });
}

export async function mfaConfirmReplacementAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const code = codeField(form);
    if (!code.trim()) return actionError('Vul de code uit je nieuwe app in.');
    const result = await confirmFactorReplacement(code, await requestContext());
    if (!result.ok) return actionError(result.message);
    return actionOk(
      'Je nieuwe authenticator is actief. Alle andere sessies zijn afgemeld. Bewaar je nieuwe herstelcodes.',
      codesPayload(result.data.recoveryCodes),
    );
  });
}

export async function mfaRegenerateRecoveryCodesAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const result = await regenerateRecoveryCodes(reauthFields(form), await requestContext());
    if (!result.ok) return actionError(result.message);
    revalidatePath('/admin/account');
    return actionOk(
      'Nieuwe herstelcodes aangemaakt; de oude werken niet meer. Andere sessies zijn afgemeld.',
      codesPayload(result.data.recoveryCodes),
    );
  });
}

export async function mfaRemoveOwnFactorAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const result = await removeOwnFactor(reauthFields(form), await requestContext());
    if (!result.ok) return actionError(result.message);
    revalidatePath('/admin/account');
    return actionOk('Tweestapsverificatie is uitgeschakeld. Andere sessies zijn afgemeld.');
  });
}

// --- Break-glass (/admin/users) ---------------------------------------------

export async function adminResetUserMfaAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const userId = field(form, 'userId');
    if (!userId) return actionError('Kies een gebruiker.');
    const result = await adminResetUserMfa(userId, reauthFields(form), await requestContext());
    if (!result.ok) return actionError(result.message);
    revalidatePath('/admin/users');
    return actionOk(
      `Tweestapsverificatie van ${result.data.email} is gereset en alle sessies zijn afgemeld. Geef dit tijdelijke wachtwoord één keer door; bij de volgende aanmelding stelt de gebruiker een nieuwe authenticator in.`,
      { temporaryPassword: result.data.temporaryPassword },
    );
  });
}
