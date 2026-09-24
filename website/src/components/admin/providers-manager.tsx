'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field, SectionCard, StatusMessage, SubmitButton } from '@/components/admin/form';
import { locationOptionLabel, type LocationOption } from '@/components/admin/services-manager';
import { badgeTone } from '@/components/admin/tones';
import { createProviderAction } from '@/lib/cms/actions/providers';
import { IDLE_STATE } from '@/lib/cms/actions/state';

export type ProviderListRow = {
  id: string;
  displayName: string;
  loginEmail: string | null;
  isActive: boolean;
  serviceCount: number;
  googleConnected: boolean;
  googleEmail: string | null;
  googleSyncError: string | null;
};

export type UserOption = { id: string; label: string };

/**
 * Providers overview + create form. A new login gets a temporary password that
 * is shown exactly once, like in the users manager.
 */
export function ProvidersManager({
  providers,
  users,
  locations,
  canManage,
}: {
  providers: ProviderListRow[];
  /** Existing users without a provider profile (admins only; empty otherwise). */
  users: UserOption[];
  locations: LocationOption[];
  canManage: boolean;
}) {
  const [state, formAction] = useActionState(createProviderAction, IDLE_STATE);
  const [mode, setMode] = useState<'new' | 'existing'>(users.length > 0 ? 'existing' : 'new');

  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <SectionCard
          title="Nieuwe aanbieder"
          description="Koppel een bestaande gebruiker of maak meteen een login aan met de rol Aanbieder."
        >
          <form action={formAction} className="flex flex-col gap-3">
            <input type="hidden" name="mode" value={mode} />
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="sr-only">Gebruiker</legend>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="modeChoice"
                  checked={mode === 'existing'}
                  onChange={() => setMode('existing')}
                  disabled={users.length === 0}
                  className="accent-primary"
                />
                Bestaande gebruiker
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="modeChoice"
                  checked={mode === 'new'}
                  onChange={() => setMode('new')}
                  className="accent-primary"
                />
                Nieuwe gebruiker
              </label>
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              {mode === 'existing' ? (
                <Field label="Gebruiker" htmlFor="provider-userId">
                  <Select id="provider-userId" name="userId" defaultValue="" required>
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
              ) : (
                <>
                  <Field label="E-mailadres (login)" htmlFor="provider-email">
                    <Input id="provider-email" name="email" type="email" required />
                  </Field>
                  <Field label="Naam" htmlFor="provider-name">
                    <Input id="provider-name" name="name" required />
                  </Field>
                </>
              )}
              <Field
                label="Weergavenaam"
                htmlFor="provider-displayName"
                hint="Zoals klanten hem zien. Leeg = de naam van de gebruiker."
              >
                <Input id="provider-displayName" name="displayName" />
              </Field>
              <Field label="Standaardlocatie" htmlFor="provider-defaultLocationId">
                <Select id="provider-defaultLocationId" name="defaultLocationId" defaultValue="">
                  <option value="">Geen (algemene standaard)</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {locationOptionLabel(location)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <StatusMessage state={state} />
            <div>
              <SubmitButton>Aanbieder aanmaken</SubmitButton>
            </div>
          </form>
        </SectionCard>
      ) : null}

      <div className="overflow-x-auto border border-border bg-card">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="p-3">Aanbieder</th>
              <th className="p-3">Login</th>
              <th className="p-3">Diensten</th>
              <th className="p-3">Google Agenda</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {providers.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  Nog geen aanbieders.
                </td>
              </tr>
            ) : null}
            {providers.map((provider) => (
              <tr key={provider.id} className="border-b border-border last:border-0">
                <td className="p-3">
                  <Link
                    href={`/admin/providers/${provider.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {provider.displayName}
                  </Link>
                </td>
                <td className="p-3 text-xs break-all text-muted-foreground">
                  {provider.loginEmail ?? '—'}
                </td>
                <td className="p-3 text-xs">{provider.serviceCount}</td>
                <td className="p-3 text-xs">
                  {provider.googleConnected ? (
                    <Badge
                      variant={provider.googleSyncError ? 'warning' : 'success'}
                      className={badgeTone(provider.googleSyncError ? 'warning' : 'success')}
                    >
                      {provider.googleSyncError ? 'Fout' : 'Verbonden'}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Niet verbonden</Badge>
                  )}
                  {provider.googleEmail ? (
                    <span className="ml-1.5 text-muted-foreground">{provider.googleEmail}</span>
                  ) : null}
                </td>
                <td className="p-3">
                  <Badge
                    variant={provider.isActive ? 'success' : 'secondary'}
                    className={badgeTone(provider.isActive ? 'success' : 'secondary')}
                  >
                    {provider.isActive ? 'Actief' : 'Inactief'}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
