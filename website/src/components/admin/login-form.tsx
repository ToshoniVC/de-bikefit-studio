'use client';

import { useActionState } from 'react';

import { Input } from '@/components/ui/input';
import { Field, StatusMessage, SubmitButton } from '@/components/admin/form';
import { loginAction } from '@/lib/cms/actions/auth';
import { IDLE_STATE } from '@/lib/cms/actions/state';

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useActionState(loginAction, IDLE_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />

      <Field label="E-mailadres" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          autoFocus
          required
          className="h-9"
        />
      </Field>

      <Field label="Wachtwoord" htmlFor="password">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-9"
        />
      </Field>

      <StatusMessage state={state} />

      <SubmitButton size="lg" className="mt-1 w-full">
        Aanmelden
      </SubmitButton>
    </form>
  );
}
