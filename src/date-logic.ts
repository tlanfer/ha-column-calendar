import { TZDate, tz as tzContext } from '@date-fns/tz';
import { addDays, differenceInCalendarDays, format, startOfDay, startOfWeek } from 'date-fns';
import type {
  AllDayItem,
  CalendarEvent,
  DateRange,
  DayBucket,
  HomeAssistant,
  NormalizedConfig,
  TimedItem,
  WeekdayIndex,
  WeekdayName,
} from './types';

const WEEKDAYS: readonly WeekdayName[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/** Browser IANA zone, or undefined if the runtime can't tell. */
function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * IANA zone used for all date math and formatting.
 * `hass.locale.time_zone === 'server'` → `hass.config.time_zone`;
 * otherwise (`local`) → browser zone via `Intl.DateTimeFormat().resolvedOptions().timeZone`,
 * falling back to the server zone if the browser zone is unavailable.
 */
export function resolveTimeZone(hass: HomeAssistant): string {
  const server = hass.config?.time_zone;
  if (hass.locale?.time_zone === 'server' && server) return server;
  return browserTimeZone() ?? server ?? 'UTC';
}

interface WeekInfoLocale {
  getWeekInfo?: () => { firstDay?: number };
  weekInfo?: { firstDay?: number };
}

/** First weekday (0 = Sunday) for a BCP-47 language tag; Monday if unknown. */
export function firstDayForLanguage(language: string | undefined): WeekdayIndex {
  try {
    const locale = new Intl.Locale(language || 'en') as unknown as WeekInfoLocale;
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    const firstDay = info?.firstDay;
    if (typeof firstDay === 'number' && Number.isFinite(firstDay)) {
      return (firstDay % 7) as WeekdayIndex;
    }
  } catch {
    // invalid tag or no Intl.Locale → fallback below
  }
  return 1;
}

/**
 * First day of the week as 0 (Sun) … 6 (Sat).
 * Explicit `config.firstDay` wins. For 'auto' use `hass.locale.first_weekday`;
 * if that is 'language' (or missing/unknown), derive from `hass.locale.language`
 * via `Intl.Locale#getWeekInfo()` / `weekInfo` where available; default Monday.
 */
export function resolveFirstDay(config: NormalizedConfig, hass: HomeAssistant): WeekdayIndex {
  if (config.firstDay !== 'auto') return config.firstDay;
  const setting = hass.locale?.first_weekday;
  const idx = setting ? WEEKDAYS.indexOf(setting as WeekdayName) : -1;
  if (idx >= 0) return idx as WeekdayIndex;
  return firstDayForLanguage(hass.locale?.language ?? hass.language);
}

/** Midnight (in `tz`) of the calendar day containing `date`. */
function midnightIn(date: Date, tz: string): TZDate {
  return startOfDay(new TZDate(date.getTime(), tz));
}

/** Midnight (in `tz`) `n` calendar days after the day containing `date`. */
function addCalendarDays(date: Date, n: number, tz: string): TZDate {
  // Re-normalise with startOfDay: covers zones where midnight itself may be skipped by DST.
  return startOfDay(addDays(new TZDate(date.getTime(), tz), n));
}

/**
 * Visible range for `now` shifted by `offset` periods (negative = past).
 * - week: starts at the most recent `firstDay` on/before today, 7 days; offset shifts ±7 days.
 * - rolling: starts today, `config.days` days; offset shifts ±`config.days` days.
 * All boundaries are midnight in `tz` (DST-safe: calendar-day arithmetic, not +24h).
 * Returned dates are `TZDate` instances in `tz`.
 */
export function computeRange(
  config: NormalizedConfig,
  now: Date,
  offset: number,
  tz: string,
  firstDay: WeekdayIndex,
): DateRange {
  let base: TZDate;
  let count: number;
  if (config.mode === 'week') {
    const weekStart = startOfWeek(new TZDate(now.getTime(), tz), { weekStartsOn: firstDay });
    count = 7;
    base = addCalendarDays(weekStart, offset * 7, tz);
  } else {
    count = config.days;
    base = addCalendarDays(midnightIn(now, tz), offset * count, tz);
  }
  const days: Date[] = [];
  for (let i = 0; i < count; i++) days.push(addCalendarDays(base, i, tz));
  return { start: days[0], end: addCalendarDays(base, count, tz), days };
}

/** 'yyyy-MM-dd' of `date` in `tz`. */
export function dayKeyOf(date: Date, tz: string): string {
  return format(new TZDate(date.getTime(), tz), 'yyyy-MM-dd');
}

/**
 * Distribute events into one `DayBucket` per `range.days` entry.
 * - All-day events go to `allDay` on every day they cover (end exclusive), with
 *   1-based `dayIndex` / `totalDays` counted over the whole event (in calendar days in `tz`),
 *   not just the range.
 * - Timed events go to `timed` on every day they overlap (start < dayEnd && end > dayStart);
 *   zero-length events count on the day containing their start. An event ending exactly at
 *   midnight does not appear on the following day.
 * - `isToday`/`isPast` relative to `now` in `tz`; `isEnded` = `event.end <= now`.
 * - Ordering: by start time; ties keep input order (stable sort). Callers must pass `events`
 *   concatenated in config entity order so ties resolve by entity order.
 */
export function bucketEvents(
  events: CalendarEvent[],
  range: DateRange,
  now: Date,
  tz: string,
): DayBucket[] {
  const ctx = { in: tzContext(tz) };
  const todayKey = dayKeyOf(now, tz);
  const sorted = [...events].sort((a, b) => a.start.getTime() - b.start.getTime());
  const nowMs = now.getTime();

  return range.days.map((day) => {
    const dayStart = day.getTime();
    const dayEnd = addCalendarDays(day, 1, tz).getTime();
    const allDay: AllDayItem[] = [];
    const timed: TimedItem[] = [];

    for (const event of sorted) {
      const start = event.start.getTime();
      const end = event.end.getTime();
      const overlaps =
        end > start ? start < dayEnd && end > dayStart : start >= dayStart && start < dayEnd;
      if (!overlaps) continue;

      if (event.allDay) {
        const totalDays = Math.max(1, differenceInCalendarDays(event.end, event.start, ctx));
        const dayIndex = differenceInCalendarDays(day, event.start, ctx) + 1;
        allDay.push({ event, dayIndex: Math.min(Math.max(dayIndex, 1), totalDays), totalDays });
      } else {
        timed.push({
          event,
          isEnded: end <= nowMs,
          startsBeforeDay: start < dayStart,
          endsAfterDay: end > dayEnd,
        });
      }
    }

    const dayKey = dayKeyOf(day, tz);
    return {
      date: day,
      dayKey,
      isToday: dayKey === todayKey,
      isPast: dayKey < todayKey,
      allDay,
      timed,
    };
  });
}
