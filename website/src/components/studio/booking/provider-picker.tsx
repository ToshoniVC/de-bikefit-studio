import type { BookingProviderOption } from './types';

/** `null` is "Iedereen": whoever is free; the beheerder assigns afterwards. */
export type ProviderChoice = string | null;

/**
 * Step 1 — with whom. Only rendered when the provider choice is switched on
 * and more than one provider is bookable; otherwise the widget starts at the
 * service with "Iedereen". A specific provider narrows the next steps to
 * their own services and agenda; "Iedereen" shows every free moment and
 * leaves the choice of provider to the beheerder, who tells the customer by
 * e-mail.
 */
export function ProviderPicker({
  providers,
  selected,
  onSelect,
}: {
  providers: BookingProviderOption[];
  /** `undefined` while nothing has been chosen yet. */
  selected: ProviderChoice | undefined;
  onSelect: (choice: ProviderChoice) => void;
}) {
  return (
    <div className="studio-booking__options" role="group" aria-label="Kies bij wie">
      <button
        type="button"
        className="studio-booking__option"
        aria-pressed={selected === null}
        onClick={() => onSelect(null)}
      >
        <span className="studio-booking__option-title">Iedereen</span>
        <span className="studio-booking__option-body">
          Maakt niet uit — toon alle vrije momenten. Bij wie je terechtkomt, laten we je per e-mail
          weten.
        </span>
      </button>

      {providers.map((provider) => {
        const places = provider.locations.map((location) => location.label).filter(Boolean);
        return (
          <button
            key={provider.id}
            type="button"
            className="studio-booking__option"
            aria-pressed={selected === provider.id}
            onClick={() => onSelect(provider.id)}
          >
            <span className="studio-booking__option-title">{provider.name}</span>
            {places.length > 0 ? (
              <span className="studio-booking__option-meta">{places.join(' · ')}</span>
            ) : null}
            {provider.bio ? (
              <span className="studio-booking__option-body">{provider.bio}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
