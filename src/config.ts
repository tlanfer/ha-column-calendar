import type {
  ColumnCalendarCardConfig,
  EntityConfig,
  HomeAssistant,
  NormalizedConfig,
  ResolvedEntity,
  WeekdayIndex,
  WeekdayName,
} from './types';

/** Fixed palette for calendars without an explicit color; picked by entity index (stable). */
export const PALETTE = [
  '#1e88e5', // blue
  '#43a047', // green
  '#fb8c00', // orange
  '#8e24aa', // purple
  '#00acc1', // cyan
  '#e53935', // red
  '#fdd835', // yellow
  '#6d4c41', // brown
] as const;

export const DEFAULT_ACCENT_COLOR = '#e8173a';

/**
 * Validate the raw YAML config and apply defaults (see `NormalizedConfig` for defaults).
 *
 * - `entities` must be a non-empty array; each item is a `calendar.*` string or
 *   `{ entity, color?, name? }`. Strings become `{ entity }`.
 * - Missing colors → `PALETTE[index % PALETTE.length]` (index = position in `entities`).
 * - `mode` ∈ week|rolling; `first_day` ∈ auto|monday…sunday → `firstDay` 'auto' | 0..6.
 * - `days` integer >= 1; `navigation_reset` >= 0; `min_column_width` > 0.
 * - Numeric `grid_options.rows` → `gridRows`.
 *
 * @throws Error with a user-readable message on invalid input (shown by HA as card error),
 *   e.g. "entities: at least one calendar entity is required".
 */
export function normalizeConfig(raw: ColumnCalendarCardConfig): NormalizedConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid configuration');
  }
  if (!Array.isArray(raw.entities) || raw.entities.length === 0) {
    throw new Error('entities: at least one calendar entity is required');
  }

  const entities: ResolvedEntity[] = raw.entities.map((item, index) => {
    const cfg: EntityConfig | undefined =
      typeof item === 'string'
        ? { entity: item }
        : item && typeof item === 'object'
          ? item
          : undefined;
    if (!cfg || typeof cfg.entity !== 'string') {
      throw new Error(
        `entities[${index}]: expected a calendar entity id or an object with an "entity" key`,
      );
    }
    if (!/^calendar\.[^.\s]+$/.test(cfg.entity)) {
      throw new Error(`entities[${index}]: "${cfg.entity}" is not a calendar.* entity`);
    }
    if (cfg.color !== undefined && (typeof cfg.color !== 'string' || cfg.color.trim() === '')) {
      throw new Error(`entities[${index}]: color must be a non-empty string`);
    }
    if (cfg.name !== undefined && typeof cfg.name !== 'string') {
      throw new Error(`entities[${index}]: name must be a string`);
    }
    const resolved: ResolvedEntity = {
      entity: cfg.entity,
      color: cfg.color ?? PALETTE[index % PALETTE.length],
    };
    if (cfg.name !== undefined) resolved.name = cfg.name;
    return resolved;
  });

  const mode = raw.mode ?? 'week';
  if (mode !== 'week' && mode !== 'rolling') {
    throw new Error(`mode: must be "week" or "rolling", got "${String(mode)}"`);
  }

  let firstDay: 'auto' | WeekdayIndex = 'auto';
  if (raw.first_day !== undefined && raw.first_day !== 'auto') {
    const idx =
      typeof raw.first_day === 'string'
        ? WEEKDAY_NAMES.indexOf(raw.first_day.toLowerCase() as WeekdayName)
        : -1;
    if (idx < 0) {
      throw new Error(
        `first_day: must be "auto" or a weekday name (monday … sunday), got "${String(raw.first_day)}"`,
      );
    }
    firstDay = idx as WeekdayIndex;
  }

  const days = raw.days ?? 7;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 1) {
    throw new Error(`days: must be an integer >= 1, got "${String(raw.days)}"`);
  }

  const navigationReset = raw.navigation_reset ?? 120;
  if (
    typeof navigationReset !== 'number' ||
    !Number.isFinite(navigationReset) ||
    navigationReset < 0
  ) {
    throw new Error(
      `navigation_reset: must be a number of seconds >= 0, got "${String(raw.navigation_reset)}"`,
    );
  }

  const minColumnWidth = raw.min_column_width ?? 120;
  if (
    typeof minColumnWidth !== 'number' ||
    !Number.isFinite(minColumnWidth) ||
    minColumnWidth <= 0
  ) {
    throw new Error(
      `min_column_width: must be a number of pixels > 0, got "${String(raw.min_column_width)}"`,
    );
  }

  const accentColor = raw.accent_color ?? DEFAULT_ACCENT_COLOR;
  if (typeof accentColor !== 'string' || accentColor.trim() === '') {
    throw new Error('accent_color: must be a non-empty string');
  }

  if (raw.height !== undefined && (typeof raw.height !== 'string' || raw.height.trim() === '')) {
    throw new Error('height: must be a CSS length string, e.g. "500px"');
  }

  const result: NormalizedConfig = {
    entities,
    mode,
    firstDay,
    days,
    showRange: bool(raw.show_range, true, 'show_range'),
    showNavigation: bool(raw.show_navigation, true, 'show_navigation'),
    navigationReset,
    showEndTime: bool(raw.show_end_time, false, 'show_end_time'),
    showLocation: bool(raw.show_location, true, 'show_location'),
    showEmpty: bool(raw.show_empty, true, 'show_empty'),
    minColumnWidth,
    accentColor,
  };
  if (raw.title !== undefined && raw.title !== null && raw.title !== '') {
    result.title = String(raw.title);
  }
  if (raw.height !== undefined) result.height = raw.height;
  const rows = raw.grid_options?.rows;
  if (typeof rows === 'number' && Number.isFinite(rows) && rows > 0) {
    result.gridRows = rows;
  }
  return result;
}

const WEEKDAY_NAMES: readonly WeekdayName[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

function bool(value: unknown, fallback: boolean, key: string): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${key}: must be true or false`);
  return value;
}

/** Config used when the card is added from the card picker: first 3 `calendar.*` entities. */
export function getStubConfig(hass?: HomeAssistant): ColumnCalendarCardConfig {
  const entities = Object.keys(hass?.states ?? {})
    .filter((id) => id.startsWith('calendar.'))
    .slice(0, 3);
  return { type: 'custom:column-calendar-card', entities };
}
