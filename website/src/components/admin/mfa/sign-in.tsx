'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { StatusMessage, SubmitButton } from '@/components/admin/form';
import { MfaCodeField, MfaEnrolmentStep } from '@/components/admin/mfa/enrolment';
import { MfaRecoveryCodes } from '@/components/admin/mfa/recovery-codes';
import { PasswordForm } from '@/components/admin/password-form';
import {
  mfaCancelAction,
  mfaChangePasswordAction,
  mfaConfirmEnrolmentAction,
  mfaStartEnrolmentAction,
  mfaVerifyAction,
} from '@/lib/cms/actions/mfa';
import { IDLE_STATE } from '@/lib/cms/actions/state';

export type MfaSignInStep = 'password' | 'enrol' | 'verify' | 'done';

/**
 * The second sign-in step on `/admin/mfa`. Every action state lives in this
 * one component, which the page renders at the same place whatever the step:
 * when confirming the enrolment creates the session, the page re-renders with
 * `step="done"` and the recovery codes in `confirmState` survive to be shown.
 */
export function MfaSignIn({ step, next }: { step: MfaSignInStep; next: string }) {
  const [startState, startAction] = useActionState(mfaStartEnrolmentAction, IDLE_STATE);
  const [confirmState, confirmAction] = useActionState(mfaConfirmEnrolmentAction, IDLE_STATE);
  const [verifyState, verifyAction] = useActionState(mfaVerifyAction, IDLE_STATE);

  const codes = confirmState.ok ? confirmState.payload?.recoveryCodes : undefined;
  if (codes) {
    return (
      <div className="flex flex-col gap-4">
        <StatusMessage state={{ ok: true, message: confirmState.message }} />
        <MfaRecoveryCodes codes={codes} />
        <Link href={next} className={buttonVariants({ size: 'lg' })}>
          Ik heb ze bewaard, naar het beheer
        </Link>
      </div>
    );
  }

  if (step === 'done') {
    return (
      <p className="text-sm">
        Je bent aangemeld.{' '}
        <Link href={next} className="underline underline-offset-4 hover:text-primary">
          Naar het beheer
        </Link>
      </p>
    );
  }

  const cancel = (
    <form action={mfaCancelAction} className="mt-5">
      <button type="submit" className="text-sm underline underline-offset-4 hover:text-primary">
        Annuleren en afmelden
      </button>
    </form>
  );

  if (step === 'password') {
    return (
      <>
        <PasswordForm next={next} action={mfaChangePasswordAction} />
        {cancel}
      </>
    );
  }

  if (step === 'verify') {
    return (
      <>
        <form action={verifyAction} className="flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <MfaCodeField id="mfa-code" autoFocus />
          <StatusMessage state={verifyState} />
          <SubmitButton size="lg" className="mt-1 w-full">
            Bevestigen
          </SubmitButton>
        </form>
        {cancel}
      </>
    );
  }

  const display = startState.ok ? startState.payload : undefined;
  return (
    <>
      {display ? (
        <MfaEnrolmentStep
          display={display}
          confirmAction={confirmAction}
          confirmState={confirmState}
          submitLabel="Bevestigen en aanmelden"
        />
      ) : (
        <form action={startAction} className="flex flex-col gap-3">
          <p className="text-sm">
            Als beheerder meld je je aan met je wachtwoord én een code uit een authenticator-app.
            Dat stel je nu één keer in; je hebt je telefoon of 1Password bij de hand nodig.
          </p>
          <StatusMessage state={startState} />
          <SubmitButton size="lg">Authenticator instellen</SubmitButton>
        </form>
      )}
      {cancel}
    </>
  );
}
