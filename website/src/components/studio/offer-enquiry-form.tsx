'use client';

import { useId, useRef, useState } from 'react';
import { sendOfferEnquiryAction } from '@/lib/offer-enquiry/actions';
import {
  OFFER_ENQUIRY_LIMITS,
  OFFER_ENQUIRY_MESSAGES,
  OFFER_ENQUIRY_SUBMIT_LABEL,
  validateOfferEnquiry,
  type OfferEnquiryField,
} from '@/lib/offer-enquiry/input';
import { AUDIENCE_LABELS } from '@/lib/offers/offering';
import { LEGAL_LINKS } from '@/lib/studio/legal';
import { PhoneField, TextField } from './booking/details-form';

type Values = Record<OfferEnquiryField | 'website', string>;
type Errors = Partial<Record<OfferEnquiryField, string>>;

const EMPTY: Values = { audience: '', name: '', email: '', phone: '', message: '', website: '' };
const FIELD_ORDER: OfferEnquiryField[] = ['audience', 'name', 'email', 'phone', 'message'];

/** One id per filled-in form, so a repeated submit is recognised server-side. */
function newRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The enquiry form on an offer page that is asked for rather than booked
 * online (Beheer → Aanbod → "Enkel aanvraag"). The same field rules run here
 * (instant feedback) and on the server (the one that counts).
 *
 * Honest states only, like the gift voucher form: "verstuurd" appears after
 * the server reports that the mail provider accepted the enquiry; anything
 * else keeps every field and says it was not sent, with the phone number as
 * the way out. A submit in flight blocks a second one, and the server ignores
 * a repeat of a form it already sent.
 */
export function OfferEnquiryForm({
  offerSlug,
  offerTitle,
  audiences,
  headingTag,
  phoneLabel,
  phoneHref,
}: {
  offerSlug: string;
  offerTitle: string;
  /** The offering's audience choices; empty for a single option. */
  audiences: ('adult' | 'youth')[];
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
  const [sentTo, setSentTo] = useState<string | null>(null);
  const hasPhone = Boolean(phoneLabel && phoneHref);

  function update(field: keyof Values, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    if (field !== 'website' && errors[field]) {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
  }

  function showErrors(fieldErrors: Errors, message: string) {
    setErrors(fieldErrors);
    setFormError(message);
    const first = FIELD_ORDER.find((field) => fieldErrors[field]);
    if (first) rootRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
  }

  async function submit() {
    if (pendingRef.current) return;
    const payload = { ...values, offerSlug };
    const check = validateOfferEnquiry(payload, audiences);
    if (!check.ok) {
      showErrors(check.fieldErrors, OFFER_ENQUIRY_MESSAGES.invalid);
      return;
    }

    requestIdRef.current ??= newRequestId();
    pendingRef.current = true;
    setPending(true);
    setFormError('');
    try {
      const result = await sendOfferEnquiryAction({ ...payload, requestId: requestIdRef.current });
      if (result.ok) {
        setSentTo(check.enquiry.email);
        requestAnimationFrame(() =>
          rootRef.current?.querySelector<HTMLElement>('[data-sent-heading]')?.focus(),
        );
        return;
      }
      showErrors(result.fieldErrors, result.message);
    } catch {
      setFormError(OFFER_ENQUIRY_MESSAGES.notSent);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  if (sentTo) {
    return (
      <div className="studio-booking studio-voucher" ref={rootRef}>
        <div className="studio-booking__confirm" role="status">
          <Heading className="studio-booking__confirm-title" tabIndex={-1} data-sent-heading>
            Je aanvraag is verstuurd
          </Heading>
          <p className="studio-booking__confirm-text">
            Bedankt! We bekijken je vraag over {offerTitle} en antwoorden je op {sentTo}.
          </p>
        </div>
      </div>
    );
  }

  const field = (name: Exclude<OfferEnquiryField, 'audience'>) => ({
    id: `${formId}-${name}`,
    name,
    value: values[name],
    error: errors[name],
    onChange: (value: string) => update(name, value),
  });

  return (
    <div className="studio-booking studio-voucher" ref={rootRef}>
      <Heading className="studio-booking__enquiry-title">Vraag {offerTitle} aan</Heading>
      <p className="studio-booking__reassure">
        Deze dienst plannen we samen in. Laat je gegevens en je vraag achter, dan nemen we contact
        met je op.
      </p>
      {/* POST: a submit before hydration must never put personal data in the URL. */}
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
        {audiences.length > 0 ? (
          <fieldset
            className="studio-booking__fieldset"
            aria-describedby={errors.audience ? `${formId}-audience-error` : undefined}
          >
            <legend className="studio-booking__legend-title">Voor wie?</legend>
            {audiences.map((audience) => (
              <label key={audience} className="studio-booking__label">
                <input
                  type="radio"
                  name="audience"
                  value={audience}
                  checked={values.audience === audience}
                  onChange={() => update('audience', audience)}
                />{' '}
                {AUDIENCE_LABELS[audience]}
              </label>
            ))}
            {errors.audience ? (
              <p className="studio-booking__error" id={`${formId}-audience-error`}>
                {errors.audience}
              </p>
            ) : null}
          </fieldset>
        ) : null}

        <fieldset className="studio-booking__fieldset">
          <legend className="studio-booking__legend-title">Jouw gegevens</legend>
          <TextField
            {...field('name')}
            label="Voornaam en naam"
            autoComplete="name"
            maxLength={OFFER_ENQUIRY_LIMITS.name}
          />
          <div className="studio-booking__row">
            <TextField
              {...field('email')}
              label="E-mail"
              type="email"
              autoComplete="email"
              hint="Hierop antwoorden we je."
              maxLength={OFFER_ENQUIRY_LIMITS.email}
            />
            <PhoneField {...field('phone')} optional />
          </div>
          <TextField
            {...field('message')}
            label="Je vraag"
            multiline
            hint="Bijvoorbeeld wat je wil bereiken, je fiets of wanneer het je past."
            maxLength={OFFER_ENQUIRY_LIMITS.message}
          />
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
            {hasPhone && formError !== OFFER_ENQUIRY_MESSAGES.invalid ? (
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
            {OFFER_ENQUIRY_SUBMIT_LABEL}
          </button>
          <p className="studio-booking__reassure" aria-live="polite">
            {pending ? 'Even geduld, we versturen je aanvraag…' : null}
          </p>
          <p className="studio-booking__reassure">
            We gebruiken je gegevens enkel om je aanvraag te beantwoorden; lees onze{' '}
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
