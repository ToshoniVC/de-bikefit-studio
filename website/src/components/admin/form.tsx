'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { IDLE_STATE, type ActionState } from '@/lib/cms/actions/state';

export type AdminAction = (state: ActionState, form: FormData) => Promise<ActionState>;

/**
 * Small mutation form: hidden inputs + a button + the resulting message.
 * Used for publish, delete, reorder, toggle … everywhere the payload is just a
 * couple of identifiers.
 */
export function ActionForm({
  action,
  hidden,
  children,
  className,
}: {
  action: AdminAction;
  hidden?: Record<string, string>;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, IDLE_STATE);
  return (
    <form action={formAction} className={cn('flex flex-col gap-1.5', className)}>
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      <StatusMessage state={state} />
    </form>
  );
}

/** Shared form furniture for the admin. Dutch labels, English identifiers. */

export function SubmitButton({
  children,
  variant = 'default',
  size = 'sm',
  className,
  confirm,
  ...props
}: React.ComponentProps<typeof Button> & { confirm?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      disabled={pending}
      className={cn(className)}
      onClick={
        confirm
          ? (event) => {
              if (!window.confirm(confirm)) event.preventDefault();
            }
          : undefined
      }
      {...props}
    >
      {pending ? 'Bezig…' : children}
    </Button>
  );
}

export function StatusMessage({ state }: { state: ActionState }) {
  if (state.ok === null || !state.message) return null;
  return (
    <p
      role="status"
      className={cn(
        'rounded-lg border px-2.5 py-2 text-xs',
        state.ok
          ? 'border-emerald-600/30 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300'
          : 'border-destructive/30 bg-destructive/10 text-destructive',
      )}
    >
      {state.message}
      {state.payload?.temporaryPassword ? (
        <span className="mt-1 block font-mono text-sm break-all">
          {state.payload.temporaryPassword}
        </span>
      ) : null}
    </p>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function CheckboxField({
  name,
  label,
  defaultChecked,
  hint,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-2 text-xs">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4 rounded border-input accent-primary"
      />
      <span>
        <span className="font-medium">{label}</span>
        {hint ? <span className="block text-[11px] text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

export function SectionCard({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-base font-semibold">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
