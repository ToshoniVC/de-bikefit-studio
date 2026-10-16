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
import { centsToEuroInput, LOCATION_KIND_LABELS } from '@/components/admin/booking-labels';
import { badgeTone } from '@/components/admin/tones';
import { formatPrice } from '@/lib/booking/format';
import {
  createServiceAction,
  deactivateServiceAction,
  reactivateServiceAction,
  updateServiceAction,
} from '@/lib/cms/actions/services';
import { IDLE_STATE } from '@/lib/cms/actions/state';
import type { CmsLocationKind } from '@/db/cms-schema';

export type ServiceRow = {
  id: string;
  name: string;
  choiceLabel: string;
  slug: string;
  description: string;
  durationMinutes: number;
  bufferAfterMinutes: number | null;
  priceCents: number | null;
  showPrice: boolean;
  locationId: string | null;
  requiresGuardian: boolean;
  isActive: boolean;
  sortOrder: number;
  color: string | null;
  /** Active providers offering it. */
  providerCount: number;
  /** `service.manage` only: the catalogue is the admin's (providers subscribe, never edit). */
  editable: boolean;
  /** Offerings (Beheer → Aanbod) that use it as a variant, by title. */
  offers: string[];
  /** Its public price and label are set in Beheer → Aanbod (a saved offering uses it). */
  managedByOffering: boolean;
};

export type LocationOption = {
  id: string;
  name: string;
  kind: CmsLocationKind;
  isActive: boolean;
};

export function locationOptionLabel(location: LocationOption): string {
  const kind = LOCATION_KIND_LABELS[location.kind];
  return `${location.name} (${kind.toLowerCase()})${location.isActive ? '' : ' — inactief'}`;
}

