'use client';

import { useEffect, useRef, useState } from 'react';
import { bookAction } from '@/lib/booking/public-actions';
import { Confirmation } from './confirmation';
import {
  addDays,
  addMonths,
  instantToTime,
  instantToYmd,
  longDate,
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
import { narrowChoices, serviceSummary } from './service-choice';
import { ServicePicker } from './service-picker';
import { groupDaySlots, slotLocationIds } from './slot-grouping';
import { SlotList, slotKey } from './slot-list';
import { StepItem, type BookingStep as Step, type StepState } from './step-item';
import { useMonthAvailability } from './use-month-availability';
import { useServiceChoice } from './use-service-choice';
import {
  PENDING_PROVIDER_TEXT,
  type BookActionResult,
  type BookingLocationOption,
  type BookingProviderOption,
  type BookingServiceOption,
  type BookingSlot,
  type BookingWidgetProps,
} from './types';

/**
 * The public booking flow:
 *
 *   (aanbieder of "Iedereen") → dienst → dag in de maandkalender → uur →
 *   gegevens → bevestiging
 *
 * The current step is *derived* from what has been chosen, never stored, so
 * "Wijzigen" on an earlier step is just clearing that choice. Availability is
 * fetched per (service, provider, month) through `availabilityAction`
 * (`use-month-availability.ts`) and kept in a small in-memory cache.
 *
 * Bij wie (17 Oct 2026): a specific provider narrows the services to what
 * they offer and the calendar to their agenda. "Iedereen" shows every free
 * moment, one per time and location, without names: the beheerder assigns
 * the booking afterwards and the customer hears by e-mail. Where: a slot
 * carries its location (a provider may work from several places); it is
 * shown next to the time when more than one place is in play and decides
 * whether the form asks for an address.
 *
 * `initialServiceId` preselects a service (from `/afspraak?dienst=…`, resolved
 * on the server); `context` names the offer the visitor came from. `choices`
 * puts the services an offer links to under that offer (Volwassene / Jeugd
 * under "Bikefit – huidige fiets"); `serviceId` stays the one thing booked.
 *
 * Accessibility: every choice is a real `<button>` with `aria-pressed`; each
 * step heading takes focus when that step opens (only after the visitor has
 * interacted, so a page load never jumps); status lines are `role="status"`
 * and errors `role="alert"`.
 */

type Confirmed = {
  serviceName: string;
  durationMinutes: number;
  providerName: string;
  startsAt: string;
  endsAt: string;
  where: string;
  email: string;
};

const GENERIC_ERROR = 'Er ging iets mis bij het boeken. Probeer het opnieuw.';
const SLOT_TAKEN = 'Dit moment is net geboekt. Kies een ander moment.';

function offersService(provider: BookingProviderOption, serviceId: string): boolean {
  return provider.services.some((entry) => entry.serviceId === serviceId);
}

export function BookingWidget({
  services,
  locations,
  choices: givenChoices,
  providers,
  rules,
  copy,
  todayYmd,
  initialServiceId = null,
  context = null,
  notice: introNotice = '',
}: BookingWidgetProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const interacted = useRef(false);
  /** Where the widget lived before the confirmation URL replaced it. */
  const returnPath = useRef<string | null>(null);

  const choice = useServiceChoice({
    services,
    choices: givenChoices,
    initialServiceId,
    onChange: () => {
      interacted.current = true;
      resetWhen();
    },
  });
  const { serviceId } = choice;
  const [providerChoice, setProviderChoice] = useState<ProviderChoice | undefined>(undefined);
  const [month, setMonth] = useState<Ym>(monthOf(todayYmd));
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

  // --- who --------------------------------------------------------------------
  const providerStep = rules.showProviderChoice && providers.length > 1;
  const providerId: string | null = providerStep ? (providerChoice ?? null) : null;
  const chosenProvider = providerId
    ? (providers.find((provider) => provider.id === providerId) ?? null)
    : null;
  const providerNames = Object.fromEntries(
    providers.map((provider) => [provider.id, provider.name]),
  );
  /** Admin sort order (the order `listPublicProviders` returns). */
  const providerRank = new Map(providers.map((provider, index) => [provider.id, index]));

  // --- what -------------------------------------------------------------------
  const visibleServices = chosenProvider
    ? services.filter((service) => offersService(chosenProvider, service.id))
    : services;
  const visibleIds = new Set(visibleServices.map((service) => service.id));
  const visibleChoices = narrowChoices(choice.choices, visibleIds);
  const service = services.find((item) => item.id === serviceId && visibleIds.has(item.id)) ?? null;
  // Back on "Bij wie?" with a service already chosen: only who offers it.
  const providersForPicker = service
    ? providers.filter((provider) => offersService(provider, service.id))
    : providers;
  const providersForService = service
    ? providers.filter((provider) => offersService(provider, service.id))
    : [];
  // "Iedereen" with several providers: one button per time and location.
  const onePerStart = providerId === null && providersForService.length > 1;

  const step: Step = confirmed
    ? 'done'
    : providerStep && providerChoice === undefined
      ? 'provider'
      : !service
        ? 'service'
        : !slot
          ? 'when'
          : 'details';

  // --- when -------------------------------------------------------------------
  const availability = useMonthAvailability({
    serviceId: service?.id ?? null,
    providerId,
    month,
    active: step === 'when',
    todayYmd,
    lastYmd,
  });
  const { monthState, loading } = availability;
  const monthSlots = monthState?.status === 'ready' ? monthState.slots : [];
  const slotsByDay = groupDaySlots(monthSlots, {
    timezone: tz,
    todayYmd,
    lastYmd,
    providerRank,
    onePerStart,
  });
  const availableDays = new Set(slotsByDay.keys());
  const daySlots = day ? (slotsByDay.get(day) ?? []) : [];
  const canPrev = month > firstMonth;
  const canNext = month < lastMonth;

  // --- where --------------------------------------------------------------------
  const locationsById = new Map(locations.map((location) => [location.id, location]));
  const locationLabels = Object.fromEntries(
    locations.map((location) => [location.id, location.label]),
  );
  const showLocation = slotLocationIds(monthSlots).size > 1;
  // The slot knows where it is; a slot without a location falls back to the
  // provider's resolved entry, then the service's own location (as before).
  function locationFor(
    option: BookingServiceOption,
    chosen: BookingSlot | null,
  ): BookingLocationOption | null {
    if (chosen?.locationId) return locationsById.get(chosen.locationId) ?? null;
    const provider = chosen ? providers.find((item) => item.id === chosen.providerId) : null;
    const entry = provider?.services.find((item) => item.serviceId === option.id);
    return entry?.location ?? option.location;
  }
  const location = service && slot ? locationFor(service, slot) : null;
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

  function chooseProvider(next: ProviderChoice) {
    interacted.current = true;
    setProviderChoice(next);
    const provider = next ? providers.find((item) => item.id === next) : null;
    const offered = provider
      ? services.filter((item) => offersService(provider, item.id))
      : services;
    if (serviceId && !offered.some((item) => item.id === serviceId)) {
      choice.clear();
    } else if (!serviceId && offered.length === 1) {
      choice.choose(offered[0].id);
    } else {
      resetWhen();
    }
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
    availability.clear();
    choice.reset();
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
        // "Iedereen" sends no provider: the server picks who holds the slot
        // and the beheerder assigns. A chosen provider is sent as such.
        providerId,
        locationId: slot.locationId,
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
        // The booked catalogue service as the server stored it (e.g. "Jeugdfit").
        serviceName: booked.serviceName || service.name,
        durationMinutes: service.durationMinutes,
        providerName: booked.assignmentPending
          ? PENDING_PROVIDER_TEXT
          : booked.providerName || (providerNames[slot.providerId] ?? ''),
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
      availability.retry();
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
    ...(providerStep ? (['provider'] as Step[]) : []),
    'service',
    'when',
    'details',
  ];
  const stateOf = (id: Step): StepState => {
    const at = order.indexOf(step);
    const index = order.indexOf(id);
    return index < at ? 'done' : index === at ? 'active' : 'upcoming';
  };
  const numberOf = (id: Step) => order.indexOf(id) + 1;

  const slotWhere =
    slot && showLocation && slot.locationId ? (locationLabels[slot.locationId] ?? '') : '';
  const whenSummary = slot
    ? `${shortDate(instantToYmd(slot.startsAt, tz))}, ${instantToTime(slot.startsAt, tz)}${
        slotWhere ? ` · ${slotWhere}` : ''
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
      {context ? (
        <p className="studio-booking__context">
          Je boekt voor <strong>{context.label}</strong>.{' '}
          <a href={context.href}>Meer over deze dienst</a>
        </p>
      ) : null}
      {introNotice ? (
        <p className="studio-booking__context" role="status">
          {introNotice}
        </p>
      ) : null}
      <ol className="studio-booking__steps">
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
              providers={providersForPicker}
              selected={providerChoice}
              onSelect={chooseProvider}
            />
          </StepItem>
        ) : null}

        <StepItem
          id="service"
          number={numberOf('service')}
          title="Kies je fit"
          state={stateOf('service')}
          summary={serviceSummary(service, choice.offer)}
          onEdit={visibleServices.length > 1 ? choice.clear : undefined}
        >
          <ServicePicker
            services={visibleServices}
            choices={visibleChoices}
            selectedId={serviceId}
            openOffer={choice.openOffer}
            onSelect={choice.choose}
            onOpenOffer={(slug) => {
              interacted.current = true;
              choice.open(slug);
            }}
          />
        </StepItem>

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
                    onClick={availability.retry}
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
                  locationLabels={locationLabels}
                  showLocation={showLocation}
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
