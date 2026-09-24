'use client';

import { useEffect, useRef, useState } from 'react';
import { availabilityAction, bookAction } from '@/lib/booking/public-actions';
import { Confirmation } from './confirmation';
import {
  addDays,
  addMonths,
  durationLabel,
  firstDayOfMonth,
  instantToTime,
  instantToYmd,
  lastDayOfMonth,
  longDate,
  maxYmd,
  minYmd,
  monthOf,
  monthTitle,
  shortDate,
  type Ym,
  type Ymd,
} from './dates';
import {
  EMPTY_DETAILS,
  fieldOrder,
  formFieldFor,
  toBookInput,
  validateDetails,
  type DetailsField,
  type DetailsMode,
  type DetailsValues,
} from './details';
import { DetailsForm } from './details-form';
import { MonthCalendar } from './month-calendar';
import { ProviderPicker, type ProviderChoice } from './provider-picker';
import { ServicePicker } from './service-picker';
import { SlotList, slotKey } from './slot-list';
import type {
  AvailabilityActionResult,
  BookActionResult,
  BookingLocationOption,
  BookingServiceOption,
  BookingSlot,
  BookingWidgetProps,
} from './types';

/**
 * The public booking flow:
 *
 *   dienst → (aanbieder of "Iedereen") → dag in de maandkalender → uur →
 *   gegevens → bevestiging
 *
 * The current step is *derived* from what has been chosen, never stored, so
 * "Wijzigen" on an earlier step is just clearing that choice. Availability is
 * fetched per (service, provider, month) through `availabilityAction` and kept
 * in a small in-memory cache for the lifetime of the page.
 *
 * Accessibility: every choice is a real `<button>` with `aria-pressed`; each
 * step heading takes focus when that step opens (only after the visitor has
 * interacted, so a page load never jumps); status lines are `role="status"`
 * and errors `role="alert"`.
 */

type Step = 'service' | 'provider' | 'when' | 'details' | 'done';

type MonthState = { status: 'ready'; slots: BookingSlot[] } | { status: 'error'; message: string };

type Confirmed = {
  serviceName: string;
  durationMinutes: number;
  providerName: string;
  startsAt: string;
  endsAt: string;
  where: string;
  email: string;
};

const LOAD_ERROR = 'De agenda kon niet geladen worden. Probeer het opnieuw.';
const GENERIC_ERROR = 'Er ging iets mis bij het boeken. Probeer het opnieuw.';
const SLOT_TAKEN = 'Dit moment is net geboekt. Kies een ander moment.';

