'use client';

import { useActionState } from 'react';

import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  ActionForm,
  CheckboxField,
  Field,
  SectionCard,
  StatusMessage,
  SubmitButton,
} from '@/components/admin/form';
import {
  createRedirectAction,
  deleteRedirectAction,
  toggleRedirectAction,
  updateRedirectAction,
} from '@/lib/cms/actions/redirects';
import { IDLE_STATE } from '@/lib/cms/actions/state';

export type RedirectRow = {
  id: string;
  fromPath: string;
  toPath: string;
  statusCode: number;
  isEnabled: boolean;
  notes: string | null;
};

export function RedirectsManager({
  redirects,
  canManage,
}: {
  redirects: RedirectRow[];
  canManage: boolean;
}) {
  const [state, formAction] = useActionState(createRedirectAction, IDLE_STATE);

  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <SectionCard
          title="Nieuwe redirect"
          description="Bronpad begint met “/”. Doel is een pad of een volledige https://-URL."
        >
          <form action={formAction} className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Van" htmlFor="fromPath">
                <Input id="fromPath" name="fromPath" placeholder="/oude-pagina" required />
              </Field>
              <Field label="Naar" htmlFor="toPath">
                <Input id="toPath" name="toPath" placeholder="/bikefit" required />
              </Field>
              <Field label="Statuscode" htmlFor="statusCode">
                <Select id="statusCode" name="statusCode" defaultValue="301">
                  <option value="301">301 — permanent</option>
                  <option value="302">302 — tijdelijk</option>
                </Select>
              </Field>
              <Field label="Notitie" htmlFor="notes">
                <Input id="notes" name="notes" />
              </Field>
            </div>
            <CheckboxField name="isEnabled" label="Meteen inschakelen" defaultChecked />
            <StatusMessage state={state} />
            <div>
              <SubmitButton>Redirect aanmaken</SubmitButton>
            </div>
          </form>
        </SectionCard>
      ) : null}

      <SectionCard title="Redirects" description={`${redirects.length} redirect(s).`}>
        {redirects.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nog geen redirects.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {redirects.map((redirect) => (
              <li key={redirect.id} className="rounded-lg border border-border p-2.5">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                  <code className="rounded bg-muted px-1 text-xs">{redirect.fromPath}</code>
                  <span aria-hidden>→</span>
                  <code className="rounded bg-muted px-1 text-xs">{redirect.toPath}</code>
                  <Badge variant="outline">{redirect.statusCode}</Badge>
                  <Badge variant={redirect.isEnabled ? 'success' : 'secondary'}>
                    {redirect.isEnabled ? 'Actief' : 'Uit'}
                  </Badge>
                </div>

                {canManage ? (
                  <div className="flex flex-col gap-2">
                    <ActionForm action={updateRedirectAction} hidden={{ redirectId: redirect.id }}>
                      <div className="grid gap-2 sm:grid-cols-4">
                        <Input name="fromPath" defaultValue={redirect.fromPath} />
                        <Input name="toPath" defaultValue={redirect.toPath} />
                        <Select name="statusCode" defaultValue={String(redirect.statusCode)}>
                          <option value="301">301</option>
                          <option value="302">302</option>
                        </Select>
                        <Input name="notes" defaultValue={redirect.notes ?? ''} placeholder="Notitie" />
                      </div>
                      <CheckboxField
                        name="isEnabled"
                        label="Actief"
                        defaultChecked={redirect.isEnabled}
                      />
                      <div>
                        <SubmitButton size="xs" variant="outline">
                          Opslaan
                        </SubmitButton>
                      </div>
                    </ActionForm>

                    <div className="flex flex-wrap gap-2">
                      <ActionForm
                        action={toggleRedirectAction}
                        hidden={{
                          redirectId: redirect.id,
                          isEnabled: redirect.isEnabled ? 'false' : 'true',
                        }}
                      >
                        <SubmitButton size="xs" variant="outline">
                          {redirect.isEnabled ? 'Uitschakelen' : 'Inschakelen'}
                        </SubmitButton>
                      </ActionForm>

                      <ActionForm action={deleteRedirectAction} hidden={{ redirectId: redirect.id }}>
                        <SubmitButton
                          size="xs"
                          variant="destructive"
                          confirm="Redirect verwijderen?"
                        >
                          Verwijderen
                        </SubmitButton>
                      </ActionForm>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Alleen beheerders kunnen redirects wijzigen.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
