'use client';

import { useActionState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { SectionCard, StatusMessage, SubmitButton } from '@/components/admin/form';
import {
  ScopeFields,
  type EditorScope,
  type ProviderServiceOption,
  type ProviderSubscription,
} from '@/components/admin/provider-editor';
import { locationOptionLabel, type LocationOption } from '@/components/admin/services-manager';
import { badgeTone } from '@/components/admin/tones';
import { setProviderServicesAction } from '@/lib/cms/actions/providers';
import { IDLE_STATE } from '@/lib/cms/actions/state';

/** An offering whose variants are booked as services (Beheer → Aanbod), for grouping. */
export type ProviderOfferingGroup = {
  title: string;
  /** Shown and booked directly right now. */
  bookable: boolean;
  variants: { serviceId: string; label: string }[];
};

/**
 * The services a provider offers, grouped by offering: "Bikefit – huidige
 * fiets" with Volwassene and Jeugd underneath, then the services no offering
 * uses. One form, one action (`setProviderServicesAction`): a provider ticks
 * what they offer themselves; the repo allows only their own profile and only
 * active services (`service.subscribe.own`). An offering booked directly is
 * online only while at least one active provider offers its variant.
 */
export function ProviderServicesForm({
  providerId,
  services,
  subscriptions,
  locations,
  scope,
  canEdit,
  groups = [],
  title = 'Diensten',
  description = 'Vink de diensten aan die je aanbiedt. Kies per dienst eventueel een andere locatie.',
}: {
  providerId: string;
  services: ProviderServiceOption[];
  subscriptions: ProviderSubscription[];
  locations: LocationOption[];
  scope: EditorScope;
  canEdit: boolean;
  groups?: ProviderOfferingGroup[];
  title?: string;
  description?: string;
}) {
  const [state, formAction] = useActionState(setProviderServicesAction, IDLE_STATE);
  const subscribed = new Map(subscriptions.map((row) => [row.serviceId, row.locationId]));
  // Inactive services stay listed only while subscribed, so they can be removed.
  const visible = services.filter((service) => service.isActive || subscribed.has(service.id));
  const byId = new Map(visible.map((service) => [service.id, service]));

  const placed = new Set<string>();
  const sections = groups
    .map((group) => ({
      group,
      rows: group.variants.flatMap((variant) => {
        const service = byId.get(variant.serviceId);
        if (!service || placed.has(service.id)) return [];
        placed.add(service.id);
        return [{ service, label: variant.label }];
      }),
    }))
    .filter((section) => section.rows.length > 0);
  const others = visible.filter((service) => !placed.has(service.id));

  const row = (service: ProviderServiceOption, label = '') => (
    <div
      key={service.id}
      className="flex flex-col gap-2 border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="serviceIds"
          value={service.id}
          defaultChecked={subscribed.has(service.id)}
          className="size-4 rounded border-input accent-primary"
        />
        <span className="font-medium">{label || service.name}</span>
        {label ? <span className="text-xs text-muted-foreground">{service.name}</span> : null}
        <span className="text-xs text-muted-foreground">{service.durationMinutes} min</span>
        {!service.isActive ? <Badge variant="secondary">Inactief</Badge> : null}
      </label>
      <Select
        name={`location:${service.id}`}
        defaultValue={subscribed.get(service.id) ?? ''}
        aria-label={`Locatie voor ${label ? `${label} (${service.name})` : service.name}`}
        className="sm:w-72"
      >
        <option value="">
          {service.locationName
            ? `Locatie van de dienst (${service.locationName})`
            : 'Mijn standaardlocatie'}
        </option>
        {locations.map((location) => (
          <option key={location.id} value={location.id}>
            {locationOptionLabel(location)}
          </option>
        ))}
      </Select>
    </div>
  );

  return (
    <SectionCard title={title} description={description}>
      <form action={formAction} className="flex flex-col gap-3">
        <ScopeFields providerId={providerId} scope={scope} />
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">Er zijn nog geen diensten.</p>
        ) : (
          <fieldset disabled={!canEdit} className="flex flex-col gap-4">
            {sections.map(({ group, rows }) => (
              <div key={group.title} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base leading-tight">{group.title}</h3>
                  <Badge
                    variant={group.bookable ? 'success' : 'secondary'}
                    className={badgeTone(group.bookable ? 'success' : 'secondary')}
                  >
                    {group.bookable ? 'Rechtstreeks online te boeken' : 'Nu niet online te boeken'}
                  </Badge>
                </div>
                {rows.map(({ service, label }) => row(service, label))}
              </div>
            ))}
            {others.length > 0 ? (
              <div className="flex flex-col gap-2">
                {sections.length > 0 ? (
                  <h3 className="text-base leading-tight">Andere diensten</h3>
                ) : null}
                {others.map((service) => row(service))}
              </div>
            ) : null}
          </fieldset>
        )}
        <StatusMessage state={state} />
        {canEdit && visible.length > 0 ? (
          <div>
            <SubmitButton>Opslaan</SubmitButton>
          </div>
        ) : null}
      </form>
    </SectionCard>
  );
}
