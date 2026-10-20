/**
 * Shared type contracts for the Column Calendar Card.
 *
 * Conventions:
 * - Every `Date` is an absolute instant. Values that represent a calendar day
 *   ("midnight") are midnight *in the resolved display time zone*, not the
 *   browser zone; they may be `TZDate` instances from `@date-fns/tz`.
 * - Time zones are IANA names (e.g. "Europe/Berlin"), see `resolveTimeZone`.
 * - Weekday indices follow JS `Date#getDay()`: 0 = Sunday … 6 = Saturday.
 */

// ---------------------------------------------------------------------------
// Home Assistant (minimal subset of the frontend `hass` object we rely on)
// ---------------------------------------------------------------------------

export type HaTimeFormat = 'language' | 'system' | '12' | '24';
export type HaFirstWeekday = 'language' | WeekdayName;
export type HaTimeZoneSetting = 'local' | 'server';

/** `hass.locale` — the user's frontend locale profile settings. */
export interface FrontendLocaleData {
  language: string;
  time_format: HaTimeFormat;
  first_weekday: HaFirstWeekday;
  /** `local` → browser zone, `server` → `hass.config.time_zone`. */
  time_zone: HaTimeZoneSetting;
}

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: { friendly_name?: string; [key: string]: unknown };
}

/** Message sent through `connection.subscribeMessage`. */
export interface HassSubscribeMessage {
  type: string;
  [key: string]: unknown;
}

/** Resolves when HA confirmed the unsubscribe. */
export type SubscriptionUnsubscribe = () => Promise<void>;

/** Subset of home-assistant-js-websocket's `Connection`. */
export interface HassConnection {
  subscribeMessage<Result>(
    callback: (message: Result) => void,
    subscribeMessage: HassSubscribeMessage,
    options?: { resubscribe?: boolean },
  ): Promise<SubscriptionUnsubscribe>;
}

export interface HomeAssistant {
  /** Active UI language, e.g. "en", "de". Same as `locale.language`. */
  language: string;
  locale: FrontendLocaleData;
  config: { time_zone: string };
  states: Record<string, HassEntity>;
  connection: HassConnection;
}

/** Sections-view grid sizing, as returned by `getGridOptions()` / set by the user. */
export interface LovelaceGridOptions {
  columns?: number | 'full';
  rows?: number | 'auto';
  min_columns?: number;
  max_columns?: number;
  min_rows?: number;
  max_rows?: number;
}

// ---------------------------------------------------------------------------
// Card configuration
// ---------------------------------------------------------------------------

export type WeekdayName =
  'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';

/** 0 = Sunday … 6 = Saturday (JS `getDay()` convention). */
export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type CalendarMode = 'week' | 'rolling';

export interface EntityConfig {
  entity: string;
  color?: string;
  name?: string;
}

/** Raw YAML config exactly as the user writes it (see SPEC.md). */
export interface ColumnCalendarCardConfig {
  type: string;
  entities: (string | EntityConfig)[];
  mode?: CalendarMode;
  /** Week mode only. `auto` = derive from `hass.locale.first_weekday`. */
  first_day?: 'auto' | WeekdayName;
  /** Rolling mode only: total columns including today. */
  days?: number;
  title?: string;
  show_range?: boolean;
  show_navigation?: boolean;
  /** Seconds of inactivity before navigation snaps back to today; 0 = never. */
  navigation_reset?: number;
  show_end_time?: boolean;
  show_location?: boolean;
  show_empty?: boolean;
  /** Pixels. */
  min_column_width?: number;
  accent_color?: string;
  /** Any CSS length, e.g. "500px". Enables per-column vertical scroll. */
  height?: string;
  grid_options?: LovelaceGridOptions;
}

/** A configured calendar with its final color. */
export interface ResolvedEntity {
  entity: string;
  /** Explicit color or `PALETTE[index % PALETTE.length]`. */
  color: string;
  /**
   * Explicit name from config, if any. When undefined, display code falls back
   * to the entity's `friendly_name`, then to the entity id.
   */
  name?: string;
}

/** Config after validation with all defaults applied (output of `normalizeConfig`). */
export interface NormalizedConfig {
  entities: ResolvedEntity[];
  /** Default 'week'. */
  mode: CalendarMode;
  /** Unresolved: 'auto' or explicit index. Resolve with `resolveFirstDay(config, hass)`. Default 'auto'. */
  firstDay: 'auto' | WeekdayIndex;
  /** Rolling mode column count. Default 7, integer >= 1. */
  days: number;
  title?: string;
  /** Default true. */
  showRange: boolean;
  /** Default true. */
  showNavigation: boolean;
  /** Seconds; default 120; 0 = never reset. */
  navigationReset: number;
  /** Default false. */
  showEndTime: boolean;
  /** Default true. */
  showLocation: boolean;
  /** Default true. */
  showEmpty: boolean;
  /** Pixels; default 120. */
  minColumnWidth: number;
  /** Default '#e8173a'. */
  accentColor: string;
  /** CSS length, only if configured. */
  height?: string;
  /** Set only when the user configured a numeric `grid_options.rows`. */
  gridRows?: number;
}

// ---------------------------------------------------------------------------
// Events & view model
// ---------------------------------------------------------------------------

/** Normalized calendar event, independent of HA's wire format. */
export interface CalendarEvent {
  uid?: string;
  /** Source entity id, e.g. "calendar.family". */
  entity: string;
  /** Display name of the source calendar (config name → friendly_name → entity id). */
  calendarName: string;
  /** Resolved calendar color. */
  color: string;
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  /**
   * Exclusive end. For all-day events this is midnight (display tz) of the day
   * after the last day, matching iCal/HA semantics.
   */
  end: Date;
  allDay: boolean;
}

/** Visible date range. */
export interface DateRange {
  /** Midnight (display tz) of the first visible day. */
  start: Date;
  /** Exclusive: midnight (display tz) of the day after the last visible day. */
  end: Date;
  /** Midnight (display tz) of each visible day, in order; length = column count. */
  days: Date[];
}

/** An all-day (or multi-day) event placed in one day column. */
export interface AllDayItem {
  event: CalendarEvent;
  /** 1-based index of this day within the event (for the "Day 2/5" hint). */
  dayIndex: number;
  /** Total number of days the event spans. */
  totalDays: number;
}

/** A timed event placed in one day column. */
export interface TimedItem {
  event: CalendarEvent;
  /** `event.end <= now` — rendered dimmed. */
  isEnded: boolean;
  /** Event started on an earlier day (crosses midnight into this column). */
  startsBeforeDay: boolean;
  /** Event continues past the end of this day. */
  endsAfterDay: boolean;
}

/** Everything needed to render one day column. */
export interface DayBucket {
  /** Midnight of this day in the display time zone. */
  date: Date;
  /** 'yyyy-MM-dd' in the display time zone; stable key for lit `repeat`. */
  dayKey: string;
  isToday: boolean;
  /** Day lies entirely before today. */
  isPast: boolean;
  /** Sorted by start, then entity order in config. */
  allDay: AllDayItem[];
  /** Sorted by start time, then entity order in config. */
  timed: TimedItem[];
}
