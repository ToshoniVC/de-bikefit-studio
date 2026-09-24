import { useId } from 'react';
import { LEGAL_LINKS } from '@/lib/studio/legal';
import {
  BIKE_TYPES,
  NOTES_MAX,
  type DetailsField,
  type DetailsMode,
  type DetailsValues,
} from './details';

type FieldErrors = Partial<Record<DetailsField, string>>;

/**
 * Step 4 — "Jouw gegevens". Labels are short and in the voice of the copy deck
 * (`content/booking.html`): "Wat zit je dwars?" rather than "symptomen".
 *
 * The form adapts to the fit:
 *  - jeugdfit (`guardian`): the contact fields move to the parent, with the
 *    child's name and age as separate fields;
 *  - a fit at the customer's place (`address`): an address block appears.
 *
 * Every input has a visible label; errors are tied to their field with
 * `aria-describedby` + `aria-invalid`, and the widget moves focus to the first
 * invalid field on submit.
 */
export function DetailsForm({
  mode,
  values,
  errors,
  formError,
  submitting,
  cancelUntilHours,
  onChange,
  onSubmit,
}: {
  mode: DetailsMode;
  values: DetailsValues;
  errors: FieldErrors;
  formError: string;
  submitting: boolean;
  cancelUntilHours: number;
  onChange: (field: DetailsField, value: string) => void;
  onSubmit: () => void;
}) {
  const formId = useId();
  const field = (name: DetailsField) => ({
    id: `${formId}-${name}`,
    name,
    value: values[name],
    error: errors[name],
    onChange: (value: string) => onChange(name, value),
  });

  return (
    <form
      className="studio-booking__form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!submitting) onSubmit();
      }}
    >
      {mode.guardian ? (
        <>
          <fieldset className="studio-booking__fieldset">
            <legend className="studio-booking__legend-title">Je kind</legend>
            <div className="studio-booking__row">
              <TextField {...field('childName')} label="Naam van je kind" autoComplete="off" />
              <TextField
                {...field('childAge')}
                label="Leeftijd van je kind"
                inputMode="numeric"
                autoComplete="off"
              />
            </div>
          </fieldset>
          <fieldset className="studio-booking__fieldset">
            <legend className="studio-booking__legend-title">Jij, als ouder</legend>
            <TextField {...field('guardianName')} label="Je naam" autoComplete="name" />
            <div className="studio-booking__row">
              <TextField
                {...field('guardianEmail')}
                label="E-mail"
                type="email"
                autoComplete="email"
                hint="Hier komt de bevestiging naartoe."
              />
              <TextField
                {...field('guardianPhone')}
                label="Telefoon"
                type="tel"
                autoComplete="tel"
              />
            </div>
          </fieldset>
        </>
      ) : (
        <fieldset className="studio-booking__fieldset">
          <legend className="studio-booking__legend-title">Jouw gegevens</legend>
          <TextField {...field('name')} label="Voornaam en naam" autoComplete="name" />
          <div className="studio-booking__row">
            <TextField
              {...field('email')}
              label="E-mail"
              type="email"
              autoComplete="email"
              hint="Hier komt de bevestiging naartoe."
            />
            <TextField {...field('phone')} label="Telefoon" type="tel" autoComplete="tel" />
          </div>
          <div className="studio-booking__row">
            <TextField
              {...field('age')}
              label="Leeftijd"
              optional
              inputMode="numeric"
              autoComplete="off"
            />
          </div>
        </fieldset>
      )}

      {mode.address ? (
        <fieldset className="studio-booking__fieldset">
          <legend className="studio-booking__legend-title">Waar mogen we langskomen?</legend>
          <div className="studio-booking__row">
            <TextField
              {...field('street')}
              label="Straat en nummer"
              autoComplete="street-address"
            />
            <TextField
              {...field('city')}
              label="Postcode en gemeente"
              autoComplete="address-level2"
            />
          </div>
        </fieldset>
      ) : null}

      <fieldset className="studio-booking__fieldset">
        <legend className="studio-booking__legend-title">
          Jouw fiets <span className="studio-booking__optional">(optioneel)</span>
        </legend>
        <p className="studio-booking__hint studio-booking__hint--lead">
          Helpt ons om voor te bereiden.
        </p>
        <div className="studio-booking__row">
          <SelectField
            {...field('bikeType')}
            label="Type"
            optional
            options={BIKE_TYPES}
            placeholder="Kies een type"
          />
          <TextField
            {...field('bikeModel')}
            label="Merk en model"
            optional
            hint="Als je het weet."
            autoComplete="off"
          />
        </div>
      </fieldset>

      <TextField
        {...field('notes')}
        label="Wat zit je dwars?"
        optional
        multiline
        hint="Optioneel. Alles wat je hier deelt over klachten of je gezondheid, delen we enkel met je bikefitter en bewaren we tot drie jaar na je laatste afspraak. Door dit in te vullen geef je daar uitdrukkelijk toestemming voor."
        maxLength={NOTES_MAX}
      />

      {/* Honeypot: off-screen, out of the tab order and hidden from assistive
          technology. A person never fills it in; a form-filling bot does. */}
      <div className="studio-booking__honeypot" aria-hidden="true">
        <label htmlFor={`${formId}-website`}>Website</label>
        <input
          id={`${formId}-website`}
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={values.website}
          onChange={(event) => onChange('website', event.target.value)}
        />
      </div>

      {formError ? (
        <p className="studio-booking__alert" role="alert">
          {formError}
        </p>
      ) : null}

      <div className="studio-booking__actions">
        <button
          type="submit"
          className="studio-btn studio-btn--primary"
          disabled={submitting}
          aria-disabled={submitting}
        >
          {submitting ? 'Even geduld…' : 'Afspraak bevestigen'}
          {submitting ? null : (
            <span className="studio-btn__arrow" aria-hidden="true">
              &rarr;
            </span>
          )}
        </button>
        <p className="studio-booking__reassure">
          Je krijgt meteen een bevestiging per e-mail. Vragen? We antwoorden binnen 24 uur.
          Annuleren kan kosteloos tot {cancelUntilHours} uur voor je afspraak, via de link in die
          e-mail. Door te boeken ga je akkoord met onze{' '}
          <a href={LEGAL_LINKS.terms} target="_blank" rel="noopener">
            algemene voorwaarden
          </a>{' '}
          en{' '}
          <a href={LEGAL_LINKS.privacy} target="_blank" rel="noopener">
            privacyverklaring
          </a>
          .
        </p>
      </div>
    </form>
  );
}

