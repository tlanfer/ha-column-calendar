import { css } from 'lit';

/** Card styles. Per-instance values arrive as CSS custom properties set on `ha-card`. */
export const cardStyles = css`
  :host {
    display: block;
    --cc-accent: #e8173a;
    --cc-min-col: 120px;
    --cc-text: var(--primary-text-color, #1c1c1e);
    --cc-muted: var(--secondary-text-color, #6e6e73);
    --cc-divider: var(--divider-color, rgba(0, 0, 0, 0.09));
    --cc-bg: var(--ha-card-background, var(--card-background-color, #fff));
    --cc-head-bg: color-mix(in srgb, var(--cc-text) 3.5%, var(--cc-bg));
    --cc-dim: 0.45;
  }

  /* Sections view with numeric rows: fill the wrapper's fixed height. */
  :host([fill]) {
    height: 100%;
  }

  /* Fallback when running outside Home Assistant (ha-card not registered). */
  ha-card:not(:defined) {
    background: var(--cc-bg);
    color: var(--cc-text);
    border-radius: var(--ha-card-border-radius, 12px);
    border: 1px solid var(--cc-divider);
    font-family: var(--ha-font-family-body, Roboto, system-ui, sans-serif);
  }

  ha-card {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    overflow: hidden;
    color: var(--cc-text);
  }

  ha-card.fill {
    height: 100%;
  }

  /* ---------------------------------------------------------------- header */

  .header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    flex: none;
  }

  /* Without a title the range label may use all space left of the "today" button. */
  .header.no-title {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .header-left,
  .header-right {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }

  .header-right {
    justify-content: flex-end;
  }

  .range {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-inline-start: 4px;
  }

  .title {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.01em;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .icon-btn,
  .today-btn {
    font: inherit;
    color: inherit;
    background: none;
    border: none;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border-radius: 50%;
  }

  .icon-btn svg {
    width: 22px;
    height: 22px;
    fill: currentColor;
  }

  .today-btn {
    padding: 5px 12px;
    border-radius: 999px;
    border: 1px solid var(--cc-divider);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .today-btn.active {
    color: var(--cc-accent);
    border-color: color-mix(in srgb, var(--cc-accent) 45%, transparent);
  }

  .icon-btn:hover,
  .today-btn:hover {
    background: color-mix(in srgb, var(--cc-text) 6%, transparent);
  }

  .icon-btn:focus-visible,
  .today-btn:focus-visible,
  .event:focus-visible,
  .chip:focus-visible {
    outline: 2px solid var(--cc-accent);
    outline-offset: 2px;
  }

  .errors {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: 11px;
    color: var(--warning-color, #c77700);
  }

  .errors span {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  .errors svg {
    width: 13px;
    height: 13px;
    fill: currentColor;
  }

  /* ------------------------------------------------------------------ grid */

  .scroller {
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
    flex: 1 1 auto;
    min-height: 0;
    border-top: 1px solid var(--cc-divider);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(var(--cc-cols, 7), minmax(var(--cc-min-col), 1fr));
    min-width: min-content;
  }

  .fixed .grid {
    height: 100%;
  }

  .cell {
    border-inline-start: 1px solid var(--cc-divider);
    min-width: 0;
  }

  .cell.first {
    border-inline-start: none;
  }

  .past > * {
    opacity: var(--cc-dim);
  }

  .col-head {
    background: var(--cc-head-bg);
    border-bottom: 1px solid var(--cc-divider);
    padding: 12px 14px 10px;
  }

  .weekday {
    display: block;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--cc-muted);
  }

  .daynum {
    display: block;
    font-size: 40px;
    font-weight: 700;
    line-height: 1.05;
    letter-spacing: -0.02em;
  }

  .today .weekday,
  .today .daynum {
    color: var(--cc-accent);
  }

  .allday {
    border-bottom: 1px solid var(--cc-divider);
    padding: 8px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .chip {
    font: inherit;
    text-align: start;
    color: var(--cc-text);
    cursor: pointer;
    display: block;
    width: 100%;
    box-sizing: border-box;
    border: none;
    border-inline-start: 3px solid var(--cc-color);
    border-radius: 4px;
    padding: 3px 6px;
    background: color-mix(in srgb, var(--cc-color) 16%, var(--cc-bg));
    font-size: 12px;
    font-weight: 600;
    line-height: 1.25;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .chip-title,
  .chip .hint {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Own line, so long titles cannot ellipsize the "Day 2/5" hint away. */
  .chip .hint {
    font-size: 11px;
    font-weight: 400;
    color: var(--cc-muted);
  }

  .body {
    padding: 16px 14px 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .fixed .body {
    overflow-y: auto;
    min-height: 0;
    scrollbar-width: thin;
  }

  .empty {
    font-size: 12px;
    color: var(--cc-muted);
    font-style: italic;
  }

  /* ---------------------------------------------------------------- events */

  .event {
    font: inherit;
    color: inherit;
    text-align: start;
    background: none;
    border: none;
    margin: 0;
    cursor: pointer;
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 1px 0 1px 9px;
    border-inline-start: 2px solid var(--cc-color);
    border-radius: 0;
  }

  .event.ended {
    opacity: var(--cc-dim);
  }

  .time {
    display: block;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--cc-color);
    margin-bottom: 2px;
    font-variant-numeric: tabular-nums;
  }

  .summary {
    display: block;
    font-size: 13px;
    font-weight: 700;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }

  .location {
    display: flex;
    gap: 3px;
    margin-top: 4px;
    font-size: 11px;
    line-height: 1.3;
    color: var(--cc-muted);
  }

  .location svg {
    flex: none;
    width: 12px;
    height: 12px;
    margin-top: 1px;
    fill: currentColor;
  }

  .location span {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
`;
