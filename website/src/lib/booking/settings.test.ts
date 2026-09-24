import { describe, expect, it } from 'vitest';
import { DEFAULT_BOOKING_RULES, parseBookingRules } from './settings';

describe('parseBookingRules', () => {
  it('returns the documented defaults when nothing is stored', () => {
    expect(DEFAULT_BOOKING_RULES).toMatchObject({
      slotStepMinutes: 30,
      minNoticeHours: 24,
      horizonDays: 56,
      defaultBufferAfterMinutes: 15,
      cancelUntilHours: 48,
      timezone: 'Europe/Brussels',
      showProviderChoice: true,
    });
    expect(parseBookingRules(undefined)).toEqual(DEFAULT_BOOKING_RULES);
    expect(parseBookingRules(null)).toEqual(DEFAULT_BOOKING_RULES);
    expect(parseBookingRules({})).toEqual(DEFAULT_BOOKING_RULES);
  });

  it('merges a partial value with the defaults', () => {
    expect(parseBookingRules({ slotStepMinutes: 15, horizonDays: 90 })).toEqual({
      ...DEFAULT_BOOKING_RULES,
      slotStepMinutes: 15,
      horizonDays: 90,
    });
  });

  it('accepts the boundaries of every numeric range', () => {
    const edges = {
      slotStepMinutes: 5,
      minNoticeHours: 0,
      horizonDays: 730,
      defaultBufferAfterMinutes: 240,
      cancelUntilHours: 1440,
    };
    expect(parseBookingRules(edges)).toMatchObject(edges);
  });

  it.each([
    ['slotStepMinutes below 5', { slotStepMinutes: 4 }],
    ['slotStepMinutes above 240', { slotStepMinutes: 241 }],
    ['a fractional slot step', { slotStepMinutes: 7.5 }],
    ['negative minimum notice', { minNoticeHours: -1 }],
    ['a zero-day horizon', { horizonDays: 0 }],
    ['a horizon beyond two years', { horizonDays: 731 }],
    ['a buffer above 240 minutes', { defaultBufferAfterMinutes: 241 }],
    ['a numeric string', { horizonDays: '30' }],
    ['an empty time zone', { timezone: '' }],
  ])('falls back to the defaults for %s', (_label, value) => {
    expect(parseBookingRules(value)).toEqual(DEFAULT_BOOKING_RULES);
  });

  it('drops the whole stored value, not only the bad field, when one field is invalid', () => {
    expect(parseBookingRules({ slotStepMinutes: 1, horizonDays: 10 }).horizonDays).toBe(56);
  });

  it('falls back to the defaults for non-object values and strips unknown keys', () => {
    for (const value of ['abc', 42, true, []]) {
      expect(parseBookingRules(value)).toEqual(DEFAULT_BOOKING_RULES);
    }
    expect(parseBookingRules({ unknown: 1 })).not.toHaveProperty('unknown');
  });

  it('keeps a valid IANA time zone', () => {
    expect(parseBookingRules({ timezone: 'Europe/Amsterdam' }).timezone).toBe('Europe/Amsterdam');
  });

  // Regression: the booking schema only checks `min(1)`, so an unknown zone
  // used to survive parsing and make the slot engine throw a RangeError.
  it('falls back to Europe/Brussels for an unknown time zone', () => {
    expect(parseBookingRules({ timezone: 'Mars/Olympus_Mons' }).timezone).toBe('Europe/Brussels');
  });

  it('keeps the other stored rules when only the time zone is unknown', () => {
    expect(parseBookingRules({ timezone: 'Mars/Olympus_Mons', horizonDays: 90 })).toEqual({
      ...DEFAULT_BOOKING_RULES,
      horizonDays: 90,
    });
  });
});
