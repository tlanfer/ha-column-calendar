import { TZDate } from '@date-fns/tz';
import { addDays } from 'date-fns';
import type { CalendarEvent, DateRange, HomeAssistant } from './types';

/** `hass.locale.language` (fallback `hass.language`), validated for `Intl`; falls back to "en". */
function localeOf(hass: HomeAssistant): string {
  const lang = hass.locale?.language ?? hass.language;
  try {
    return Intl.getCanonicalLocales(lang)[0] ?? 'en';
  } catch {
    return 'en';
  }
}

/** Whether to use a 12-hour clock, per `hass.locale.time_format` (see docs/ha-api-notes.md). */
export function useAmPm(hass: HomeAssistant): boolean {
  const tf = hass.locale?.time_format ?? 'language';
  if (tf === '12') return true;
  if (tf === '24') return false;
  const test = new Date('January 1, 2023 22:00:00');
  return test.toLocaleString(tf === 'language' ? localeOf(hass) : undefined).includes('10');
}

/**
 * Hour-cycle options. 24h uses `hourCycle: 'h23'` rather than `hour12: false`
 * (the latter yields "24:05" in some engines).
 */
function clockOptions(hass: HomeAssistant): Intl.DateTimeFormatOptions {
  return useAmPm(hass)
    ? { hour: 'numeric', minute: '2-digit', hour12: true }
    : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
}

/**
 * Time of day in `tz`, honoring `hass.locale.time_format`:
 * '12' / '24' force the hour cycle; 'language' → default for `hass.locale.language`;
 * 'system' → the browser default locale's hour cycle. E.g. "09:30" (de) / "9:30 AM" (en).
 */
export function formatTime(date: Date, hass: HomeAssistant, tz: string): string {
  return new Intl.DateTimeFormat(localeOf(hass), { ...clockOptions(hass), timeZone: tz }).format(
    date,
  );
}

/**
 * Header label for the visible range via `Intl.DateTimeFormat#formatRange` in
 * `hass.locale.language`, e.g. "October 20 – 26, 2026" (en) / "20.–26. Oktober 2026" (de).
 * Uses the last *inclusive* day (`range.days.at(-1)`), not `range.end`.
 */
export function formatRangeLabel(range: DateRange, hass: HomeAssistant, tz: string): string {
  const first = range.days[0] ?? range.start;
  const last = range.days.at(-1) ?? first;
  const fmt = new Intl.DateTimeFormat(localeOf(hass), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: tz,
  });
  return formatRangeSafe(fmt, first, last);
}

/** Short weekday name, uppercased, in `hass.locale.language`, e.g. "MON" / "MO.". */
export function formatWeekday(date: Date, hass: HomeAssistant, tz: string): string {
  const locale = localeOf(hass);
  return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: tz })
    .format(date)
    .toLocaleUpperCase(locale);
}

/** Day of month in `tz` as plain digits, e.g. "20" (no locale punctuation like German "20."). */
export function formatDayNumber(date: Date, tz: string): string {
  return String(new TZDate(date.getTime(), tz).getDate());
}

/**
 * Human-readable date/time span for the details dialog.
 * - All-day: date, or date range using the last inclusive day (end is exclusive).
 * - Timed: date + start–end time; spans across days include both dates.
 */
export function formatDateTimeRange(event: CalendarEvent, hass: HomeAssistant, tz: string): string {
  const locale = localeOf(hass);
  const dateOpts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: tz,
  };
  if (event.allDay) {
    const start = new TZDate(event.start.getTime(), tz);
    const lastDay = addDays(new TZDate(event.end.getTime(), tz), -1);
    const last = lastDay.getTime() < start.getTime() ? start : lastDay;
    return formatRangeSafe(new Intl.DateTimeFormat(locale, dateOpts), start, last);
  }
  const fmt = new Intl.DateTimeFormat(locale, { ...dateOpts, ...clockOptions(hass) });
  return formatRangeSafe(fmt, event.start, event.end);
}

function formatRangeSafe(fmt: Intl.DateTimeFormat, a: Date, b: Date): string {
  const start = new Date(a.getTime());
  const end = new Date(Math.max(a.getTime(), b.getTime()));
  if (typeof fmt.formatRange === 'function') {
    try {
      return fmt.formatRange(start, end);
    } catch {
      // fall through
    }
  }
  const s = fmt.format(start);
  const e = fmt.format(end);
  return s === e ? s : `${s} – ${e}`;
}
