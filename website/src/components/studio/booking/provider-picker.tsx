import type { BookingProviderOption } from './types';

/** `null` is "Iedereen": every provider who offers the chosen fit. */
export type ProviderChoice = string | null;

/**
 * Step 2 — with whom. Only rendered when the provider choice is switched on
 * and more than one provider offers the chosen fit; otherwise the widget goes
 * straight to the calendar with "Iedereen".
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
          Maakt niet uit — toon alle vrije momenten.
        </span>
      </button>

      {providers.map((provider) => (
        <button
          key={provider.id}
          type="button"
          className="studio-booking__option"
          aria-pressed={selected === provider.id}
          onClick={() => onSelect(provider.id)}
        >
          <span className="studio-booking__option-title">{provider.name}</span>
          {provider.bio ? (
            <span className="studio-booking__option-body">{provider.bio}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