type BaseFieldProps = {
  id: string;
  name: DetailsField;
  label: string;
  value: string;
  error?: string;
  hint?: string;
  optional?: boolean;
  onChange: (value: string) => void;
};

function describedBy(id: string, hint?: string, error?: string): string | undefined {
  const ids = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

function FieldShell({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: Pick<BaseFieldProps, 'id' | 'label' | 'hint' | 'error' | 'optional'> & {
  children: React.ReactNode;
}) {
  return (
    <div className="studio-booking__field" data-invalid={error ? 'true' : undefined}>
      <label className="studio-booking__label" htmlFor={id}>
        {label}
        {optional ? <span className="studio-booking__optional"> (optioneel)</span> : null}
      </label>
      {children}
      {hint ? (
        <p className="studio-booking__hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="studio-booking__error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function TextField({
  id,
  name,
  label,
  value,
  error,
  hint,
  optional,
  onChange,
  type = 'text',
  multiline = false,
  inputMode,
  autoComplete,
  maxLength,
}: BaseFieldProps & {
  type?: 'text' | 'email' | 'tel';
  multiline?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  autoComplete?: string;
  maxLength?: number;
}) {
  const common = {
    id,
    name,
    value,
    className: 'studio-booking__input',
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy(id, hint, error),
    'aria-required': optional ? undefined : true,
    maxLength,
  };

  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optional={optional}>
      {multiline ? (
        <textarea {...common} rows={4} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input
          {...common}
          type={type}
          inputMode={inputMode}
          autoComplete={autoComplete}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </FieldShell>
  );
}

function SelectField({
  id,
  name,
  label,
  value,
  error,
  hint,
  optional,
  onChange,
  options,
  placeholder,
}: BaseFieldProps & { options: readonly string[]; placeholder: string }) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optional={optional}>
      <select
        id={id}
        name={name}
        value={value}
        className="studio-booking__input studio-booking__select"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}
