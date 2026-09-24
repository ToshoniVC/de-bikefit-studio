import { describe, expect, it } from 'vitest';
import {
  addDaysYmd,
  diffDaysYmd,
  eachDayYmd,
  formatSlot,
  formatTimeRange,
  hhmmToMinutes,
  instantToLocal,
  isExactLocalTime,
  isValidYmd,
  localMinutesToInstant,
  minutesToHhmm,
  todayYmd,
  weekdayOfYmd,
} from './time';

// Europe/Brussels switches to winter time on 2026-10-25 (03:00 CEST → 02:00 CET)
// and to summer time on 2027-03-28 (02:00 CET → 03:00 CEST).

describe('localMinutesToInstant', () => {
  it('converts local wall-clock minutes to UTC with the offset of that date', () => {
    expect(localMinutesToInstant('2026-10-24', 540).toISOString()).toBe('2026-10-24T07:00:00.000Z');
    expect(localMinutesToInstant('2026-10-25', 540).toISOString()).toBe('2026-10-25T08:00:00.000Z');
    expect(localMinutesToInstant('2026-12-01', 0).toISOString()).toBe('2026-11-30T23:00:00.000Z');
  });

  it('accepts minute 1440 as next midnight, so DST days last 25 and 23 hours', () => {
    const hours = (date: string) =>
      (localMinutesToInstant(date, 1440).getTime() - localMinutesToInstant(date, 0).getTime()) /
      3_600_000;
    expect(localMinutesToInstant('2026-10-25', 1440).toISOString()).toBe(
      '2026-10-25T23:00:00.000Z',
    );
    expect(hours('2026-10-25')).toBe(25);
    expect(hours('2027-03-28')).toBe(23);
    expect(hours('2026-10-24')).toBe(24);
  });

  it('resolves a spring-forward gap one hour later and an ambiguous fall-back time to its later occurrence', () => {
    // 02:30 does not exist on 2027-03-28 → 03:30 CEST.
    expect(localMinutesToInstant('2027-03-28', 150).toISOString()).toBe('2027-03-28T01:30:00.000Z');
    // 02:30 exists twice on 2026-10-25 → the CET one.
    expect(localMinutesToInstant('2026-10-25', 150).toISOString()).toBe('2026-10-25T01:30:00.000Z');
  });
});

describe('instantToLocal and isExactLocalTime', () => {
  it('reads the local date, minute and weekday of an instant', () => {
    expect(instantToLocal('2026-10-24T22:30:00Z')).toEqual({
      dateYmd: '2026-10-25',
      minute: 30,
      weekday: 0,
    });
    // Both 02:30s of the fall-back night read as minute 150.
    expect(instantToLocal('2026-10-25T00:30:00Z').minute).toBe(150);
    expect(instantToLocal('2026-10-25T01:30:00Z').minute).toBe(150);
  });

  it('flags local times that do not exist or exist twice', () => {
    expect(isExactLocalTime('2026-10-24', 150)).toBe(true);
    expect(isExactLocalTime('2026-10-25', 90)).toBe(true);
    expect(isExactLocalTime('2026-10-25', 120)).toBe(false);
    expect(isExactLocalTime('2026-10-25', 150)).toBe(false);
    expect(isExactLocalTime('2026-10-25', 180)).toBe(true);
    expect(isExactLocalTime('2027-03-28', 120)).toBe(false);
    expect(isExactLocalTime('2027-03-28', 150)).toBe(false);
    expect(isExactLocalTime('2027-03-28', 180)).toBe(true);
  });
});

describe('todayYmd', () => {
  it('returns the local date in Brussels, which can differ from the UTC date', () => {
    expect(todayYmd('2026-10-24T21:59:59Z')).toBe('2026-10-24');
    expect(todayYmd('2026-10-24T22:00:00Z')).toBe('2026-10-25');
    expect(todayYmd(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
    expect(todayYmd('2026-12-31T23:30:00Z', 'UTC')).toBe('2026-12-31');
  });
});

describe('formatting', () => {
  it('formatSlot writes the Dutch e-mail label in local time', () => {
    expect(formatSlot('2026-10-24T07:30:00Z')).toBe('zaterdag 24 oktober 2026 om 09:30');
    expect(formatSlot('2026-10-25T08:00:00Z')).toBe('zondag 25 oktober 2026 om 09:00');
    expect(formatSlot(new Date('2027-03-28T07:00:00Z'))).toBe('zondag 28 maart 2027 om 09:00');
  });

  it('formatTimeRange joins local start and end times with an en dash', () => {
    expect(formatTimeRange('2026-10-25T08:00:00Z', '2026-10-25T09:30:00Z')).toBe('09:00 – 10:30');
  });
});

describe('isValidYmd', () => {
  it('accepts real calendar dates only', () => {
    for (const valid of ['2026-10-25', '2027-03-28', '2028-02-29', '2026-12-31']) {
      expect(isValidYmd(valid), valid).toBe(true);
    }
    for (const invalid of [
      '2026-02-29',
      '2026-04-31',
      '2026-13-01',
      '2026-00-10',
      '2026-1-01',
      '26-10-25',
      '',
      '2026-10-25T00:00',
    ]) {
      expect(isValidYmd(invalid), invalid).toBe(false);
    }
  });
});

describe('minutesToHhmm and hhmmToMinutes', () => {
  it('formats minutes as zero-padded HH:mm', () => {
    expect(minutesToHhmm(0)).toBe('00:00');
    expect(minutesToHhmm(570)).toBe('09:30');
    expect(minutesToHhmm(1439)).toBe('23:59');
    expect(minutesToHhmm(1440)).toBe('24:00');
  });

  it('parses HH:mm, allowing one-digit hours, whitespace and 24:00', () => {
    expect(hhmmToMinutes('09:30')).toBe(570);
    expect(hhmmToMinutes('9:30')).toBe(570);
    expect(hhmmToMinutes(' 18:00 ')).toBe(1080);
    expect(hhmmToMinutes('00:00')).toBe(0);
    expect(hhmmToMinutes('24:00')).toBe(1440);
  });

  it('returns null for malformed or out-of-range times', () => {
    for (const bad of ['24:01', '25:00', '12:60', '0930', '9.30', '', 'ab:cd', '-1:00']) {
      expect(hhmmToMinutes(bad), bad).toBeNull();
    }
  });

  it('round-trips every quarter hour of the day', () => {
    for (let minute = 0; minute <= 1440; minute += 15) {
      expect(hhmmToMinutes(minutesToHhmm(minute))).toBe(minute);
    }
  });
});

describe('calendar arithmetic on YYYY-MM-DD', () => {
  it('adds, diffs and enumerates days independently of DST', () => {
    expect(addDaysYmd('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDaysYmd('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysYmd('2028-02-28', 1)).toBe('2028-02-29');
    expect(diffDaysYmd('2027-03-27', '2027-03-29')).toBe(2);
    expect(diffDaysYmd('2026-11-26', '2026-10-01')).toBe(-56);
    expect(eachDayYmd('2026-10-24', '2026-10-26')).toEqual([
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
    ]);
    expect(weekdayOfYmd('2026-10-25')).toBe(0);
    expect(weekdayOfYmd('2026-10-24')).toBe(6);
  });
});
