'use client';

import { useActionState } from 'react';

import { Input } from '@/components/ui/input';
import { Field, StatusMessage, SubmitButton } from '@/components/admin/form';
import { changePasswordAction } from '@/lib/cms/actions/auth';
import { IDLE_STATE } from '@/lib/cms/actions/state';

/**
 * Used twice: on `/admin/account` (voluntary, stays on the page) and on
 * `/admin/password` (forced, `next` sends the user on once it succeeds).
 */
export function PasswordForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(changePasswordAction, IDLE_STATE);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-3">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <Field label="Huidig wachtwoord" htmlFor="currentPassword">
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          className="h-9"
        />
      </Field>

      <Field
        label="Nieuw wachtwoord"
        htmlFor="newPassword"
        hint="Minstens 12 tekens, met een kleine letter, een hoofdletter en een cijfer."
      >
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          className="h-9"
        />
      </Field>

      <Field label="Herhaal nieuw wachtwoord" htmlFor="repeatPassword">
        <Input
          id="repeatPassword"
          name="repeatPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          className="h-9"
        />
      </Field>

      <StatusMessage state={state} />

      <SubmitButton size="lg" className="mt-1">
        Wachtwoord wijzigen
      </SubmitButton>
    </form>
  );
}