function cacheKey(serviceId: string, providerId: string | null, month: Ym): string {
  return `${serviceId}|${providerId ?? '*'}|${month}`;
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

export function BookingWidget({ services, providers, rules, copy, todayYmd }: BookingWidgetProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const interacted = useRef(false);
  /** Where the widget lived before the confirmation URL replaced it. */
  const returnPath = useRef<string | null>(null);

  const [serviceId, setServiceId] = useState<string | null>(
    services.length === 1 ? services[0].id : null,
  );
  const [providerChoice, setProviderChoice] = useState<ProviderChoice | undefined>(undefined);
  const [month, setMonth] = useState<Ym>(monthOf(todayYmd));
  const [months, setMonths] = useState<Record<string, MonthState>>({});
  const [day, setDay] = useState<Ymd | null>(null);
  const [slot, setSlot] = useState<BookingSlot | null>(null);
  const [values, setValues] = useState<DetailsValues>(EMPTY_DETAILS);
  const [errors, setErrors] = useState<Partial<Record<DetailsField, string>>>({});
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);

  const tz = rules.timezone;
  const firstMonth = monthOf(todayYmd);
  const lastYmd = addDays(todayYmd, rules.horizonDays);
  const lastMonth = monthOf(lastYmd);

  const service = services.find((item) => item.id === serviceId) ?? null;
  const providersForService = service
    ? providers.filter((provider) =>
        provider.services.some((entry) => entry.serviceId === service.id),
      )
    : [];
  const providerStep = rules.showProviderChoice && providersForService.length > 1;
  const providerId: string | null = providerStep ? (providerChoice ?? null) : null;
  const providerNames = Object.fromEntries(
    providers.map((provider) => [provider.id, provider.name]),
  );
  /** Admin sort order (the order `listPublicProviders` returns). */
  const providerRank = new Map(providers.map((provider, index) => [provider.id, index]));
  const sharedSlots = providerId === null && providersForService.length > 1;
  // "Iedereen" picked by the visitor: every provider's time is its own choice,
  // labelled with the name. Provider choice switched off by the admin: one
  // button per time, taken by the first free provider in admin order.
  const showSlotProvider = sharedSlots && rules.showProviderChoice;
  const onePerTime = sharedSlots && !rules.showProviderChoice;

  const step: Step = confirmed
    ? 'done'
    : !service
      ? 'service'
      : providerStep && providerChoice === undefined
        ? 'provider'
        : !slot
          ? 'when'
          : 'details';

  // --- availability for the visible month ------------------------------------
  const key = service ? cacheKey(service.id, providerId, month) : null;
  const monthState = key ? months[key] : undefined;
  const needsFetch = step === 'when' && key !== null && monthState === undefined;

  useEffect(() => {
    if (!needsFetch || !key || !serviceId) return;
    const fromYmd = maxYmd(firstDayOfMonth(month), todayYmd);
    const toYmd = minYmd(lastDayOfMonth(month), lastYmd);
    const request =
      fromYmd > toYmd
        ? Promise.resolve<AvailabilityActionResult>({ ok: true, slots: [] })
        : availabilityAction({ serviceId, providerId, fromYmd, toYmd }).catch(
            (): AvailabilityActionResult => ({ ok: false, message: LOAD_ERROR }),
          );
    void request.then((result) => {
      setMonths((previous) => ({
        ...previous,
        [key]: result.ok
          ? { status: 'ready', slots: result.slots }
          : { status: 'error', message: result.message || LOAD_ERROR },
      }));
    });
  }, [needsFetch, key, serviceId, providerId, month, todayYmd, lastYmd]);

  const loading = step === 'when' && monthState === undefined;
  const slotsByDay = new Map<Ymd, BookingSlot[]>();
  if (monthState?.status === 'ready') {
    for (const item of monthState.slots) {
      const ymd = instantToYmd(item.startsAt, tz);
      if (ymd < todayYmd || ymd > lastYmd) continue;
      const list = slotsByDay.get(ymd) ?? [];
      list.push(item);
      slotsByDay.set(ymd, list);
    }
    for (const [ymd, list] of slotsByDay) {
      list.sort(
        (a, b) =>
          a.startsAt.localeCompare(b.startsAt) ||
          (providerRank.get(a.providerId) ?? 0) - (providerRank.get(b.providerId) ?? 0),
      );
      if (onePerTime) {
        slotsByDay.set(
          ymd,
          list.filter((item, index) => index === 0 || item.startsAt !== list[index - 1].startsAt),
        );
      }
    }
  }
  const availableDays = new Set(slotsByDay.keys());
  const daySlots = day ? (slotsByDay.get(day) ?? []) : [];
  const canPrev = month > firstMonth;
  const canNext = month < lastMonth;

  // --- where the fit happens ---------------------------------------------------
  // Same order as `resolveLocationId()` in `@/lib/booking/content`: the
  // provider's entry is already resolved (override → service → provider
  // default → studio default), so it wins; the service's own location is the
  // fallback while no provider is known.
  function locationFor(
    option: BookingServiceOption,
    forProviderId: string | null,
  ): BookingLocationOption | null {
    const provider = forProviderId ? providers.find((item) => item.id === forProviderId) : null;
    const entry = provider?.services.find((item) => item.serviceId === option.id);
    return entry?.location ?? option.location;
  }

  const location = service && slot ? locationFor(service, slot.providerId) : null;
  const mode: DetailsMode = {
    guardian: service?.requiresGuardian ?? false,
    address: location?.kind === 'customer',
  };

  // --- focus management --------------------------------------------------------
  useEffect(() => {
    if (!interacted.current) return;
    rootRef.current?.querySelector<HTMLElement>(`[data-step-heading="${step}"]`)?.focus();
  }, [step]);

  function focusField(field: DetailsField) {
    rootRef.current?.querySelector<HTMLElement>(`[name="${field}"]`)?.focus();
  }

  // --- handlers -----------------------------------------------------------------
  function resetWhen() {
    setMonth(firstMonth);
    setDay(null);
    setSlot(null);
    setNotice('');
  }

  function chooseService(id: string) {
    interacted.current = true;
    setServiceId(id);
    setProviderChoice(undefined);
    resetWhen();
  }

  function chooseProvider(choice: ProviderChoice) {
    interacted.current = true;
    setProviderChoice(choice);
    resetWhen();
  }

  function goMonth(delta: number) {
    interacted.current = true;
    setMonth((current) => addMonths(current, delta));
    setDay(null);
  }

  function chooseDay(ymd: Ymd) {
    interacted.current = true;
    setDay(ymd);
    setNotice('');
  }

  function chooseSlot(next: BookingSlot) {
    interacted.current = true;
    setSlot(next);
    setErrors({});
    setFormError('');
  }

  function retryMonth() {
    if (key) setMonths((previous) => withoutKey(previous, key));
  }

  function editService() {
    interacted.current = true;
    setServiceId(null);
    setProviderChoice(undefined);
    resetWhen();
  }

  function editProvider() {
    interacted.current = true;
    setProviderChoice(undefined);
    resetWhen();
  }

  function editWhen() {
    interacted.current = true;
    setSlot(null);
  }

  function changeValue(field: DetailsField, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }));
    if (errors[field]) setErrors((previous) => ({ ...previous, [field]: undefined }));
  }

  function startOver() {
    interacted.current = true;
    if (returnPath.current) {
      window.history.replaceState(null, '', returnPath.current);
      returnPath.current = null;
    }
    setConfirmed(null);
    setMonths({});
    setServiceId(services.length === 1 ? services[0].id : null);
    setProviderChoice(undefined);
    resetWhen();
    setValues((previous) => ({ ...previous, notes: '', bikeType: '', bikeModel: '' }));
  }

  async function submit() {
    if (!service || !slot) return;

    const found = validateDetails(values, mode);
    const firstInvalid = fieldOrder(mode).find((field) => found[field]);
    setErrors(found);
    setFormError('');
    if (firstInvalid) {
      focusField(firstInvalid);
      return;
    }

    setSubmitting(true);
    const input = toBookInput(values, mode);
    let result: BookActionResult;
    try {
      result = await bookAction({
        serviceId: service.id,
        providerId: slot.providerId,
        startsAt: slot.startsAt,
        ...input,
      });
    } catch {
      result = { ok: false, code: 'error', message: GENERIC_ERROR, fieldErrors: {} };
    }
    setSubmitting(false);

    if (result.ok) {
      // Put the signed confirmation URL in the address bar (no navigation): a
      // refresh then shows this booking on /afspraak/bevestigd instead of an
      // empty form that invites booking twice.
      if (result.confirmationPath) {
        returnPath.current = `${window.location.pathname}${window.location.search}`;
        window.history.replaceState(null, '', result.confirmationPath);
      }
      // The server's summary is the truth (provider, times, location label);
      // the customer's own address is only echoed back from this form.
      const booked = result.booking;
      setConfirmed({
        serviceName: booked.serviceName || service.name,
        durationMinutes: service.durationMinutes,
        providerName: booked.providerName || (providerNames[slot.providerId] ?? ''),
        startsAt: booked.startsAt || slot.startsAt,
        endsAt: booked.endsAt || slot.endsAt,
        where: mode.address
          ? `Bij jou thuis: ${input.address}`
          : booked.locationLabel || (location?.label ?? ''),
        email: input.email,
      });
      return;
    }

    if (result.code === 'slot_taken') {
      if (key) setMonths((previous) => withoutKey(previous, key));
      setSlot(null);
      setNotice(SLOT_TAKEN);
      return;
    }

    const mapped: Partial<Record<DetailsField, string>> = {};
    for (const [inputKey, message] of Object.entries(result.fieldErrors)) {
      const field = formFieldFor(inputKey, mode);
      if (field) mapped[field] = message;
    }
    setErrors(mapped);
    setFormError(result.message || GENERIC_ERROR);
    const firstServerInvalid = fieldOrder(mode).find((field) => mapped[field]);
    if (firstServerInvalid) focusField(firstServerInvalid);
  }

  // --- render -------------------------------------------------------------------
  if (confirmed) {
    return (
      <div className="studio-booking" ref={rootRef}>
        <Confirmation
          title={copy.successTitle || 'Je afspraak staat vast'}
          text={copy.successText}
          serviceName={confirmed.serviceName}
          durationMinutes={confirmed.durationMinutes}
          providerName={confirmed.providerName}
          startsAt={confirmed.startsAt}
          endsAt={confirmed.endsAt}
          timezone={tz}
          where={confirmed.where}
          email={confirmed.email}
          cancelUntilHours={rules.cancelUntilHours}
          phoneLabel={copy.phoneLabel}
          phoneHref={copy.phoneHref}
          onReset={startOver}
        />
      </div>
    );
  }

  const order: Step[] = [
    'service',
    ...(providerStep ? (['provider'] as Step[]) : []),
    'when',
    'details',
  ];
  const stateOf = (id: Step): StepState => {
    const at = order.indexOf(step);
    const index = order.indexOf(id);
    return index < at ? 'done' : index === at ? 'active' : 'upcoming';
  };
  const numberOf = (id: Step) => order.indexOf(id) + 1;

  const whenSummary = slot
    ? `${shortDate(instantToYmd(slot.startsAt, tz))}, ${instantToTime(slot.startsAt, tz)}${
        showSlotProvider && providerNames[slot.providerId]
          ? ` bij ${providerNames[slot.providerId]}`
          : ''
      }`
    : '';

  let status = '';
  if (step === 'when') {
    if (loading) status = 'Vrije momenten laden…';
    else if (monthState?.status === 'error') status = monthState.message;
    else if (availableDays.size === 0) status = `Geen vrije momenten meer in ${monthTitle(month)}.`;
    else if (!day) status = 'Kies een dag met vrije momenten.';
    else if (daySlots.length === 0)
      status = `Geen vrije momenten meer op ${longDate(day)}. Kies een andere dag.`;
    else
      status = `${daySlots.length} ${daySlots.length === 1 ? 'vrij moment' : 'vrije momenten'} op ${longDate(day)}.`;
  }

  return (
    <div className="studio-booking" ref={rootRef}>
      <ol className="studio-booking__steps">
        <StepItem
          id="service"
          number={numberOf('service')}
          title="Kies je fit"
          state={stateOf('service')}
          summary={service ? `${service.name} · ${durationLabel(service.durationMinutes)}` : ''}
          onEdit={services.length > 1 ? editService : undefined}
        >
          <ServicePicker services={services} selectedId={serviceId} onSelect={chooseService} />
        </StepItem>

        {providerStep ? (
          <StepItem
            id="provider"
            number={numberOf('provider')}
            title="Bij wie?"
            state={stateOf('provider')}
            summary={
              providerChoice === null
                ? 'Iedereen'
                : providerChoice
                  ? (providerNames[providerChoice] ?? '')
                  : ''
            }
            onEdit={editProvider}
          >
            <ProviderPicker
              providers={providersForService}
              selected={providerChoice}
              onSelect={chooseProvider}
            />
          </StepItem>
        ) : null}

        <StepItem
          id="when"
          number={numberOf('when')}
          title="Kies een dag en uur"
          state={stateOf('when')}
          summary={whenSummary}
          onEdit={editWhen}
        >
          <div className="studio-booking__when">
            <MonthCalendar
              month={month}
              todayYmd={todayYmd}
              lastYmd={lastYmd}
              availableDays={availableDays}
              selectedYmd={day}
              loading={loading}
              canPrev={canPrev}
              canNext={canNext}
              onPrev={() => goMonth(-1)}
              onNext={() => goMonth(1)}
              onSelectDay={chooseDay}
            />

            <div className="studio-booking__day-panel">
              {notice ? (
                <p className="studio-booking__alert" role="alert">
                  {notice}
                </p>
              ) : null}
              <p className="studio-booking__status" role="status">
                {status}
              </p>

              {monthState?.status === 'error' ? (
                <p>
                  <button
                    type="button"
                    className="studio-btn studio-btn--outline"
                    onClick={retryMonth}
                  >
                    Opnieuw proberen
                  </button>
                </p>
              ) : null}

              {monthState?.status === 'ready' && availableDays.size === 0 && canNext ? (
                <p>
                  <button
                    type="button"
                    className="studio-btn studio-btn--outline"
                    onClick={() => goMonth(1)}
                  >
                    Bekijk {monthTitle(addMonths(month, 1))}
                  </button>
                </p>
              ) : null}

              {monthState?.status === 'ready' &&
              availableDays.size === 0 &&
              !canNext &&
              copy.phoneHref ? (
                <p className="studio-booking__hint">
                  Niets gevonden dat past? Bel ons op <a href={copy.phoneHref}>{copy.phoneLabel}</a>{' '}
                  en we zoeken samen een moment.
                </p>
              ) : null}

              {day && daySlots.length > 0 ? (
                <SlotList
                  slots={daySlots}
                  timezone={tz}
                  providerNames={providerNames}
                  showProvider={showSlotProvider}
                  selectedKey={slot ? slotKey(slot) : null}
                  onSelect={chooseSlot}
                />
              ) : null}
            </div>
          </div>
        </StepItem>

        <StepItem
          id="details"
          number={numberOf('details')}
          title="Jouw gegevens"
          state={stateOf('details')}
          summary=""
        >
          <DetailsForm
            mode={mode}
            values={values}
            errors={errors}
            formError={formError}
            submitting={submitting}
            cancelUntilHours={rules.cancelUntilHours}
            onChange={changeValue}
            onSubmit={() => void submit()}
          />
          {formError && copy.phoneHref ? (
            <p className="studio-booking__hint">
              Lukt het niet? Bel ons op <a href={copy.phoneHref}>{copy.phoneLabel}</a>.
            </p>
          ) : null}
        </StepItem>
      </ol>
    </div>
  );
}

type StepState = 'done' | 'active' | 'upcoming';

function StepItem({
  id,
  number,
  title,
  state,
  summary,
  onEdit,
  children,
}: {
  id: Step;
  number: number;
  title: string;
  state: StepState;
  summary: string;
  onEdit?: () => void;
  children: React.ReactNode;
}) {
  return (
    <li className="studio-booking__step" data-state={state}>
      <div className="studio-booking__step-head">
        <span className="studio-booking__step-num" aria-hidden="true">
          {String(number).padStart(2, '0')}
        </span>
        <div className="studio-booking__step-heading">
          <h3 className="studio-booking__step-title" tabIndex={-1} data-step-heading={id}>
            <span className="sr-only">Stap {number}: </span>
            {title}
          </h3>
          {state === 'done' && summary ? (
            <p className="studio-booking__step-summary">{summary}</p>
          ) : null}
        </div>
        {state === 'done' && onEdit ? (
          <button
            type="button"
            className="studio-booking__edit"
            onClick={onEdit}
            aria-label={`${title} — wijzigen`}
          >
            Wijzigen
          </button>
        ) : null}
      </div>
      {state === 'active' ? <div className="studio-booking__step-body">{children}</div> : null}
    </li>
  );
}
