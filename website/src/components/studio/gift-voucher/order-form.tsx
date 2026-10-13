'use client';

import { useId, useRef, useState } from 'react';
import { formatPrice } from '@/lib/booking/format';
import { orderGiftVoucherAction } from '@/lib/gift-voucher/actions';
import {
  GIFT_VOUCHER_LIMITS,
  GIFT_VOUCHER_MESSAGES,
  GIFT_VOUCHER_SUBMIT_LABEL,
  validateGiftVoucherOrder,
  type GiftVoucherField,
} from '@/lib/gift-voucher/order';
import { LEGAL_LINKS } from '@/lib/studio/legal';

type Values = Record<GiftVoucherField | 'website', string>;
type Errors = Partial<Record<GiftVoucherField, string>>;

const EMPTY: Values = { amount: '', message: '', name: '', email: '', phone: '', website: '' };
const FIELD_ORDER: GiftVoucherField[] = ['amount', 'message', 'name', 'email', 'phone'];

/** One id per filled-in form, so a repeated submit is recognised server-side. */
function newRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The "Cadeaubon" order form. The same field rules run here (instant
 * feedback) and on the server (the one that counts).
 *
 * Honest states only: "verstuurd" appears after the server reports that the
 * mail provider accepted the request. Anything else keeps every field as typed
 * and says the order was not sent, with the phone number as the way out. A
 * submit in flight blocks a second one (ref, not just the disabled button),
 * and the server ignores a repeat of a form it already sent.
 */
