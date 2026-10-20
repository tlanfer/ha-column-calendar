import { TZDate } from '@date-fns/tz';
import { describe, expect, it } from 'vitest';
import {
  formatDateTimeRange,
  formatDayNumber,
  formatRangeLabel,
  formatTime,
  formatWeekday,
  useAmPm,
} from '../src/format';
import type { CalendarEvent, DateRange, HaTimeFormat, HomeAssistant } from '../src/types';

// Deliberately far from the test process zone (and from UTC).
const TZ = 'Asia/Tokyo';

const hass = (language: string, time_format: HaTimeFormat = 'language') =>
  ({
    language,
    locale: { language, time_format, first_weekday: 'language', time_zone: 'server' },
  }) as unknown as HomeAssistant;

/** Intl uses narrow/thin/no-break spaces; normalize them for readable assertions. */
const n = (s: string) => s.replace(/\s/g, ' ');

const day = (iso: string) => new TZDate(`${iso}T00:00`, TZ);

const rangeOf = (first: string, last: string): DateRange => ({
  start: day(first),
  end: new Date(day(last).getTime() + 86_400_000),
  days: [day(first), day(last)],
});

const event = (start: Date, end: Date, allDay = false): CalendarEvent => ({
  entity: 'calendar.x',
  calendarName: 'X',
  color: '#000',
  summary: 'S',
  start,
  end,
  allDay,
});

// 22:05 in Tokyo, 13:05 UTC.
const instant = new Date('2026-10-20T13:05:00Z');

describe('useAmPm', () => {
  it('follows explicit settings and the language default', () => {
    expect(useAmPm(hass('de', '12'))).toBe(true);
    expect(useAmPm(hass('en', '24'))).toBe(false);
    expect(useAmPm(hass('en'))).toBe(true);
    expect(useAmPm(hass('de'))).toBe(false);
    expect(typeof useAmPm(hass('de', 'system'))).toBe('boolean');
  });
});

describe('formatTime', () => {
  it('renders in the given tz, not the process tz', () => {
    expect(n(formatTime(instant, hass('en'), TZ))).toBe('10:05 PM');
    expect(formatTime(instant, hass('de'), TZ)).toBe('22:05');
    expect(formatTime(instant, hass('de'), 'UTC')).toBe('13:05');
  });

  it('honors forced 12h / 24h', () => {
    expect(formatTime(instant, hass('en', '24'), TZ)).toBe('22:05');
    expect(n(formatTime(instant, hass('de', '12'), TZ))).toBe('10:05 PM');
    // Midnight never renders as 24:xx.
    expect(formatTime(new Date('2026-10-20T15:05:00Z'), hass('en', '24'), TZ)).toBe('00:05');
  });

  it('pads hours in 24h mode', () => {
    expect(formatTime(new Date('2026-10-20T00:30:00Z'), hass('de'), TZ)).toBe('09:30');
  });
});

describe('formatWeekday', () => {
  it('uppercases the short weekday in the given tz', () => {
    expect(formatWeekday(instant, hass('en'), TZ)).toBe('TUE');
    expect(formatWeekday(instant, hass('de'), TZ)).toMatch(/^DI\.?$/);
    // 13:05 UTC is still Tuesday in UTC, but 23:30 UTC Mon is Tuesday in Tokyo.
    expect(formatWeekday(new Date('2026-10-19T23:30:00Z'), hass('en'), TZ)).toBe('TUE');
    expect(formatWeekday(new Date('2026-10-19T23:30:00Z'), hass('en'), 'UTC')).toBe('MON');
  });
});

describe('formatDayNumber', () => {
  it('returns plain digits in the given tz', () => {
    expect(formatDayNumber(new Date('2026-10-19T23:30:00Z'), TZ)).toBe('20');
    expect(formatDayNumber(new Date('2026-10-19T23:30:00Z'), 'UTC')).toBe('19');
  });
});

describe('formatRangeLabel', () => {
  it('same month', () => {
    expect(n(formatRangeLabel(rangeOf('2026-10-19', '2026-10-25'), hass('en'), TZ))).toBe(
      'October 19 – 25, 2026',
    );
    expect(n(formatRangeLabel(rangeOf('2026-10-19', '2026-10-25'), hass('de'), TZ))).toBe(
      '19.–25. Oktober 2026',
    );
  });

  it('cross month and cross year', () => {
    expect(n(formatRangeLabel(rangeOf('2026-10-29', '2026-11-04'), hass('en'), TZ))).toBe(
      'October 29 – November 4, 2026',
    );
    expect(n(formatRangeLabel(rangeOf('2026-12-29', '2027-01-04'), hass('de'), TZ))).toBe(
      '29. Dezember 2026 – 4. Januar 2027',
    );
  });

  it('single day', () => {
    expect(n(formatRangeLabel(rangeOf('2026-10-20', '2026-10-20'), hass('en'), TZ))).toBe(
      'October 20, 2026',
    );
  });

  it('uses the last inclusive day, not the exclusive end', () => {
    const r = rangeOf('2026-10-19', '2026-10-25');
    expect(n(formatRangeLabel(r, hass('en'), TZ))).toMatch(/– 25, 2026$/);
  });
});

describe('formatDateTimeRange', () => {
  it('all-day single and multi day (exclusive end)', () => {
    const single = event(day('2026-10-20'), day('2026-10-21'), true);
    expect(n(formatDateTimeRange(single, hass('en'), TZ))).toBe('Tue, Oct 20, 2026');
    const multi = event(day('2026-10-20'), day('2026-10-23'), true);
    expect(n(formatDateTimeRange(multi, hass('en'), TZ))).toBe('Tue, Oct 20 – Thu, Oct 22, 2026');
    expect(n(formatDateTimeRange(multi, hass('de'), TZ))).toContain('22. Okt. 2026');
  });

  it('timed same day', () => {
    const ev = event(new Date('2026-10-20T00:00:00Z'), new Date('2026-10-20T01:30:00Z'));
    expect(n(formatDateTimeRange(ev, hass('en'), TZ))).toBe('Tue, Oct 20, 2026, 9:00 – 10:30 AM');
    const de = n(formatDateTimeRange(ev, hass('de'), TZ));
    expect(de).toContain('20. Okt. 2026');
    expect(de).toMatch(/09:00\s?–\s?10:30/);
  });

  it('timed across midnight includes both dates', () => {
    const ev = event(new Date('2026-10-20T13:00:00Z'), new Date('2026-10-20T17:30:00Z'));
    expect(n(formatDateTimeRange(ev, hass('en'), TZ))).toBe(
      'Tue, Oct 20, 2026, 10:00 PM – Wed, Oct 21, 2026, 2:30 AM',
    );
    const de = n(formatDateTimeRange(ev, hass('de', '24'), TZ));
    expect(de).toContain('22:00');
    expect(de).toContain('21. Okt. 2026, 02:30');
  });
});