/** Every service field. `idPrefix` keeps label/input ids unique per form. */
export function ServiceFields({
  idPrefix,
  service,
  locations,
  defaultBuffer,
}: {
  idPrefix: string;
  service?: ServiceRow;
  locations: LocationOption[];
  defaultBuffer: number;
}) {
  const id = (name: string) => `${idPrefix}-${name}`;
  const managed = Boolean(service?.managedByOffering);
  return (
    <>
      {managed ? (
        <>
          {/* Kept as stored: the public label and price come from Beheer → Aanbod. */}
          <input type="hidden" name="choiceLabel" value={service?.choiceLabel ?? ''} />
          <input type="hidden" name="price" value={centsToEuroInput(service?.priceCents ?? null)} />
          {service?.showPrice ? <input type="hidden" name="showPrice" value="on" /> : null}
          <p className="mb-3 border-l-2 border-primary bg-muted px-3 py-2 text-xs text-muted-foreground">
            Deze dienst is een variant van {service?.offers.join(', ')}. Prijs en label (Volwassene
            of Jeugd) stel je in bij Beheer → Aanbod; hier beheer je duur, buffer, locatie en de
            ouderregel.
          </p>
        </>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Naam" htmlFor={id('name')}>
          <Input id={id('name')} name="name" defaultValue={service?.name} required />
        </Field>
        {managed ? null : (
          <Field
            label="Keuzelabel onder een aanbod"
            htmlFor={id('choiceLabel')}
            hint="Bv. Volwassene of Jeugd: zo heet deze keuze als een aanbod meerdere diensten koppelt. Leeg = de naam."
          >
            <Input
              id={id('choiceLabel')}
              name="choiceLabel"
              defaultValue={service?.choiceLabel}
              maxLength={40}
            />
          </Field>
        )}
        <Field
          label="Slug"
          htmlFor={id('slug')}
          hint="Kleine letters en koppeltekens. Leeg laten om hem uit de naam af te leiden."
        >
          <Input
            id={id('slug')}
            name="slug"
            defaultValue={service?.slug}
            placeholder="volwassenenfit"
          />
        </Field>
        <Field label="Duur (minuten)" htmlFor={id('durationMinutes')}>
          <Input
            id={id('durationMinutes')}
            name="durationMinutes"
            type="number"
            min={5}
            max={720}
            step={5}
            defaultValue={service?.durationMinutes ?? 60}
            required
          />
        </Field>
        <Field
          label="Buffer na afloop (minuten)"
          htmlFor={id('bufferAfterMinutes')}
          hint={`Vrije tijd na de afspraak. Leeg = standaard uit de instellingen (${defaultBuffer} min).`}
        >
          <Input
            id={id('bufferAfterMinutes')}
            name="bufferAfterMinutes"
            type="number"
            min={0}
            max={240}
            step={5}
            defaultValue={service?.bufferAfterMinutes ?? ''}
          />
        </Field>
        {managed ? null : (
          <Field
            label="Prijs (euro)"
            htmlFor={id('price')}
            hint="Bv. 150 of 149,50. Leeg = geen prijs."
          >
            <Input
              id={id('price')}
              name="price"
              inputMode="decimal"
              defaultValue={centsToEuroInput(service?.priceCents ?? null)}
            />
          </Field>
        )}
        <Field
          label="Locatie"
          htmlFor={id('locationId')}
          hint="Leeg = de standaardlocatie van de aanbieder."
        >
          <Select id={id('locationId')} name="locationId" defaultValue={service?.locationId ?? ''}>
            <option value="">Standaardlocatie van de aanbieder</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {locationOptionLabel(location)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Volgorde" htmlFor={id('sortOrder')} hint="Lager staat eerst.">
          <Input
            id={id('sortOrder')}
            name="sortOrder"
            type="number"
            step={1}
            defaultValue={service?.sortOrder ?? 0}
          />
        </Field>
        <Field label="Kleur" htmlFor={id('color')} hint="Hex-code, bv. #2f6f5e. Mag leeg blijven.">
          <div className="flex items-center gap-2">
            <Input
              id={id('color')}
              name="color"
              defaultValue={service?.color ?? ''}
              placeholder="#2f6f5e"
              pattern="^#[0-9a-fA-F]{6}$"
            />
            {service?.color ? (
              <span
                aria-hidden
                className="size-6 shrink-0 rounded-md ring-1 ring-foreground/10"
                style={{ backgroundColor: service.color }}
              />
            ) : null}
          </div>
        </Field>
      </div>
      <Field label="Omschrijving" htmlFor={id('description')} className="mt-3">
        <Textarea
          id={id('description')}
          name="description"
          rows={3}
          defaultValue={service?.description ?? ''}
        />
      </Field>
      <div className="mt-3 flex flex-col gap-2">
        {managed ? null : (
          <CheckboxField
            name="showPrice"
            label="Prijs tonen op de website"
            defaultChecked={service?.showPrice ?? false}
          />
        )}
        <CheckboxField
          name="requiresGuardian"
          label="Ouder of voogd verplicht"
          defaultChecked={service?.requiresGuardian ?? false}
          hint="Voor jeugdfits: het boekingsformulier vraagt dan de gegevens van een ouder."
        />
        <CheckboxField
          name="isActive"
          label="Actief (boekbaar)"
          defaultChecked={service?.isActive ?? true}
        />
      </div>
    </>
  );
}

/** Create form (admin only: `repo.createService` needs `service.manage`). */
export function ServiceCreateForm({
  locations,
  defaultBuffer,
  idPrefix = 'service-new',
}: {
  locations: LocationOption[];
  defaultBuffer: number;
  idPrefix?: string;
}) {
  const [state, formAction] = useActionState(createServiceAction, IDLE_STATE);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <ServiceFields idPrefix={idPrefix} locations={locations} defaultBuffer={defaultBuffer} />
      <StatusMessage state={state} />
      <div>
        <SubmitButton>Dienst aanmaken</SubmitButton>
      </div>
    </form>
  );
}

export function ServicesManager({
  services,
  locations,
  defaultBuffer,
  canCreate,
}: {
  services: ServiceRow[];
  locations: LocationOption[];
  defaultBuffer: number;
  canCreate: boolean;
}) {
  const locationName = (id: string | null) =>
    id ? (locations.find((location) => location.id === id)?.name ?? 'Onbekende locatie') : null;

  return (
    <div className="flex flex-col gap-4">
      {canCreate ? (
        <SectionCard
          title="Nieuwe dienst"
          description="Diensten verschijnen op de boekingspagina zodra ze actief zijn en minstens één aanbieder ze aanbiedt."
        >
          <ServiceCreateForm locations={locations} defaultBuffer={defaultBuffer} />
        </SectionCard>
      ) : null}

      <SectionCard title="Diensten" description={`${services.length} dienst(en).`}>
        {services.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nog geen diensten.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {services.map((service) => (
              <li key={service.id} className="border border-border bg-background p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {service.color ? (
                    <span
                      aria-hidden
                      className="size-3 rounded-full ring-1 ring-foreground/10"
                      style={{ backgroundColor: service.color }}
                    />
                  ) : null}
                  <span className="font-medium">{service.name}</span>
                  {service.choiceLabel ? (
                    <span className="text-xs text-muted-foreground">
                      keuze “{service.choiceLabel}”
                    </span>
                  ) : null}
                  <code className="bg-muted px-1 text-xs">{service.slug}</code>
                  <Badge variant="outline">{service.durationMinutes} min</Badge>
                  {!service.managedByOffering &&
                  service.showPrice &&
                  service.priceCents !== null ? (
                    <Badge variant="outline">{formatPrice(service.priceCents)}</Badge>
                  ) : null}
                  {service.requiresGuardian ? <Badge variant="secondary">Met ouder</Badge> : null}
                  <Badge
                    variant={service.isActive ? 'success' : 'secondary'}
                    className={badgeTone(service.isActive ? 'success' : 'secondary')}
                  >
                    {service.isActive ? 'Actief' : 'Inactief'}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {locationName(service.locationId) ?? 'Standaardlocatie aanbieder'} ·{' '}
                    {service.providerCount === 1
                      ? '1 aanbieder'
                      : `${service.providerCount} aanbieders`}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {service.offers.length > 0
                    ? `Variant van het aanbod: ${service.offers.join(', ')} (Beheer → Aanbod). Enkel via dat aanbod te boeken, zolang het getoond wordt en rechtstreeks geboekt wordt.`
                    : 'Geen variant van een aanbod: rechtstreeks te kiezen op /afspraak.'}
                </p>

                {service.editable ? (
                  <details className="mt-2">
                    <summary className="admin-label cursor-pointer text-xs text-primary">
                      Bewerken
                    </summary>
                    <div className="mt-2 flex flex-col gap-3">
                      <ActionForm action={updateServiceAction} hidden={{ serviceId: service.id }}>
                        <ServiceFields
                          idPrefix={`service-${service.id}`}
                          service={service}
                          locations={locations}
                          defaultBuffer={defaultBuffer}
                        />
                        <div className="mt-1">
                          <SubmitButton size="xs" variant="outline">
                            Opslaan
                          </SubmitButton>
                        </div>
                      </ActionForm>
                      <ActionForm
                        action={
                          service.isActive ? deactivateServiceAction : reactivateServiceAction
                        }
                        hidden={{ serviceId: service.id }}
                      >
                        <SubmitButton
                          size="xs"
                          variant={service.isActive ? 'destructive' : 'outline'}
                          confirm={
                            service.isActive
                              ? 'Dienst deactiveren? Hij is dan niet meer boekbaar; bestaande afspraken blijven staan.'
                              : undefined
                          }
                        >
                          {service.isActive ? 'Deactiveren' : 'Heractiveren'}
                        </SubmitButton>
                      </ActionForm>
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