export function GiftVoucherForm({
  formTitle,
  sentTitle,
  sentText,
  headingTag,
  phoneLabel,
  phoneHref,
}: {
  formTitle: string;
  sentTitle: string;
  sentText: string;
  headingTag: 'h2' | 'h3';
  phoneLabel: string;
  phoneHref: string;
}) {
  const formId = useId();
  const Heading = headingTag;
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(false);
  const requestIdRef = useRef<string | null>(null);
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<{ amountCents: number; email: string } | null>(null);
  const hasPhone = Boolean(phoneLabel && phoneHref);

  function update(field: keyof Values, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    if (field !== 'website' && errors[field]) {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
  }

  function focusField(field: GiftVoucherField) {
    rootRef.current?.querySelector<HTMLElement>(`[name="${field}"]`)?.focus();
  }

  function showErrors(fieldErrors: Errors, message: string) {
    setErrors(fieldErrors);
    setFormError(message);
    const first = FIELD_ORDER.find((field) => fieldErrors[field]);
    if (first) focusField(first);
  }

  async function submit() {
    if (pendingRef.current) return;
    const check = validateGiftVoucherOrder(values);
    if (!check.ok) {
      showErrors(check.fieldErrors, GIFT_VOUCHER_MESSAGES.invalid);
      return;
    }

    requestIdRef.current ??= newRequestId();
    pendingRef.current = true;
    setPending(true);
    setFormError('');
    try {
      const result = await orderGiftVoucherAction({
        ...values,
        requestId: requestIdRef.current,
      });
      if (result.ok) {
        setSent({ amountCents: check.order.amountCents, email: check.order.email });
        requestAnimationFrame(() =>
          rootRef.current?.querySelector<HTMLElement>('[data-sent-heading]')?.focus(),
        );
        return;
      }
      showErrors(result.fieldErrors, result.message);
    } catch {
      setFormError(GIFT_VOUCHER_MESSAGES.notSent);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  function orderAnother() {
    requestIdRef.current = null;
    setValues((current) => ({
      ...EMPTY,
      name: current.name,
      email: current.email,
      phone: current.phone,
    }));
    setErrors({});
    setFormError('');
    setSent(null);
    requestAnimationFrame(() => focusField('amount'));
  }

  if (sent) {
    return (
      <div className="studio-booking studio-voucher" ref={rootRef}>
        <div className="studio-booking__confirm" role="status">
          <Heading className="studio-booking__confirm-title" tabIndex={-1} data-sent-heading>
            {sentTitle || 'Je bestelling is verstuurd'}
          </Heading>
          <p className="studio-booking__confirm-text">
            {sentText ||
              `Bedankt! We maken een factuur en een betaallink op en sturen die naar ${sent.email}.`}
          </p>
          <dl className="studio-booking__summary">
            <div>
              <dt>Bedrag</dt>
              <dd>{formatPrice(sent.amountCents)}</dd>
            </div>
          </dl>
          <button type="button" className="studio-btn studio-btn--ghost" onClick={orderAnother}>
            Nog een cadeaubon bestellen
          </button>
        </div>
      </div>
    );
  }

  const field = (name: GiftVoucherField) => ({
    id: `${formId}-${name}`,
    name,
    value: values[name],
    error: errors[name],
    onChange: (value: string) => update(name, value),
  });

  return (
    <div className="studio-booking studio-voucher" ref={rootRef}>
      {formTitle ? <Heading className="studio-booking__enquiry-title">{formTitle}</Heading> : null}
      {/* POST: a submit before hydration (or without JavaScript) must never put
          the visitor's name, e-mail and message in the URL and the access logs. */}
      <form
        className="studio-booking__form"
        method="post"
        noValidate
        aria-busy={pending}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset className="studio-booking__fieldset">
          <legend className="studio-booking__legend-title">Je cadeaubon</legend>
          <Field
            {...field('amount')}
            label="Bedrag in euro"
            hint="Kies zelf het bedrag, bijvoorbeeld 50 of 75,50."
            inputMode="decimal"
            autoComplete="off"
            maxLength={GIFT_VOUCHER_LIMITS.amount}
          />
          <Field
            {...field('message')}
            label="Persoonlijke boodschap"
            optional
            multiline
            hint={`Je tekst voor wie de cadeaubon krijgt, maximaal ${GIFT_VOUCHER_LIMITS.message} tekens.`}
            maxLength={GIFT_VOUCHER_LIMITS.message}
          />
        </fieldset>

        <fieldset className="studio-booking__fieldset">
          <legend className="studio-booking__legend-title">Jouw gegevens</legend>
          <Field
            {...field('name')}
            label="Voornaam en naam"
            autoComplete="name"
            maxLength={GIFT_VOUCHER_LIMITS.name}
          />
          <div className="studio-booking__row">
            <Field
              {...field('email')}
              label="E-mail"
              type="email"
              autoComplete="email"
              hint="Hierop sturen we je de factuur en de betaallink."
              maxLength={GIFT_VOUCHER_LIMITS.email}
            />
            <Field
              {...field('phone')}
              label="Telefoon"
              type="tel"
              optional
              autoComplete="tel"
              maxLength={GIFT_VOUCHER_LIMITS.phone}
            />
          </div>
        </fieldset>

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
            onChange={(event) => update('website', event.target.value)}
          />
        </div>

        {formError ? (
          <div className="studio-booking__alert" role="alert">
            <p>{formError}</p>
            {hasPhone && formError !== GIFT_VOUCHER_MESSAGES.invalid ? (
              <p>
                Bel ons op <a href={phoneHref}>{phoneLabel}</a>.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="studio-booking__actions">
          <button
            type="submit"
            className="studio-btn studio-btn--primary"
            disabled={pending}
            aria-disabled={pending}
          >
            {GIFT_VOUCHER_SUBMIT_LABEL}
          </button>
          <p className="studio-booking__reassure" aria-live="polite">
            {pending ? 'Even geduld, we versturen je bestelling…' : null}
          </p>
          <p className="studio-booking__reassure">
            Je betaalt nu nog niets. Na je bestelling sturen we je een factuur en een betaallink per
            e-mail. We gebruiken je gegevens enkel om je bestelling af te handelen; lees onze{' '}
            <a href={LEGAL_LINKS.privacy} target="_blank" rel="noopener">
              privacyverklaring
            </a>
            .
          </p>
        </div>
      </form>
    </div>
  );
}

function Field({
  id,
  name,
  label,
  value,
  error,
  hint,
  optional,
  multiline = false,
  type = 'text',
  inputMode,
  autoComplete,
  maxLength,
  onChange,
}: {
  id: string;
  name: GiftVoucherField;
  label: string;
  value: string;
  error?: string;
  hint?: string;
  optional?: boolean;
  multiline?: boolean;
  type?: 'text' | 'email' | 'tel';
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  autoComplete?: string;
  maxLength?: number;
  onChange: (value: string) => void;
}) {
  const describedBy =
    [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  const common = {
    id,
    name,
    value,
    className: 'studio-booking__input',
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
    'aria-required': optional ? undefined : true,
    maxLength,
  };

  return (
    <div className="studio-booking__field" data-invalid={error ? 'true' : undefined}>
      <label className="studio-booking__label" htmlFor={id}>
        {label}
        {optional ? <span className="studio-booking__optional"> (optioneel)</span> : null}
      </label>
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
