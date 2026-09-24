'use client';

import { useActionState, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
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
import {
  EXCEPTION_KIND_LABELS,
  WEEKDAY_LABELS,
  WEEKDAY_ORDER,
} from '@/components/admin/booking-labels';
import { badgeTone, FLASH_TONES } from '@/components/admin/tones';
import { hhmmToMinutes as timeToMinutes, minutesToHhmm as minutesToTime } from '@/lib/booking/time';
import { locationOptionLabel, type LocationOption } from '@/components/admin/services-manager';
import {
  setAvailabilityExceptionsAction,
  setBusinessHoursAction,
} from '@/lib/cms/actions/availability';
import {
  disconnectGoogleAction,
  setProviderServicesAction,
  updateProviderAction,
} from '@/lib/cms/actions/providers';
import { IDLE_STATE } from '@/lib/cms/actions/state';
import type { CmsAvailabilityExceptionKind } from '@/db/cms-schema';

/**
 * Cards for one provider. Used by `/admin/providers/[id]` (scope `any`, needs
 * `provider.manage`) and by `/admin/agenda` (scope `own`: the signed-in
 * provider's own row). The server actions resolve and re-check the scope; the
 * `providerId` sent along is never trusted on its own.
 */

export type EditorScope = 'own' | 'any';

export type ProviderProfile = {
  id: string;
  displayName: string;
  bio: string;
  phone: string | null;
  email: string | null;
  timezone: string;
  defaultLocationId: string | null;
  isActive: boolean;
  sortOrder: number;
};

export type ProviderServiceOption = {
  id: string;
  name: string;
  durationMinutes: number;
  isActive: boolean;
  /** The service's own location, if any (shown as the default in the override select). */
  locationName: string | null;
};

export type ProviderSubscription = { serviceId: string; locationId: string | null };

export type HoursRow = { weekday: number; startMinute: number; endMinute: number };

export type ExceptionRow = {
  date: string;
  kind: CmsAvailabilityExceptionKind;
  startMinute: number | null;
  endMinute: number | null;
  note: string | null;
};

export type GoogleStatus = {
  connected: boolean;
  email: string | null;
  /** Already formatted for display, or null. */
  connectedSince: string | null;
  error: string | null;
};

function ScopeFields({ providerId, scope }: { providerId: string; scope: EditorScope }) {
  return (
    <>
      <input type="hidden" name="providerId" value={providerId} />
      <input type="hidden" name="scope" value={scope} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export function ProviderProfileForm({
  provider,
  locations,
  scope,
  canEdit,
}: {
  provider: ProviderProfile;
  locations: LocationOption[];
  scope: EditorScope;
  canEdit: boolean;
}) {
  const [state, formAction] = useActionState(updateProviderAction, IDLE_STATE);
  const id = (name: string) => `provider-${provider.id}-${name}`;

  return (
    <SectionCard
      title="Profiel"
      description={
        scope === 'own'
          ? 'Zo verschijn je op de boekingspagina en in de e-mails.'
          : 'Zo verschijnt deze aanbieder op de boekingspagina en in de e-mails.'
      }
    >
      <form action={formAction} className="flex flex-col gap-3">
        <ScopeFields providerId={provider.id} scope={scope} />
        <fieldset disabled={!canEdit} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Weergavenaam" htmlFor={id('displayName')}>
              <Input
                id={id('displayName')}
                name="displayName"
                defaultValue={provider.displayName}
                required
              />
            </Field>
            <Field
              label="Publiek e-mailadres"
              htmlFor={id('email')}
              hint="Mag verschillen van je login. Ontvangt de meldingen van nieuwe afspraken."
            >
              <Input
                id={id('email')}
                name="email"
                type="email"
                defaultValue={provider.email ?? ''}
              />
            </Field>
            <Field label="Telefoon" htmlFor={id('phone')}>
              <Input id={id('phone')} name="phone" type="tel" defaultValue={provider.phone ?? ''} />
            </Field>
            <Field label="Tijdzone" htmlFor={id('timezone')} hint="Standaard Europe/Brussels.">
              <Input id={id('timezone')} name="timezone" defaultValue={provider.timezone} />
            </Field>
            <Field
              label="Standaardlocatie"
              htmlFor={id('defaultLocationId')}
              hint="Gebruikt voor diensten zonder eigen locatie."
            >
              <Select
                id={id('defaultLocationId')}
                name="defaultLocationId"
                defaultValue={provider.defaultLocationId ?? ''}
              >
                <option value="">Geen (algemene standaard)</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {locationOptionLabel(location)}
                  </option>
                ))}
              </Select>
            </Field>
            {scope === 'any' ? (
              <Field label="Volgorde" htmlFor={id('sortOrder')} hint="Lager staat eerst.">
                <Input
                  id={id('sortOrder')}
                  name="sortOrder"
                  type="number"
                  step={1}
                  defaultValue={provider.sortOrder}
                />
              </Field>
            ) : null}
          </div>
          <Field label="Korte bio" htmlFor={id('bio')}>
            <Textarea id={id('bio')} name="bio" rows={3} defaultValue={provider.bio} />
          </Field>
          {scope === 'any' ? (
            <CheckboxField
              name="isActive"
              label="Actief (boekbaar)"
              defaultChecked={provider.isActive}
              hint="Uit: niet meer te kiezen op de boekingspagina. Bestaande afspraken blijven."
            />
          ) : (
            <input type="hidden" name="isActive" value={provider.isActive ? 'true' : 'false'} />
          )}
        </fieldset>
        <StatusMessage state={state} />
        {canEdit ? (
          <div>
            <SubmitButton>Profiel opslaan</SubmitButton>
          </div>
        ) : null}
      </form>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Services (subscriptions with optional location override)
// ---------------------------------------------------------------------------

export function ProviderServicesForm({
  providerId,
  services,
  subscriptions,
  locations,
  scope,
  canEdit,
  description = 'Vink de diensten aan die je aanbiedt. Kies per dienst eventueel een andere locatie.',
}: {
  providerId: string;
  services: ProviderServiceOption[];
  subscriptions: ProviderSubscription[];
  locations: LocationOption[];
  scope: EditorScope;
  canEdit: boolean;
  description?: string;
}) {
  const [state, formAction] = useActionState(setProviderServicesAction, IDLE_STATE);
  const subscribed = new Map(subscriptions.map((row) => [row.serviceId, row.locationId]));
  // Inactive services stay listed only while subscribed, so they can be removed.
  const visible = services.filter((service) => service.isActive || subscribed.has(service.id));

  return (
    <SectionCard title="Diensten" description={description}>
      <form action={formAction} className="flex flex-col gap-3">
        <ScopeFields providerId={providerId} scope={scope} />
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">Er zijn nog geen diensten.</p>
        ) : (
          <fieldset disabled={!canEdit} className="flex flex-col gap-2">
            {visible.map((service) => (
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
                  <span className="font-medium">{service.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {service.durationMinutes} min
                  </span>
                  {!service.isActive ? <Badge variant="secondary">Inactief</Badge> : null}
                </label>
                <Select
                  name={`location:${service.id}`}
                  defaultValue={subscribed.get(service.id) ?? ''}
                  aria-label={`Locatie voor ${service.name}`}
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
            ))}
          </fieldset>
        )}
        <StatusMessage state={state} />
        {canEdit && visible.length > 0 ? (
          <div>
            <SubmitButton>Diensten opslaan</SubmitButton>
          </div>
        ) : null}
      </form>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Business hours
// ---------------------------------------------------------------------------

type HoursDraft = { key: number; weekday: number; start: string; end: string };

let draftKey = 0;
const nextKey = () => ++draftKey;

function hoursProblem(rows: HoursDraft[]): string | null {
  for (const weekday of WEEKDAY_ORDER) {
    const ranges = rows
      .filter((row) => row.weekday === weekday)
      .map((row) => ({ start: timeToMinutes(row.start), end: timeToMinutes(row.end) }));
    for (const range of ranges) {
      if (range.start === null || range.end === null) {
        return `${WEEKDAY_LABELS[weekday]}: vul een geldig begin- en einduur in.`;
      }
      if (range.end <= range.start) {
        return `${WEEKDAY_LABELS[weekday]}: het einduur moet na het beginuur liggen.`;
      }
    }
    const sorted = [...ranges].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
    for (let index = 1; index < sorted.length; index += 1) {
      if ((sorted[index].start ?? 0) < (sorted[index - 1].end ?? 0)) {
        return `${WEEKDAY_LABELS[weekday]}: tijdvakken overlappen.`;
      }
    }
  }
  return null;
}

export function BusinessHoursEditor({
  providerId,
  hours,
  scope,
  canEdit,
}: {
  providerId: string;
  hours: HoursRow[];
  scope: EditorScope;
  canEdit: boolean;
}) {
  const [state, formAction] = useActionState(setBusinessHoursAction, IDLE_STATE);
  const [rows, setRows] = useState<HoursDraft[]>(() =>
    [...hours]
      .sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute)
      .map((row) => ({
        key: nextKey(),
        weekday: row.weekday,
        start: minutesToTime(row.startMinute),
        end: minutesToTime(row.endMinute),
      })),
  );

  const problem = hoursProblem(rows);
  const payload = JSON.stringify(
    rows.map((row) => ({
      weekday: row.weekday,
      startMinute: timeToMinutes(row.start),
      endMinute: timeToMinutes(row.end),
    })),
  );

  const update = (key: number, patch: Partial<HoursDraft>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const remove = (key: number) => setRows((current) => current.filter((row) => row.key !== key));
  const add = (weekday: number) =>
    setRows((current) => {
      const last = current.filter((row) => row.weekday === weekday).at(-1);
      const start = last ? last.end : '09:00';
      const startMinutes = timeToMinutes(start) ?? 540;
      const end = minutesToTime(Math.min(1440, startMinutes + 240));
      return [...current, { key: nextKey(), weekday, start, end }];
    });
  const copyMonday = () =>
    setRows((current) => {
      const monday = current.filter((row) => row.weekday === 1);
      const others = current.filter((row) => row.weekday < 1 || row.weekday > 5);
      const copies = [2, 3, 4, 5].flatMap((weekday) =>
        monday.map((row) => ({ ...row, key: nextKey(), weekday })),
      );
      return [...others, ...monday, ...copies];
    });

  return (
    <SectionCard
      title="Openingsuren"
      description="Per weekdag, meerdere tijdvakken mogelijk. Een dag zonder tijdvak is gesloten."
    >
      <form action={formAction} className="flex flex-col gap-3">
        <ScopeFields providerId={providerId} scope={scope} />
        <input type="hidden" name="hours" value={payload} />
        <fieldset disabled={!canEdit} className="flex flex-col gap-2">
          {WEEKDAY_ORDER.map((weekday) => {
            const dayRows = rows.filter((row) => row.weekday === weekday);
            return (
              <div
                key={weekday}
                className="flex flex-col gap-2 border border-border bg-background p-3 sm:flex-row sm:items-start"
              >
                <span className="w-28 shrink-0 pt-1 font-ds-display text-base font-semibold tracking-[0.04em] uppercase">
                  {WEEKDAY_LABELS[weekday]}
                </span>
                <div className="flex flex-1 flex-col gap-1.5">
                  {dayRows.length === 0 ? (
                    <span className="pt-1 text-xs text-muted-foreground">Gesloten</span>
                  ) : null}
                  {dayRows.map((row) => (
                    <div key={row.key} className="flex flex-wrap items-center gap-1.5">
                      <Input
                        type="time"
                        step={300}
                        value={row.start}
                        onChange={(event) => update(row.key, { start: event.target.value })}
                        aria-label={`${WEEKDAY_LABELS[weekday]} van`}
                        className="w-28"
                      />
                      <span className="text-xs text-muted-foreground">tot</span>
                      <Input
                        type="time"
                        step={300}
                        value={row.end === '24:00' ? '23:59' : row.end}
                        onChange={(event) => update(row.key, { end: event.target.value })}
                        aria-label={`${WEEKDAY_LABELS[weekday]} tot`}
                        className="w-28"
                      />
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        onClick={() => remove(row.key)}
                      >
                        Verwijderen
                      </Button>
                    </div>
                  ))}
                </div>
                <Button type="button" size="xs" variant="outline" onClick={() => add(weekday)}>
                  + Tijdvak
                </Button>
              </div>
            );
          })}
        </fieldset>
        {problem ? <p className={`px-3 py-2 text-sm ${FLASH_TONES.warning}`}>{problem}</p> : null}
        <StatusMessage state={state} />
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <SubmitButton {...(problem ? { disabled: true } : {})}>
              Openingsuren opslaan
            </SubmitButton>
            <Button type="button" size="sm" variant="outline" onClick={copyMonday}>
              Maandag kopiëren naar di–vr
            </Button>
          </div>
        ) : null}
      </form>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Exceptions (closed days, extra open ranges)
// ---------------------------------------------------------------------------

type ExceptionDraft = {
  key: number;
  date: string;
  kind: CmsAvailabilityExceptionKind;
  start: string;
  end: string;
  note: string;
};

function exceptionsProblem(rows: ExceptionDraft[], todayYmd: string): string | null {
  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return 'Vul voor elke uitzondering een datum in.';
    if (row.date < todayYmd) return `${row.date} ligt in het verleden.`;
    const start = row.start ? timeToMinutes(row.start) : null;
    const end = row.end ? timeToMinutes(row.end) : null;
    if (row.kind === 'open' && (start === null || end === null)) {
      return `${row.date}: een extra open tijdvak heeft een begin- en einduur nodig.`;
    }
    if ((row.start && start === null) || (row.end && end === null)) {
      return `${row.date}: ongeldig uur.`;
    }
    if ((start === null) !== (end === null)) {
      return `${row.date}: vul beide uren in, of geen van beide voor een volledige dag.`;
    }
    if (start !== null && end !== null && end <= start) {
      return `${row.date}: het einduur moet na het beginuur liggen.`;
    }
  }
  return null;
}

export function ExceptionsEditor({
  providerId,
  exceptions,
  todayYmd,
  scope,
  canEdit,
}: {
  providerId: string;
  exceptions: ExceptionRow[];
  /** Today in Europe/Brussels, `YYYY-MM-DD`: default and minimum date (past rows are history). */
  todayYmd: string;
  scope: EditorScope;
  canEdit: boolean;
}) {
  const [state, formAction] = useActionState(setAvailabilityExceptionsAction, IDLE_STATE);
  const [rows, setRows] = useState<ExceptionDraft[]>(() =>
    [...exceptions]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({
        key: nextKey(),
        date: row.date,
        kind: row.kind,
        start: row.startMinute === null ? '' : minutesToTime(row.startMinute),
        end: row.endMinute === null ? '' : minutesToTime(row.endMinute),
        note: row.note ?? '',
      })),
  );

  const problem = exceptionsProblem(rows, todayYmd);
  const payload = JSON.stringify(
    rows.map((row) => ({
      date: row.date,
      kind: row.kind,
      startMinute: row.start ? timeToMinutes(row.start) : null,
      endMinute: row.end ? timeToMinutes(row.end) : null,
      note: row.note.trim() || null,
    })),
  );

  const update = (key: number, patch: Partial<ExceptionDraft>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const remove = (key: number) => setRows((current) => current.filter((row) => row.key !== key));
  const add = () =>
    setRows((current) => [
      ...current,
      { key: nextKey(), date: todayYmd, kind: 'closed', start: '', end: '', note: '' },
    ]);

  return (
    <SectionCard
      title="Uitzonderingen"
      description="Verlof of een gesloten namiddag (gesloten), of een extra open tijdvak op een specifieke datum. Laat de uren leeg om een volledige dag te sluiten."
    >
      <form action={formAction} className="flex flex-col gap-3">
        <ScopeFields providerId={providerId} scope={scope} />
        <input type="hidden" name="exceptions" value={payload} />
        <fieldset disabled={!canEdit} className="flex flex-col gap-2">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Geen uitzonderingen.</p>
          ) : null}
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex flex-wrap items-center gap-1.5 border border-border bg-background p-3"
            >
              <Input
                type="date"
                min={todayYmd}
                value={row.date}
                onChange={(event) => update(row.key, { date: event.target.value })}
                aria-label="Datum"
                className="w-40"
              />
              <Select
                value={row.kind}
                onChange={(event) =>
                  update(row.key, { kind: event.target.value as CmsAvailabilityExceptionKind })
                }
                aria-label="Soort"
                className="w-32"
              >
                <option value="closed">{EXCEPTION_KIND_LABELS.closed}</option>
                <option value="open">{EXCEPTION_KIND_LABELS.open}</option>
              </Select>
              <Input
                type="time"
                step={300}
                value={row.start}
                onChange={(event) => update(row.key, { start: event.target.value })}
                aria-label="Van"
                className="w-28"
              />
              <span className="text-xs text-muted-foreground">tot</span>
              <Input
                type="time"
                step={300}
                value={row.end}
                onChange={(event) => update(row.key, { end: event.target.value })}
                aria-label="Tot"
                className="w-28"
              />
              <Input
                value={row.note}
                onChange={(event) => update(row.key, { note: event.target.value })}
                placeholder="Notitie"
                aria-label="Notitie"
                className="min-w-40 flex-1"
              />
              <Button type="button" size="xs" variant="ghost" onClick={() => remove(row.key)}>
                Verwijderen
              </Button>
            </div>
          ))}
        </fieldset>
        {problem ? <p className={`px-3 py-2 text-sm ${FLASH_TONES.warning}`}>{problem}</p> : null}
        <StatusMessage state={state} />
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <SubmitButton {...(problem ? { disabled: true } : {})}>
              Uitzonderingen opslaan
            </SubmitButton>
            <Button type="button" size="sm" variant="outline" onClick={add}>
              + Uitzondering
            </Button>
          </div>
        ) : null}
      </form>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Google Calendar connection
