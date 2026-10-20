# Column Calendar Card — Spec

A Home Assistant custom Lovelace card that shows events from multiple `calendar.*` entities as day columns (one column per day, events listed vertically). Visual reference: clean light layout, weekday label + big day number per column header on a subtly shaded header row, red start times, bold titles, grey location with pin icon, thin vertical dividers between columns. No date picker.

## Stack & distribution
- TypeScript + Lit 3 + Vite, bundled to a single `dist/column-calendar-card.js`.
- Repo `tlanfer/ha-column-calendar`, HACS "Dashboard" (plugin) repo, MIT license.
- Custom element `column-calendar-card` → config `type: custom:column-calendar-card`; registered in `window.customCards`.
- Dev: `dev/index.html` harness with Vite HMR, mocked `hass`, fake events. `npm run deploy` builds and copies to HA's `/config/www/` (target from git-ignored `.env`).
- GitHub Actions: lint + test + build; release job attaching the built JS.

## Range
- `mode: week | rolling`.
- `week`: first day from `first_day` (`auto` default = `hass.locale.first_weekday`, which itself may be "language" → derive from locale; or explicit `monday`…`sunday`). Shows all 7 days; past days dimmed; already-ended events today dimmed; today highlighted with accent.
- `rolling`: `days: N` = total columns including today, default 7.
- Automatic rollover at midnight / new week.

## Calendars
- `entities`: mixed list of `calendar.x` strings or `{ entity, color?, name? }`.
- Missing colors auto-assigned from a fixed palette (stable by index).
- Calendar color → time label color + thin left bar on the event.

## Layout
- Header: optional `title`, range label (`show_range`, default true), prev/next arrows + "today" button (`show_navigation`, default true). Navigation shifts by one period (7 days in week mode, N days in rolling). Navigation offset resets to 0 after `navigation_reset` seconds idle (default 120, 0 = never) and on reload.
- Column header: weekday short name (uppercase) + large day number. Today in accent color.
- All-day strip: row between column headers and timed events; all-day items as colored chips. Multi-day events repeated per column, with "Day 2/5" hint on days after the first.
- Timed events: start time (+ end time if `show_end_time`, default false), bold title, location with pin icon (`show_location`, default true, clamped to 2 lines). Sorted by start time, then by entity order. Timed events crossing midnight appear on every day they touch.
- Empty days: muted "No events" placeholder; `show_empty: false` → blank.
- Width: columns share width equally with minimum `min_column_width` (px, default 120); overflow → horizontal scroll, today scrolled into view.
- Height: auto by default (fits busiest column; dividers full height). Fixed `height` (CSS length) → each column scrolls vertically independently.
- Sections view: `getGridOptions()` → `{ columns: 12, min_columns: 6, rows: "auto", min_rows: 3 }`. If user sets numeric `grid_options.rows`, card fills 100% of given height and columns scroll. Precedence: sections numeric rows > `height` > auto.

## Interaction
- Tap event → card-owned read-only details dialog: title, start–end, location, description, calendar name (+ color).

## Theming
- Use HA theme vars (`--card-background-color`/`--ha-card-background`, `--primary-text-color`, `--secondary-text-color`, `--divider-color`) so light/dark both work.
- `accent_color` option, default `#e8173a`; used for today + fallback time color. Header row shading via `color-mix()` from theme background.

## Data
- WebSocket `calendar/event/subscribe` per entity for visible range; re-subscribe on navigation and rollover; unsubscribe on disconnect. No REST fallback. Min HA version in `hacs.json`.

## Time & locale
- Time zone follows HA user setting: `hass.locale.time_zone` = `local` → browser zone, `server` → `hass.config.time_zone`. Date math with `date-fns` + `@date-fns/tz`.
- 12/24h per `hass.locale.time_format` (`language` | `system` | `12` | `24`); day/month names via `Intl` with `hass.locale.language`.
- Card strings: English + German map, English fallback.

## Testing
- Vitest unit tests: ranges, week start, navigation, all-day/multi-day, timezone/DST, config normalization.
- Component tests: render card with mocked `hass` + fake subscription; check columns, today highlight, dialog, subscribe/unsubscribe lifecycle.

## Phases
1. YAML config + all of the above + `getStubConfig()`.
2. Visual editor: `ha-form` for general options + custom entity list rows (entity picker, color picker, name).

## Example config
```yaml
type: custom:column-calendar-card
mode: week          # week | rolling
first_day: auto     # week mode
days: 7             # rolling mode
title: Family
entities:
  - calendar.family
  - entity: calendar.work
    color: "#1e88e5"
    name: Work
show_range: true
show_navigation: true
navigation_reset: 120
show_end_time: false
show_location: true
show_empty: true
min_column_width: 120
accent_color: "#e8173a"
# height: 500px
```
