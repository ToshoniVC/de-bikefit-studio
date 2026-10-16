'use client';

import { useActionState } from 'react';

import { Input } from '@/components/ui/input';
import { Field, StatusMessage, SubmitButton } from '@/components/admin/form';
import { MfaCodeField, MfaEnrolmentStep } from '@/components/admin/mfa/enrolment';
import { MfaRecoveryCodes } from '@/components/admin/mfa/recovery-codes';
import { FLASH_TONES } from '@/components/admin/tones';
import {
  mfaConfirmReplacementAction,
  mfaRegenerateRecoveryCodesAction,
  mfaRemoveOwnFactorAction,
  mfaStartReplacementAction,
} from '@/lib/cms/actions/mfa';
import { IDLE_STATE, type ActionState } from '@/lib/cms/actions/state';

export type MfaAccountStatus = {
  enrolled: boolean;
  required: boolean;
  confirmedAt: string | null;
  recoveryCodesLeft: number;
};

/** Current password + current code: the re-authentication every change asks for. */
function ReauthForm({
  idPrefix,
  action,
  state,
  submitLabel,
  confirm,
  destructive,
}: {
  idPrefix: string;
  action: (form: FormData) => void;
  state: ActionState;
  submitLabel: string;
  confirm?: string;
  destructive?: boolean;
}) {
  return (
    <form action={action} className="flex max-w-md flex-col gap-3">
      <Field label="Huidig wachtwoord" htmlFor={`${idPrefix}-password`}>
        <Input
          id={`${idPrefix}-password`}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-9"
        />
      </Field>
      <MfaCodeField id={`${idPrefix}-code`} />
      {state.ok ? null : <StatusMessage state={state} />}
      <div>
        <SubmitButton variant={destructive ? 'destructive' : 'outline'} confirm={confirm}>
          {submitLabel}
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * Two-step verification on `/admin/account`. All action states live here, at
 * the top, because replacing the authenticator sets a new session cookie and
 * the page re-renders: the new recovery codes must survive that.
 */
export function MfaAccountPanel({
  status,
  recoveryCodeUsed,
}: {
  status: MfaAccountStatus;
  recoveryCodeUsed: boolean;
}) {
  const [startState, startAction] = useActionState(mfaStartReplacementAction, IDLE_STATE);
  const [confirmState, confirmAction] = useActionState(mfaConfirmReplacementAction, IDLE_STATE);
  const [codesState, codesAction] = useActionState(mfaRegenerateRecoveryCodesAction, IDLE_STATE);
  const [removeState, removeAction] = useActionState(mfaRemoveOwnFactorAction, IDLE_STATE);

  const newCodes =
    (confirmState.ok && confirmState.payload?.recoveryCodes) ||
    (codesState.ok && codesState.payload?.recoveryCodes) ||
    undefined;
  if (newCodes) {
    return (
      <div className="flex flex-col gap-4">
        <StatusMessage state={confirmState.ok ? confirmState : codesState} />
        <MfaRecoveryCodes codes={newCodes} />
      </div>
    );
  }
  if (removeState.ok) return <StatusMessage state={removeState} />;

  if (!status.enrolled) {
    return (
      <p className="text-sm text-muted-foreground">
        {status.required
          ? 'Nog niet ingesteld. Meld je af en weer aan om je authenticator te koppelen.'
          : 'Niet ingesteld. Tweestapsverificatie is verplicht voor beheerders en aanbieders; voor jouw rol is ze nu niet nodig.'}
      </p>
    );
  }

  const display = startState.ok ? startState.payload : undefined;
  return (
    <div className="flex flex-col gap-6">
      {recoveryCodeUsed ? (
        <p role="status" className={`px-3 py-2 text-sm ${FLASH_TONES.warning}`}>
          Je hebt je aangemeld met een herstelcode; die code werkt niet meer. Nog{' '}
          {status.recoveryCodesLeft} over. Maak hieronder nieuwe codes aan als je er weinig hebt, of
          vervang je authenticator als je hem kwijt bent.
        </p>
      ) : null}

      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="admin-label text-xs text-muted-foreground">Authenticator</dt>
          <dd>
            Actief
            {status.confirmedAt
              ? ` sinds ${new Date(status.confirmedAt).toLocaleDateString('nl-BE')}`
              : ''}
          </dd>
        </div>
        <div>
          <dt className="admin-label text-xs text-muted-foreground">Herstelcodes</dt>
          <dd>{status.recoveryCodesLeft} ongebruikt</dd>
        </div>
      </dl>

      <div>
        <h3 className="mb-1 text-base font-medium">Authenticator vervangen</h3>
        <p className="mb-3 text-sm text-muted-foreground">
          Nieuwe telefoon of andere app? Bevestig met je wachtwoord en een huidige code (of
          herstelcode). Daarna worden alle andere sessies afgemeld en krijg je nieuwe herstelcodes.
        </p>
        {display ? (
          <MfaEnrolmentStep
            display={display}
            confirmAction={confirmAction}
            confirmState={confirmState}
            submitLabel="Nieuwe authenticator bevestigen"
          />
        ) : (
          <ReauthForm
            idPrefix="mfa-replace"
            action={startAction}
            state={startState}
            submitLabel="Authenticator vervangen"
          />
        )}
      </div>

      <div>
        <h3 className="mb-1 text-base font-medium">Nieuwe herstelcodes</h3>
        <p className="mb-3 text-sm text-muted-foreground">
          Je oude herstelcodes werken daarna niet meer.
        </p>
        <ReauthForm
          idPrefix="mfa-codes"
          action={codesAction}
          state={codesState}
          submitLabel="Nieuwe herstelcodes maken"
        />
      </div>

      {status.required ? null : (
        <div>
          <h3 className="mb-1 text-base font-medium">Tweestapsverificatie uitschakelen</h3>
          <ReauthForm
            idPrefix="mfa-remove"
            action={removeAction}
            state={removeState}
            submitLabel="Uitschakelen"
            confirm="Tweestapsverificatie uitschakelen? Alle sessies worden afgemeld."
            destructive
          />
        </div>
      )}
    </div>
  );
}