// ---------------------------------------------------------------------------

export function GoogleConnectionCard({
  providerId,
  google,
  scope,
  canConnect,
  configured,
}: {
  providerId: string;
  google: GoogleStatus;
  scope: EditorScope;
  canConnect: boolean;
  /** False when the server has no Google OAuth client configured. */
  configured: boolean;
}) {
  return (
    <SectionCard
      title="Google Agenda"
      description={
        scope === 'own'
          ? 'Bezette momenten in je Google Agenda worden niet aangeboden, en elke nieuwe afspraak komt erin te staan.'
          : 'Bezette momenten in de Google Agenda van deze aanbieder worden niet aangeboden, en elke nieuwe afspraak komt erin te staan.'
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {google.connected ? (
            <>
              <Badge
                variant={google.error ? 'warning' : 'success'}
                className={badgeTone(google.error ? 'warning' : 'success')}
              >
                Verbonden
              </Badge>
              <span>
                als <span className="font-medium">{google.email ?? 'onbekend account'}</span>
                {google.connectedSince ? ` sinds ${google.connectedSince}` : ''}
              </span>
            </>
          ) : (
            <Badge variant="secondary">Niet verbonden</Badge>
          )}
        </div>
        {google.error ? (
          <p className={`px-3 py-2 text-sm ${FLASH_TONES.error}`}>Laatste fout: {google.error}</p>
        ) : null}
        {!configured ? (
          <p className={`px-3 py-2 text-xs ${FLASH_TONES.info}`}>
            De Google-koppeling is nog niet ingesteld op de server (OAuth-client ontbreekt). Zonder
            koppeling tellen enkel de openingsuren en bestaande afspraken.
          </p>
        ) : null}
        {canConnect ? (
          <div className="flex flex-wrap items-start gap-2">
            {configured ? (
              <a
                href={`/api/google/oauth/start?provider=${encodeURIComponent(providerId)}&return=${scope === 'own' ? 'agenda' : 'provider'}`}
                data-slot="button"
                className={buttonVariants({
                  size: 'sm',
                  variant: google.connected ? 'outline' : 'default',
                })}
              >
                {google.connected ? 'Opnieuw koppelen' : 'Google Agenda koppelen'}
              </a>
            ) : null}
            {google.connected ? (
              <ActionForm action={disconnectGoogleAction} hidden={{ providerId, scope }}>
                <SubmitButton
                  variant="destructive"
                  confirm="Google Agenda ontkoppelen? Nieuwe afspraken komen dan niet meer in je agenda en bezette momenten worden niet meer gecontroleerd."
                >
                  Ontkoppelen
                </SubmitButton>
              </ActionForm>
            ) : null}
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
