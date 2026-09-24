import { useId, useRef, useState } from 'react';
import {
  WEEKDAYS_NL,
  WEEKDAYS_SHORT_NL,
  addDays,
  longDate,
  monthOf,
  monthTitle,
  monthWeeks,
  weekdayIndex,
  type Ym,
  type Ymd,
} from './dates';

/**
 * Step 3a — the month view. Monday-first, Dutch names, days with at least one
 * free slot marked and clickable; every other day stays visible but inert.
 *
 * Keyboard: one Tab stop for the whole month (roving `tabIndex`); the arrow
 * keys move a day or a week, Home/End jump to the start/end of the week, and
 * Enter/Space pick the focused day. Days without availability keep their focus
 * stop (`aria-disabled`, not `disabled`) so the arrows never skip silently.
 */
export function MonthCalendar({
  month,
  todayYmd,
  lastYmd,
  availableDays,
  selectedYmd,
  loading,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onSelectDay,
}: {
  month: Ym;
  todayYmd: Ymd;
  /** Last bookable day (today + horizon). */
  lastYmd: Ymd;
  availableDays: ReadonlySet<Ymd>;
  selectedYmd: Ymd | null;
  loading: boolean;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onSelectDay: (ymd: Ymd) => void;
}) {
  const titleId = useId();
  const tableRef = useRef<HTMLTableElement>(null);
  const [focusYmd, setFocusYmd] = useState<Ymd | null>(null);

  const weeks = monthWeeks(month);
  const days = weeks.flat().filter((day): day is Ymd => day !== null);
  const firstAvailable = days.find((day) => availableDays.has(day));
  const firstInRange = days.find((day) => day >= todayYmd && day <= lastYmd);

  const rovingYmd =
    focusYmd && monthOf(focusYmd) === month
      ? focusYmd
      : selectedYmd && monthOf(selectedYmd) === month
        ? selectedYmd
        : (firstAvailable ?? firstInRange ?? days[0]);

  function onKeyDown(event: React.KeyboardEvent<HTMLTableElement>) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-ymd]');
    const current = button?.dataset.ymd;
    if (!current) return;

    let next: Ymd;
    switch (event.key) {
      case 'ArrowLeft':
        next = addDays(current, -1);
        break;
      case 'ArrowRight':
        next = addDays(current, 1);
        break;
      case 'ArrowUp':
        next = addDays(current, -7);
        break;
      case 'ArrowDown':
        next = addDays(current, 7);
        break;
      case 'Home':
        next = addDays(current, -weekdayIndex(current));
        break;
      case 'End':
        next = addDays(current, 6 - weekdayIndex(current));
        break;
      default:
        return;
    }
    event.preventDefault();
    if (monthOf(next) !== month) return;

    const target = tableRef.current?.querySelector<HTMLButtonElement>(`button[data-ymd="${next}"]`);
    if (target) {
      setFocusYmd(next);
      target.focus();
    }
  }

  return (
    <div className="studio-booking__cal-wrap">
      <div className="studio-booking__cal-head">
        <button
          type="button"
          className="studio-booking__cal-nav"
          onClick={onPrev}
          disabled={!canPrev}
          aria-label="Vorige maand"
        >
          <span aria-hidden="true">&larr;</span>
        </button>
        <p className="studio-booking__cal-title" id={titleId} aria-live="polite">
          {monthTitle(month)}
        </p>
        <button
          type="button"
          className="studio-booking__cal-nav"
          onClick={onNext}
          disabled={!canNext}
          aria-label="Volgende maand"
        >
          <span aria-hidden="true">&rarr;</span>
        </button>
      </div>

      <table
        ref={tableRef}
        className="studio-booking__cal"
        aria-labelledby={titleId}
        aria-busy={loading}
        onKeyDown={onKeyDown}
      >
        <thead>
          <tr>
            {WEEKDAYS_SHORT_NL.map((short, index) => (
              <th key={short} scope="col" abbr={WEEKDAYS_NL[index]}>
                {short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week.find(Boolean) ?? 'leeg'}>
              {week.map((ymd, index) => {
                if (!ymd) return <td key={`leeg-${index}`} />;
                const available = !loading && availableDays.has(ymd);
                const selected = ymd === selectedYmd;
                return (
                  <td key={ymd}>
                    <button
                      type="button"
                      className="studio-booking__day"
                      data-ymd={ymd}
                      data-available={available ? 'true' : 'false'}
                      data-today={ymd === todayYmd ? 'true' : undefined}
                      tabIndex={ymd === rovingYmd ? 0 : -1}
                      aria-pressed={selected}
                      aria-disabled={!available}
                      aria-label={`${longDate(ymd)}${available ? ', vrije momenten' : ', geen vrije momenten'}`}
                      onFocus={() => setFocusYmd(ymd)}
                      onClick={() => {
                        if (available) onSelectDay(ymd);
                      }}
                    >
                      {Number(ymd.slice(8))}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <p className="studio-booking__legend" aria-hidden="true">
        <span className="studio-booking__legend-mark" /> vrije momenten
      </p>
    </div>
  );
}
