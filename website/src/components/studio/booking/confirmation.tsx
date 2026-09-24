import { BookingSummaryList } from './booking-summary';

/**
 * The last step: what, when, where and with whom, plus what happens next
 * (the confirmation e-mail and how cancelling works). The heading takes focus
 * when this panel appears, so a screen reader announces the result.
 */
export function Confirmation({
  title,
  text,
  serviceName,
  durationMinutes,
  providerName,
  startsAt,
  endsAt,
  timezone,
  where,
  email,
  cancelUntilHours,
  phoneLabel,
  phoneHref,
  onReset,
}: {
  title: string;
  text: string;
  serviceName: string;
  durationMinutes: number;
  providerName: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  where: string;
  email: string;
  cancelUntilHours: number;
  phoneLabel: string;
  phoneHref: string;
  onReset: () => void;
}) {
  return (
    <div className="studio-booking__confirm">
      <p className="studio-eyebrow">Bevestigd</p>
      <h3 className="studio-booking__confirm-title" tabIndex={-1} data-step-heading="done">
        {title}
      </h3>
      {text ? <p className="studio-booking__confirm-text">{text}</p> : null}

      <BookingSummaryList
        serviceName={serviceName}
        durationMinutes={durationMinutes}
        startsAt={startsAt}
        endsAt={endsAt}
        timezone={timezone}
        where={where}
        providerName={providerName}
      >
        <div>
          <dt>Bevestiging</dt>
          <dd>
            Je ontvangt een bevestiging per e-mail op <strong>{email}</strong>, met de afspraak als
            agenda-bijlage.
          </dd>
        </div>
      </BookingSummaryList>

      <CancelNote
        cancelUntilHours={cancelUntilHours}
        phoneLabel={phoneLabel}
        phoneHref={phoneHref}
      />

      <p className="studio-booking__actions">
        <button type="button" className="studio-btn studio-btn--ghost" onClick={onReset}>
          Nog een afspraak maken
        </button>
      </p>
    </div>
  );
}

/** How cancelling works, in plain words. Shared with `/afspraak/bevestigd`. */
export function CancelNote({
  cancelUntilHours,
  phoneLabel,
  phoneHref,
}: {
  cancelUntilHours: number;
  phoneLabel: string;
  phoneHref: string;
}) {
  return (
    <p className="studio-booking__confirm-text">
      Kan je toch niet? In je bevestigingsmail staat een link waarmee je annuleert, tot{' '}
      {cancelUntilHours} uur voor je afspraak.
      {phoneLabel && phoneHref ? (
        <>
          {' '}
          Later nog iets wijzigen? Bel ons op <a href={phoneHref}>{phoneLabel}</a>.
        </>
      ) : null}
    </p>
  );
}
