'use client';

import { useActionState } from 'react';

import { Input } from '@/components/ui/input';
import { Field, StatusMessage, SubmitButton } from '@/components/admin/form';
import { MfaCodeField } from '@/components/admin/mfa/enrolment';
import { FLASH_TONES } from '@/components/admin/tones';
import { confirmIdentityAction } from '@/lib/cms/actions/mfa';
import { IDLE_STATE } from '@/lib/cms/actions/state';

/**
 * "Bevestig je identiteit" (step-up) above sensitive forms. Purely a
 * convenience: the server refuses the change itself without a recent
 * re-authentication, whatever this panel shows. `until` is an ISO time from
 * the server, or null when a step-up is needed.
 */
export function StepUpPanel({
  until,
  needsCode,
  what,
}: {
  until: string | null;
  needsCode: boolean;
  /** What the confirmation unlocks, e.g. "gebruikers beheren". */
  what: string;
}) {
  const [state, formAction] = useActionState(confirmIdentityAction, IDLE_STATE);

  if (until) {
    const time = new Date(until).toLocaleTimeString('nl-BE', {
      timeZone: 'Europe/Brussels',
      hour: '2-digit',
      minute: '2-digit',
    });
    return (
      <p role="status" className={`px-3 py-2 text-sm ${FLASH_TONES.success}`}>
        Identiteit bevestigd: je kan tot {time} {what}. Daarna vragen we opnieuw je wachtwoord
        {needsCode ? ' en je code' : ''}.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Wil je {what}? Bevestig dan eerst je identiteit met je wachtwoord
        {needsCode ? ' en een code uit je app' : ''}. Dat geldt 5 minuten.
      </p>
      <Field label="Huidig wachtwoord" htmlFor="step-up-password">
        <Input
          id="step-up-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-9"
        />
      </Field>
      {needsCode ? <MfaCodeField id="step-up-code" /> : null}
      <StatusMessage state={state} />
      <div>
        <SubmitButton variant="outline">Bevestig je identiteit</SubmitButton>
      </div>
    </form>
  );
}
