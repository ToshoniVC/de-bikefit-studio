'use client';

import { useActionState } from 'react';

import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field, StatusMessage, SubmitButton } from '@/components/admin/form';
import { MfaCodeField } from '@/components/admin/mfa/enrolment';
import { adminResetUserMfaAction } from '@/lib/cms/actions/mfa';
import { IDLE_STATE } from '@/lib/cms/actions/state';

/**
 * Break-glass for a colleague who lost both their authenticator and their
 * recovery codes. The acting admin confirms with their own password and code;
 * the colleague gets a temporary password (shown once) and enrols anew.
 */
export function MfaResetUserForm({ users }: { users: Array<{ id: string; label: string }> }) {
  const [state, formAction] = useActionState(adminResetUserMfaAction, IDLE_STATE);

  if (users.length === 0) {
    return <p className="text-sm text-muted-foreground">Geen andere gebruikers.</p>;
  }

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-3">
      <Field label="Gebruiker" htmlFor="mfa-reset-user">
        <Select id="mfa-reset-user" name="userId" required defaultValue="">
          <option value="" disabled>
            Kies een gebruiker
          </option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Jouw wachtwoord" htmlFor="mfa-reset-password">
        <Input
          id="mfa-reset-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-9"
        />
      </Field>
      <MfaCodeField id="mfa-reset-code" />
      <StatusMessage state={state} />
      <div>
        <SubmitButton
          variant="destructive"
          confirm="Tweestapsverificatie resetten? De gebruiker krijgt een tijdelijk wachtwoord en alle sessies worden afgemeld."
        >
          Tweestapsverificatie resetten
        </SubmitButton>
      </div>
    </form>
  );
}
