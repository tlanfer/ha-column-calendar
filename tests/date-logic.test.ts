import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeConfig } from '../src/config';
import {
  bucketEvents,
  computeRange,
  dayKeyOf,
  firstDayForLanguage,
  resolveFirstDay,
  resolveTimeZone,
} from '../src/date-logic';
import type {
  CalendarEvent,
  ColumnCalendarCardConfig,
  HomeAssistant,
  NormalizedConfig,
  WeekdayIndex,
} from '../src/types';

// Explicit zones throughout: results must not depend on the test process time zone.
const BERLIN = 'Europe/Berlin';
const NEW_YORK = 'America/New_York';
const AUCKLAND = 'Pacific/Auckland';
const KOLKATA = 'Asia/Kolkata';

const cfg = (extra: Partial<ColumnCalendarCardConfig> = {}): NormalizedConfig =>
  normalizeConfig({ type: 'x', entities: ['calendar.a'], ...extra });

/** Local wall-clock representation of `d` in `tz`. */
const wall = (d: Date, tz: string) => format(new TZDate(d.getTime(), tz), 'yyyy-MM-dd HH:mm');
/** UTC ISO string (TZDate#toISOString renders the zone offset instead). */
const utc = (d: Date) => new Date(d.getTime()).toISOString();
/** Wall-clock date keys of all range days. */
const keys = (days: Date[], tz: string) => days.map((d) => dayKeyOf(d, tz));
/** Instant for a wall-clock time in `tz` (1-based month). */
const at = (tz: string, y: number, m: number, d: number, h = 0, min = 0): Date =>
  new TZDate(y, m - 1, d, h, min, tz);

const hass = (locale: Partial<HomeAssistant['locale']>, serverTz = BERLIN): HomeAssistant =>
  ({
    language: locale.language ?? 'en',
    locale: {
      language: 'en',
      time_format: 'language',
      first_weekday: 'language',
      time_zone: 'local',
      ...locale,
    },
    config: { time_zone: serverTz },
    states: {},
  }) as unknown as HomeAssistant;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveTimeZone', () => {
  it('uses the server zone for "server"', () => {
    expect(resolveTimeZone(hass({ time_zone: 'server' }, AUCKLAND))).toBe(AUCKLAND);
  });

  it('uses the browser zone for "local"', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: KOLKATA,
    } as Intl.ResolvedDateTimeFormatOptions);
    expect(resolveTimeZone(hass({ time_zone: 'local' }, AUCKLAND))).toBe(KOLKATA);
  });

  it('falls back to the server zone when the browser zone is unavailable', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: '',
    } as Intl.ResolvedDateTimeFormatOptions);
    expect(resolveTimeZone(hass({ time_zone: 'local' }, AUCKLAND))).toBe(AUCKLAND);
  });
});

