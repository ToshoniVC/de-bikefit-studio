'use server';

import { refresh, revalidatePath } from 'next/cache';
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
import { fail, type EnrolmentDisplay } from '@/lib/cms/mfa/outcome';
import { confirmIdentity } from '@/lib/cms/mfa/reauth';
import {
  challengePasswordForm,
  mfaCodeForm,
  parseForm,
  reauthForm,
  resetUserMfaForm,
} from './mfa-input';
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
 * Every field is shape-checked first (`./mfa-input.ts`): an oversized or
 * non-text value gets the form's usual message, with no database work and no
 * attempt counted.
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

/** The usual answer to a code that does not fit: the same as for a wrong one. */
const INVALID_CODE = fail('invalid_code').message;
/** One generic answer for a password or code that does not fit, as for a wrong one. */
const INVALID_REAUTH = fail('reauth_failed').message;

// --- Sign-in challenge (/admin/mfa) -----------------------------------------

export async function mfaChangePasswordAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const input = parseForm(challengePasswordForm, form);
    if (!input.ok) {
      return actionError(
        fail(input.field === 'currentPassword' ? 'invalid_password' : 'weak_password').message,
      );
    }
    const { currentPassword, newPassword, repeatPassword } = input.data;
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
    const input = parseForm(mfaCodeForm, form);
    if (!input.ok) return actionError(INVALID_CODE);
    if (!input.data.code) return actionError('Vul de code uit je app in.');
    const result = await challengeConfirmEnrolment(input.data.code, await requestContext());
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
    const input = parseForm(mfaCodeForm, form);
    const next = safeAdminPath(field(form, 'next'));
    if (!input.ok) return actionError(INVALID_CODE);
    if (!input.data.code) return actionError('Vul de code uit je app of een herstelcode in.');
    const result = await challengeVerify(input.data.code, await requestContext());
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

/**
 * "Bevestig je identiteit" (step-up) on `/admin/users`, `/admin/providers`,
 * `/admin/email`, `/admin/account` and `/admin/password`. The window is
 * recorded on the session; the sensitive changes check it themselves
 * (`recentReauthentication` in the guard).
 */
export async function confirmIdentityAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const input = parseForm(reauthForm, form);
    if (!input.ok) return actionError(INVALID_REAUTH);
    const result = await confirmIdentity(input.data, await requestContext());
    if (!result.ok) return actionError(result.message);
    refresh();
    const until = result.data.until.toLocaleTimeString('nl-BE', {
      timeZone: 'Europe/Brussels',
      hour: '2-digit',
      minute: '2-digit',
    });
    return actionOk(`Identiteit bevestigd. Je kan tot ${until} gevoelige wijzigingen doen.`);
  });
}

export async function mfaStartReplacementAction(
  _prevState: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const input = parseForm(reauthForm, form);
    if (!input.ok) return actionError(INVALID_REAUTH);
    const result = await startFactorReplacement(input.data, await requestContext());
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
    const input = parseForm(mfaCodeForm, form);
    if (!input.ok) return actionError(INVALID_CODE);
    if (!input.data.code) return actionError('Vul de code uit je nieuwe app in.');
    const result = await confirmFactorReplacement(input.data.code, await requestContext());
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
    const input = parseForm(reauthForm, form);
    if (!input.ok) return actionError(INVALID_REAUTH);
    const result = await regenerateRecoveryCodes(input.data, await requestContext());
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
    const input = parseForm(reauthForm, form);
    if (!input.ok) return actionError(INVALID_REAUTH);
    const result = await removeOwnFactor(input.data, await requestContext());
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
    const input = parseForm(resetUserMfaForm, form);
    if (!input.ok) {
      return actionError(input.field === 'userId' ? 'Kies een gebruiker.' : INVALID_REAUTH);
    }
    const { userId, password, code } = input.data;
    if (!userId) return actionError('Kies een gebruiker.');
    const result = await adminResetUserMfa(userId, { password, code }, await requestContext());
    if (!result.ok) return actionError(result.message);
    revalidatePath('/admin/users');
    const afterwards = result.data.mustEnrol
      ? 'bij de volgende aanmelding kiest de gebruiker een eigen wachtwoord en stelt een nieuwe authenticator in.'
      : 'bij de volgende aanmelding kiest de gebruiker een eigen wachtwoord; voor deze rol is tweestapsverificatie niet verplicht.';
    return actionOk(
      `Tweestapsverificatie van ${result.data.email} is gereset en alle sessies zijn afgemeld. Geef dit tijdelijke wachtwoord één keer door; ${afterwards}`,
      { temporaryPassword: result.data.temporaryPassword },
    );
  });
}
