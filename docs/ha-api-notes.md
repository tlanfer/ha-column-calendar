# HA API notes (researched 2026-10-20 against core/frontend `dev`)

## `calendar/event/subscribe` (HA 2026.5+)

Request (one subscription per entity):

```ts
hass.connection.subscribeMessage<CalendarEventSubscription>(callback, {
  type: 'calendar/event/subscribe',
  entity_id,
  start: start.toISOString(),
  end: end.toISOString(),
}); // → Promise<UnsubscribeFunc>
```

Errors via rejected promise: `not_found`, `invalid_format` (start >= end), `Unauthorized`.

Pushed payload (initial push right after subscribing, then on entity state writes, debounced):

```ts
interface CalendarEventSubscription {
  events: SubEvent[] | null;
} // null = fetch failed → show error state for that calendar
interface SubEvent {
  summary: string;
  start: string; // all-day: "YYYY-MM-DD"; timed: ISO datetime WITH offset (offset may be UTC or local — always honor it)
  end: string; // exclusive; all-day end = day after last day
  all_day: boolean;
  description?: string | null;
  location?: string | null;
  uid?: string | null;
  recurrence_id?: string | null;
  rrule?: string | null;
  status?: string | null;
}
```

- Parse all-day dates as calendar dates in the target tz, NOT `new Date("YYYY-MM-DD")` (UTC midnight).
- Each push replaces that entity's full event list.
- Unsubscribe pattern: `await Promise.all(unsubs.map(u => u.then(f => f()).catch(() => {})))` on disconnect and before re-subscribing.

## `hass.locale`

```ts
time_format: "language" | "system" | "12" | "24"
first_weekday: "language" | "monday" | ... | "sunday"
time_zone: "local" | "server"
```

- First weekday (0 = Sunday): if "language" → `const l = new Intl.Locale(lang); (l.getWeekInfo?.() ?? l.weekInfo)?.firstDay % 7`, fallback Monday (1). Else index of name in `["sunday",...,"saturday"]`.
- 12h: if "language"/"system" → `new Date("January 1, 2023 22:00:00").toLocaleString(tf === "language" ? lang : undefined).includes("10")`; else `tf === "12"`. Pass as `hour12`.
- Time zone: "local" → `Intl.DateTimeFormat().resolvedOptions().timeZone`, "server" → `hass.config.time_zone`.

## Sections sizing

```ts
getGridOptions(): { columns?: number | "full"; rows?: number | "auto"; min_columns?; max_columns?; min_rows?; max_rows? }
```

- 12-column grid; row = 56px, gap 8px. User `config.grid_options` overrides card defaults.
- When rows is numeric, wrapper gets fixed height. Card must use `:host { display:block; height:100% }`, `ha-card { height:100%; box-sizing:border-box; display:flex; flex-direction:column; overflow:hidden }`, body `flex:1; min-height:0; overflow:auto`.
- Detect fixed-height mode: `layout === "grid"` (property set by HA) and `typeof config.grid_options?.rows === "number"`.

## Editors / HA components

- `ha-form`, `ha-entity-picker`, `ha-dialog` are lazy-loaded — not guaranteed defined. Don't use `ha-dialog` (API changed in 2026, brittle) → build own overlay dialog.
- Editor (phase 2): `static getConfigElement()`; force-load pickers via `window.loadCardHelpers()` → `createCardElement({type:"entities",entities:[]})` → `constructor.getConfigElement()`.
