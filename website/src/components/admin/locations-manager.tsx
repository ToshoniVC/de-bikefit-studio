'use client';

import { useActionState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  ActionForm,
  CheckboxField,
  Field,
  SectionCard,
  StatusMessage,
  SubmitButton,
} from '@/components/admin/form';
import { LOCATION_KIND_LABELS } from '@/components/admin/booking-labels';
import { badgeTone } from '@/components/admin/tones';
import {
  createLocationAction,
  deactivateLocationAction,
  reactivateLocationAction,
  updateLocationAction,
} from '@/lib/cms/actions/locations';
import { IDLE_STATE } from '@/lib/cms/actions/state';
import type { CmsLocationKind } from '@/db/cms-schema';

export type LocationRow = {
  id: string;
  name: string;
  kind: CmsLocationKind;
  addressLines: string[];
  postalCode: string;
  city: string;
  country: string;
  notes: string | null;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
};

function LocationFields({ idPrefix, location }: { idPrefix: string; location?: LocationRow }) {
  const id = (name: string) => `${idPrefix}-${name}`;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Naam" htmlFor={id('name')}>
          <Input id={id('name')} name="name" defaultValue={location?.name} required />
        </Field>
        <Field
          label="Soort"
          htmlFor={id('kind')}
          hint="“Bij de klant”: het boekingsformulier vraagt dan het adres van de klant."
        >
          <Select id={id('kind')} name="kind" defaultValue={location?.kind ?? 'studio'}>
            <option value="studio">{LOCATION_KIND_LABELS.studio}</option>
            <option value="customer">{LOCATION_KIND_LABELS.customer}</option>
          </Select>
        </Field>
        <Field label="Postcode" htmlFor={id('postalCode')}>
          <Input id={id('postalCode')} name="postalCode" defaultValue={location?.postalCode} />
        </Field>
        <Field label="Gemeente" htmlFor={id('city')}>
          <Input id={id('city')} name="city" defaultValue={location?.city} />
        </Field>
        <Field label="Land" htmlFor={id('country')} hint="Landcode, bv. BE.">
          <Input id={id('country')} name="country" defaultValue={location?.country ?? 'BE'} />
        </Field>
        <Field label="Volgorde" htmlFor={id('sortOrder')} hint="Lager staat eerst.">
          <Input
            id={id('sortOrder')}
            name="sortOrder"
            type="number"
            step={1}
            defaultValue={location?.sortOrder ?? 0}
          />
        </Field>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Adresregels" htmlFor={id('addressLines')} hint="Eén regel per lijn.">
          <Textarea
            id={id('addressLines')}
            name="addressLines"
            rows={3}
            defaultValue={location?.addressLines.join('\n') ?? ''}
          />
        </Field>
        <Field
          label="Notities"
          htmlFor={id('notes')}
          hint="Bv. parkeren of toegang. Intern, tenzij de website ze toont."
        >
          <Textarea id={id('notes')} name="notes" rows={3} defaultValue={location?.notes ?? ''} />
        </Field>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <CheckboxField
          name="isDefault"
          label="Standaardlocatie"
          defaultChecked={location?.isDefault ?? false}
          hint="Gebruikt wanneer een aanbieder of dienst geen eigen locatie heeft."
        />
        <CheckboxField name="isActive" label="Actief" defaultChecked={location?.isActive ?? true} />
      </div>
    </>
  );
}

export function LocationsManager({
  locations,
  canManage,
}: {
  locations: LocationRow[];
  canManage: boolean;
}) {
  const [state, formAction] = useActionState(createLocationAction, IDLE_STATE);

  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <SectionCard
          title="Nieuwe locatie"
          description="Een studio of “bij de klant thuis”. Diensten en aanbieders verwijzen ernaar."
        >
          <form action={formAction} className="flex flex-col gap-3">
            <LocationFields idPrefix="location-new" />
            <StatusMessage state={state} />
            <div>
              <SubmitButton>Locatie aanmaken</SubmitButton>
            </div>
          </form>
        </SectionCard>
      ) : null}

      <SectionCard title="Locaties" description={`${locations.length} locatie(s).`}>
        {locations.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nog geen locaties.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {locations.map((location) => {
              const address = [
                ...location.addressLines,
                [location.postalCode, location.city].filter(Boolean).join(' '),
              ]
                .filter(Boolean)
                .join(', ');
              return (
                <li key={location.id} className="border border-border bg-background p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{location.name}</span>
                    <Badge variant="outline">{LOCATION_KIND_LABELS[location.kind]}</Badge>
                    {location.isDefault ? <Badge>Standaard</Badge> : null}
                    <Badge
                      variant={location.isActive ? 'success' : 'secondary'}
                      className={badgeTone(location.isActive ? 'success' : 'secondary')}
                    >
                      {location.isActive ? 'Actief' : 'Inactief'}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {address || 'Geen adres ingevuld'}
                    </span>
                  </div>

                  {canManage ? (
                    <details className="mt-2">
                      <summary className="admin-label cursor-pointer text-xs text-primary">
                        Bewerken
                      </summary>
                      <div className="mt-2 flex flex-col gap-3">
                        <ActionForm
                          action={updateLocationAction}
                          hidden={{ locationId: location.id }}
                        >
                          <LocationFields
                            idPrefix={`location-${location.id}`}
                            location={location}
                          />
                          <div className="mt-1">
                            <SubmitButton size="xs" variant="outline">
                              Opslaan
                            </SubmitButton>
                          </div>
                        </ActionForm>
                        <ActionForm
                          action={
                            location.isActive ? deactivateLocationAction : reactivateLocationAction
                          }
                          hidden={{ locationId: location.id }}
                        >
                          <SubmitButton
                            size="xs"
                            variant={location.isActive ? 'destructive' : 'outline'}
                            confirm={
                              location.isActive
                                ? 'Locatie deactiveren? Bestaande afspraken blijven staan.'
                                : undefined
                            }
                          >
                            {location.isActive ? 'Deactiveren' : 'Heractiveren'}
                          </SubmitButton>
                        </ActionForm>
                      </div>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