describe('resolveFirstDay', () => {
  it('explicit config wins over hass locale', () => {
    expect(resolveFirstDay(cfg({ first_day: 'saturday' }), hass({ first_weekday: 'monday' }))).toBe(
      6,
    );
  });

  it('auto uses hass.locale.first_weekday name', () => {
    expect(resolveFirstDay(cfg(), hass({ first_weekday: 'sunday' }))).toBe(0);
    expect(resolveFirstDay(cfg(), hass({ first_weekday: 'wednesday' }))).toBe(3);
  });

  it('auto + "language" derives from the locale', () => {
    expect(resolveFirstDay(cfg(), hass({ first_weekday: 'language', language: 'de' }))).toBe(1);
    // Only assert Sunday-start locales when the runtime exposes week info.
    const loc = new Intl.Locale('en-US') as unknown as {
      getWeekInfo?: () => unknown;
      weekInfo?: unknown;
    };
    if (loc.getWeekInfo || loc.weekInfo) {
      expect(resolveFirstDay(cfg(), hass({ first_weekday: 'language', language: 'en-US' }))).toBe(
        0,
      );
    }
  });

  it('falls back to Monday for an invalid language tag', () => {
    expect(firstDayForLanguage('!!invalid!!')).toBe(1);
  });

  it('falls back to Monday when the runtime has no week info', () => {
    const original = Intl.Locale;
    class NoWeekInfoLocale {}
    vi.stubGlobal('Intl', { ...Intl, Locale: NoWeekInfoLocale });
    try {
      expect(firstDayForLanguage('en-US')).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(Intl.Locale).toBe(original);
  });
});

describe('computeRange — week mode', () => {
  // Tuesday 2026-10-20 15:00 in New York.
  const now = at(NEW_YORK, 2026, 10, 20, 15);

  it.each<[WeekdayIndex, string, number]>([
    [1, '2026-10-19', 19], // Monday
    [0, '2026-10-18', 18], // Sunday
    [6, '2026-10-17', 17], // Saturday
    [2, '2026-10-20', 20], // Tuesday = today
    [3, '2026-10-14', 14], // Wednesday → previous week
  ])('first day %i starts on %s', (firstDay, startKey, startDate) => {
    const r = computeRange(cfg(), now, 0, NEW_YORK, firstDay);
    expect(r.days).toHaveLength(7);
    expect(dayKeyOf(r.start, NEW_YORK)).toBe(startKey);
    expect(new TZDate(r.start.getTime(), NEW_YORK).getDay()).toBe(firstDay);
    r.days.forEach((d) => expect(wall(d, NEW_YORK)).toMatch(/ 00:00$/));
    expect(r.start.getTime()).toBe(at(NEW_YORK, 2026, 10, startDate).getTime());
    expect(r.end.getTime()).toBe(at(NEW_YORK, 2026, 10, startDate + 7).getTime());
  });

  it('end is exclusive midnight after the last day', () => {
    const r = computeRange(cfg(), now, 0, NEW_YORK, 1);
    expect(r.start.getTime()).toBe(at(NEW_YORK, 2026, 10, 19).getTime());
    expect(r.days[6].getTime()).toBe(at(NEW_YORK, 2026, 10, 25).getTime());
    expect(r.end.getTime()).toBe(at(NEW_YORK, 2026, 10, 26).getTime());
  });

  it('uses "today" in the display zone, not the process zone', () => {
    // 2026-10-20 23:30 UTC = Wed 21st 12:30 in Auckland, Tue 20th 19:30 in New York.
    const instant = new Date('2026-10-20T23:30:00Z');
    const rolling = cfg({ mode: 'rolling', days: 1 });
    expect(keys(computeRange(rolling, instant, 0, AUCKLAND, 1).days, AUCKLAND)).toEqual([
      '2026-10-21',
    ]);
    expect(keys(computeRange(rolling, instant, 0, NEW_YORK, 1).days, NEW_YORK)).toEqual([
      '2026-10-20',
    ]);
    // Saturday-start week: in Auckland (Wed) and New York (Tue) both start Sat 17th,
    // but a Wednesday-start week differs: Auckland → 21st, New York → 14th.
    expect(dayKeyOf(computeRange(cfg(), instant, 0, AUCKLAND, 3).start, AUCKLAND)).toBe(
      '2026-10-21',
    );
    expect(dayKeyOf(computeRange(cfg(), instant, 0, NEW_YORK, 3).start, NEW_YORK)).toBe(
      '2026-10-14',
    );
  });

  it.each([
    [1, '2026-10-26'],
    [-1, '2026-10-12'],
    [-2, '2026-10-05'],
    [3, '2026-11-09'],
  ])('offset %i starts on %s', (offset, startKey) => {
    const r = computeRange(cfg(), now, offset, NEW_YORK, 1);
    expect(dayKeyOf(r.start, NEW_YORK)).toBe(startKey);
    expect(r.days).toHaveLength(7);
    r.days.forEach((d) => expect(wall(d, NEW_YORK)).toMatch(/ 00:00$/));
  });

  it('ignores config.days in week mode', () => {
    expect(computeRange(cfg({ days: 3 }), now, 0, NEW_YORK, 1).days).toHaveLength(7);
  });
});

describe('computeRange — rolling mode', () => {
  const now = at(KOLKATA, 2026, 10, 20, 0, 5);

  it('starts today with N days', () => {
    const r = computeRange(cfg({ mode: 'rolling', days: 4 }), now, 0, KOLKATA, 1);
    expect(keys(r.days, KOLKATA)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
    expect(r.start.getTime()).toBe(at(KOLKATA, 2026, 10, 20).getTime());
    expect(r.end.getTime()).toBe(at(KOLKATA, 2026, 10, 24).getTime());
  });

  it('shifts by N days per offset', () => {
    const c = cfg({ mode: 'rolling', days: 4 });
    expect(dayKeyOf(computeRange(c, now, 1, KOLKATA, 1).start, KOLKATA)).toBe('2026-10-24');
    expect(dayKeyOf(computeRange(c, now, -1, KOLKATA, 1).start, KOLKATA)).toBe('2026-10-16');
    expect(dayKeyOf(computeRange(c, now, -3, KOLKATA, 1).start, KOLKATA)).toBe('2026-10-08');
  });

  it('supports a single day and the default of 7', () => {
    expect(computeRange(cfg({ mode: 'rolling', days: 1 }), now, 0, KOLKATA, 1).days).toHaveLength(
      1,
    );
    expect(computeRange(cfg({ mode: 'rolling' }), now, 0, KOLKATA, 1).days).toHaveLength(7);
  });

  it('crosses month and year boundaries', () => {
    const r = computeRange(
      cfg({ mode: 'rolling', days: 3 }),
      at(KOLKATA, 2026, 12, 31, 9),
      0,
      KOLKATA,
      1,
    );
    expect(keys(r.days, KOLKATA)).toEqual(['2026-12-31', '2027-01-01', '2027-01-02']);
  });
});

describe('computeRange — DST', () => {
  it('Europe/Berlin spring forward (Sun 2026-03-29)', () => {
    const r = computeRange(cfg(), at(BERLIN, 2026, 3, 26, 12), 0, BERLIN, 1);
    expect(keys(r.days, BERLIN)).toEqual([
      '2026-03-23',
      '2026-03-24',
      '2026-03-25',
      '2026-03-26',
      '2026-03-27',
      '2026-03-28',
      '2026-03-29',
    ]);
    r.days.forEach((d) => expect(wall(d, BERLIN)).toMatch(/ 00:00$/));
    expect(utc(r.days[0])).toBe('2026-03-22T23:00:00.000Z'); // CET
    expect(utc(r.days[6])).toBe('2026-03-28T23:00:00.000Z'); // CET midnight of DST day
    expect(utc(r.end)).toBe('2026-03-29T22:00:00.000Z'); // CEST
    // DST day is 23 hours long.
    expect(r.end.getTime() - r.days[6].getTime()).toBe(23 * 3600_000);
  });

  it('Europe/Berlin fall back (Sun 2026-10-25)', () => {
    const r = computeRange(
      cfg({ mode: 'rolling', days: 3 }),
      at(BERLIN, 2026, 10, 24, 20),
      0,
      BERLIN,
      1,
    );
    expect(r.days.map((d) => utc(d))).toEqual([
      '2026-10-23T22:00:00.000Z',
      '2026-10-24T22:00:00.000Z',
      '2026-10-25T23:00:00.000Z',
    ]);
    expect(utc(r.end)).toBe('2026-10-26T23:00:00.000Z');
    // Fall-back day is 25 hours long.
    expect(r.days[2].getTime() - r.days[1].getTime()).toBe(25 * 3600_000);
  });

  it('America/New_York spring forward and fall back', () => {
    const spring = computeRange(cfg(), at(NEW_YORK, 2026, 3, 10, 9), 0, NEW_YORK, 0);
    expect(keys(spring.days, NEW_YORK)[0]).toBe('2026-03-08');
    expect(utc(spring.days[0])).toBe('2026-03-08T05:00:00.000Z'); // EST
    expect(utc(spring.days[1])).toBe('2026-03-09T04:00:00.000Z'); // EDT
    spring.days.forEach((d) => expect(wall(d, NEW_YORK)).toMatch(/ 00:00$/));

    const fall = computeRange(cfg(), at(NEW_YORK, 2026, 11, 1, 1, 30), 0, NEW_YORK, 0);
    expect(utc(fall.days[0])).toBe('2026-11-01T04:00:00.000Z'); // EDT
    expect(utc(fall.days[1])).toBe('2026-11-02T05:00:00.000Z'); // EST
    fall.days.forEach((d) => expect(wall(d, NEW_YORK)).toMatch(/ 00:00$/));
  });

  it('navigating across a DST change keeps midnights', () => {
    const now = at(BERLIN, 2026, 3, 18, 12);
    const r1 = computeRange(cfg(), now, 1, BERLIN, 1);
    expect(dayKeyOf(r1.start, BERLIN)).toBe('2026-03-23');
    const r2 = computeRange(cfg(), now, 2, BERLIN, 1);
    expect(dayKeyOf(r2.start, BERLIN)).toBe('2026-03-30');
    expect(utc(r2.start)).toBe('2026-03-29T22:00:00.000Z');
    const back = computeRange(cfg(), at(BERLIN, 2026, 4, 1, 12), -1, BERLIN, 1);
    expect(utc(back.start)).toBe('2026-03-22T23:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// bucketEvents
// ---------------------------------------------------------------------------

let seq = 0;
const ev = (start: Date, end: Date, extra: Partial<CalendarEvent> = {}): CalendarEvent => {
  seq += 1;
  return {
    uid: `e${seq}`,
    entity: 'calendar.a',
    calendarName: 'A',
    color: '#000',
    summary: `Event ${seq}`,
    start,
    end,
    allDay: false,
    ...extra,
  };
};

type Ymd = [number, number, number];
const allDayEv = (tz: string, from: Ymd, toExcl: Ymd, extra: Partial<CalendarEvent> = {}) =>
  ev(at(tz, ...from), at(tz, ...toExcl), { allDay: true, ...extra });

describe('bucketEvents — flags', () => {
  const tz = NEW_YORK;
  const now = at(tz, 2026, 10, 21, 12); // Wednesday noon
  const range = computeRange(cfg(), now, 0, tz, 1); // Mon 19 … Sun 25

  it('one bucket per day with key, today and past flags', () => {
    const b = bucketEvents([], range, now, tz);
    expect(b.map((x) => x.dayKey)).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ]);
    expect(b.map((x) => x.isToday)).toEqual([false, false, true, false, false, false, false]);
    expect(b.map((x) => x.isPast)).toEqual([true, true, false, false, false, false, false]);
    expect(b[0].date).toBe(range.days[0]);
    b.forEach((x) => {
      expect(x.allDay).toEqual([]);
      expect(x.timed).toEqual([]);
    });
  });

  it('today is evaluated in the display zone', () => {
    // 2026-10-21 02:00 UTC is still Tuesday 20th in New York.
    const b = bucketEvents([], range, new Date('2026-10-21T02:00:00Z'), tz);
    expect(b.find((x) => x.isToday)?.dayKey).toBe('2026-10-20');
    expect(b.filter((x) => x.isPast).map((x) => x.dayKey)).toEqual(['2026-10-19']);
  });

  it('a range entirely in the past or future', () => {
    const past = computeRange(cfg(), now, -1, tz, 1);
    expect(bucketEvents([], past, now, tz).every((x) => x.isPast && !x.isToday)).toBe(true);
    const future = computeRange(cfg(), now, 1, tz, 1);
    expect(bucketEvents([], future, now, tz).some((x) => x.isPast || x.isToday)).toBe(false);
  });

  it('marks ended timed events (end <= now)', () => {
    const ended = ev(at(tz, 2026, 10, 21, 9), at(tz, 2026, 10, 21, 12)); // ends exactly now
    const running = ev(at(tz, 2026, 10, 21, 11), at(tz, 2026, 10, 21, 13));
    const future = ev(at(tz, 2026, 10, 21, 15), at(tz, 2026, 10, 21, 16));
    const today = bucketEvents([future, running, ended], range, now, tz)[2];
    expect(today.timed.map((t) => [t.event, t.isEnded])).toEqual([
      [ended, true],
      [running, false],
      [future, false],
    ]);
  });
});

describe('bucketEvents — timed events', () => {
  const tz = BERLIN;
  const now = at(tz, 2026, 10, 20, 8);
  const range = computeRange(cfg({ mode: 'rolling', days: 3 }), now, 0, tz, 1); // 20, 21, 22

  it('places an event crossing midnight on both days', () => {
    const e = ev(at(tz, 2026, 10, 20, 22), at(tz, 2026, 10, 21, 2));
    const b = bucketEvents([e], range, now, tz);
    expect(b[0].timed).toEqual([
      { event: e, isEnded: false, startsBeforeDay: false, endsAfterDay: true },
    ]);
    expect(b[1].timed).toEqual([
      { event: e, isEnded: false, startsBeforeDay: true, endsAfterDay: false },
    ]);
    expect(b[2].timed).toEqual([]);
  });

  it('a long event spanning several days has both flags on middle days', () => {
    const e = ev(at(tz, 2026, 10, 19, 10), at(tz, 2026, 10, 23, 10));
    const b = bucketEvents([e], range, now, tz);
    b.forEach((x) => {
      expect(x.timed).toHaveLength(1);
      expect(x.timed[0].startsBeforeDay).toBe(true);
      expect(x.timed[0].endsAfterDay).toBe(true);
    });
  });

  it('an event ending exactly at midnight does not spill into the next day', () => {
    const e = ev(at(tz, 2026, 10, 20, 22), at(tz, 2026, 10, 21, 0));
    const b = bucketEvents([e], range, now, tz);
    expect(b[0].timed).toHaveLength(1);
    expect(b[0].timed[0].endsAfterDay).toBe(false);
    expect(b[1].timed).toEqual([]);
  });

  it('an event starting exactly at midnight belongs to that day only', () => {
    const e = ev(at(tz, 2026, 10, 21, 0), at(tz, 2026, 10, 21, 1));
    const b = bucketEvents([e], range, now, tz);
    expect(b[0].timed).toEqual([]);
    expect(b[1].timed).toHaveLength(1);
    expect(b[1].timed[0].startsBeforeDay).toBe(false);
  });

  it('zero-length events appear on their day (including at midnight)', () => {
    const z1 = ev(at(tz, 2026, 10, 20, 9), at(tz, 2026, 10, 20, 9));
    const z2 = ev(at(tz, 2026, 10, 21, 0), at(tz, 2026, 10, 21, 0));
    const b = bucketEvents([z1, z2], range, now, tz);
    expect(b[0].timed.map((t) => t.event)).toEqual([z1]);
    expect(b[1].timed.map((t) => t.event)).toEqual([z2]);
    expect(b[2].timed).toEqual([]);
  });

  it('drops events outside the range', () => {
    const before = ev(at(tz, 2026, 10, 19, 9), at(tz, 2026, 10, 20, 0));
    const after = ev(at(tz, 2026, 10, 23, 0), at(tz, 2026, 10, 23, 1));
    bucketEvents([before, after], range, now, tz).forEach((x) => expect(x.timed).toEqual([]));
  });

  it('honors events with a foreign UTC offset', () => {
    // 23:30 UTC on the 20th = 01:30 CEST on the 21st in Berlin.
    const e = ev(new Date('2026-10-20T23:30:00Z'), new Date('2026-10-21T00:30:00Z'));
    const b = bucketEvents([e], range, now, tz);
    expect(b[0].timed).toEqual([]);
    expect(b[1].timed).toHaveLength(1);
  });

  it('places events correctly on the 25-hour DST fall-back day', () => {
    const n = at(tz, 2026, 10, 25, 1);
    const r = computeRange(cfg({ mode: 'rolling', days: 2 }), n, 0, tz, 1);
    // 23:30 local on the 25th — would land on the 26th with naive +24h day boundaries.
    const late = ev(at(tz, 2026, 10, 25, 23, 30), at(tz, 2026, 10, 25, 23, 45));
    const b = bucketEvents([late], r, n, tz);
    expect(b[0].timed).toHaveLength(1);
    expect(b[1].timed).toEqual([]);
  });

  it('sorts by start, ties by input (entity) order', () => {
    const a1 = ev(at(tz, 2026, 10, 20, 10), at(tz, 2026, 10, 20, 11), { entity: 'calendar.a' });
    const a2 = ev(at(tz, 2026, 10, 20, 8), at(tz, 2026, 10, 20, 9), { entity: 'calendar.a' });
    const b1 = ev(at(tz, 2026, 10, 20, 10), at(tz, 2026, 10, 20, 12), { entity: 'calendar.b' });
    const b2 = ev(at(tz, 2026, 10, 20, 7), at(tz, 2026, 10, 20, 8), { entity: 'calendar.b' });
    // Spanning event from yesterday starts earliest.
    const span = ev(at(tz, 2026, 10, 19, 23), at(tz, 2026, 10, 20, 1), { entity: 'calendar.b' });
    const b = bucketEvents([a1, a2, b1, b2, span], range, now, tz);
    expect(b[0].timed.map((t) => t.event)).toEqual([span, b2, a2, a1, b1]);
  });
});

describe('bucketEvents — all-day events', () => {
  const tz = AUCKLAND;
  const now = at(tz, 2026, 10, 21, 9);
  const range = computeRange(cfg(), now, 0, tz, 1); // Mon 19 … Sun 25
  const hints = (events: CalendarEvent[], r = range, n = now, zone = tz) =>
    bucketEvents(events, r, n, zone).map((x) =>
      x.allDay.map((i) => `${i.dayIndex}/${i.totalDays}`),
    );

  it('single-day all-day event', () => {
    const e = allDayEv(tz, [2026, 10, 21], [2026, 10, 22]);
    const b = bucketEvents([e], range, now, tz);
    expect(b[2].allDay).toEqual([{ event: e, dayIndex: 1, totalDays: 1 }]);
    expect(b.filter((x) => x.allDay.length > 0)).toHaveLength(1);
    expect(b[2].timed).toEqual([]);
  });

  it('multi-day event inside the range gets Day n/m', () => {
    const e = allDayEv(tz, [2026, 10, 20], [2026, 10, 23]); // 20, 21, 22
    expect(hints([e])).toEqual([[], ['1/3'], ['2/3'], ['3/3'], [], [], []]);
  });

  it('counts relative to event start when it begins before the range', () => {
    const e = allDayEv(tz, [2026, 10, 15], [2026, 10, 21]); // 15 … 20 (6 days)
    expect(hints([e])).toEqual([['5/6'], ['6/6'], [], [], [], [], []]);
  });

  it('counts totalDays beyond the end of the range', () => {
    const e = allDayEv(tz, [2026, 10, 24], [2026, 11, 3]); // 24 Oct … 2 Nov (10 days)
    expect(hints([e])).toEqual([[], [], [], [], [], ['1/10'], ['2/10']]);
  });

  it('event covering the whole range and beyond on both sides', () => {
    const e = allDayEv(tz, [2026, 10, 18], [2026, 10, 27]); // 9 days
    expect(hints([e])).toEqual([['2/9'], ['3/9'], ['4/9'], ['5/9'], ['6/9'], ['7/9'], ['8/9']]);
  });

  it('counts calendar days across a DST change', () => {
    const tzB = BERLIN;
    const nowB = at(tzB, 2026, 10, 24, 12);
    const r = computeRange(cfg({ mode: 'rolling', days: 3 }), nowB, 0, tzB, 1); // 24, 25, 26
    const e = allDayEv(tzB, [2026, 10, 24], [2026, 10, 27]);
    expect(hints([e], r, nowB, tzB)).toEqual([['1/3'], ['2/3'], ['3/3']]);
    const spring = computeRange(cfg(), at(tzB, 2026, 3, 26), 0, tzB, 1); // 23 … 29 Mar
    const s = allDayEv(tzB, [2026, 3, 28], [2026, 3, 31]);
    expect(hints([s], spring, at(tzB, 2026, 3, 26), tzB).slice(5)).toEqual([['1/3'], ['2/3']]);
  });

  it('sorts all-day items by start, ties by input order', () => {
    const long = allDayEv(tz, [2026, 10, 19], [2026, 10, 23], { entity: 'calendar.b' });
    const a = allDayEv(tz, [2026, 10, 21], [2026, 10, 22], { entity: 'calendar.a' });
    const b2 = allDayEv(tz, [2026, 10, 21], [2026, 10, 22], { entity: 'calendar.b' });
    const b = bucketEvents([a, b2, long], range, now, tz);
    expect(b[2].allDay.map((i) => i.event)).toEqual([long, a, b2]);
  });

  it('separates all-day and timed events in the same day', () => {
    const d = allDayEv(tz, [2026, 10, 21], [2026, 10, 22]);
    const t = ev(at(tz, 2026, 10, 21, 10), at(tz, 2026, 10, 21, 11));
    const b = bucketEvents([t, d], range, now, tz);
    expect(b[2].allDay.map((i) => i.event)).toEqual([d]);
    expect(b[2].timed.map((i) => i.event)).toEqual([t]);
  });
});
