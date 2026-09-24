'use client';

import { useActionState } from 'react';

import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field, StatusMessage, SubmitButton } from '@/components/admin/form';
import { createPageAction } from '@/lib/cms/actions/pages';
import { IDLE_STATE } from '@/lib/cms/actions/state';

export const PAGE_KINDS = [
  { value: 'default', label: 'Standaard' },
  { value: 'home', label: 'Home' },
  { value: 'landing', label: 'Landing' },
];

export function PageCreateForm({ locales, locale }: { locales: string[]; locale: string }) {
  const [state, formAction] = useActionState(createPageAction, IDLE_STATE);

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-3">
      <Field label="Taal" htmlFor="locale">
        <Select id="locale" name="locale" defaultValue={locale}>
          {locales.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Titel" htmlFor="title">
        <Input id="title" name="title" required autoFocus />
      </Field>

      <Field
        label="Pad (slug)"
        htmlFor="slug"
        hint="Zonder schuine streep vooraan. Laat leeg voor de homepagina."
      >
        <Input id="slug" name="slug" placeholder="bikefit" />
      </Field>

      <Field label="Template" htmlFor="kind">
        <Select id="kind" name="kind" defaultValue="default">
          {PAGE_KINDS.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Vertaalgroep"
        htmlFor="translationGroup"
        hint="Koppelt dezelfde pagina over talen heen. Leeg = afgeleid van het pad."
      >
        <Input id="translationGroup" name="translationGroup" placeholder="bikefit" />
      </Field>

      <StatusMessage state={state} />

      <div>
        <SubmitButton size="lg">Pagina aanmaken</SubmitButton>
      </div>
    </form>
  );
}
