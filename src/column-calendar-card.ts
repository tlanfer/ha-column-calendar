import { LitElement, html, nothing, svg, type PropertyValues } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { styleMap } from 'lit/directives/style-map.js';
import { getStubConfig, normalizeConfig } from './config';
import { bucketEvents, computeRange, resolveFirstDay, resolveTimeZone } from './date-logic';
import { formatDayNumber, formatRangeLabel, formatTime, formatWeekday } from './format';
import { t } from './i18n';
import { CalendarSubscription } from './data/calendar-subscription';
import { cardStyles } from './styles';
import type {
  AllDayItem,
  CalendarEvent,
  ColumnCalendarCardConfig,
  DateRange,
  DayBucket,
  HomeAssistant,
  LovelaceGridOptions,
  NormalizedConfig,
  TimedItem,
} from './types';
import './components/cc-event-dialog';
import './editor/column-calendar-card-editor';

// mdi icon paths (Apache 2.0, Pictogrammers).
const MDI_CHEVRON_LEFT = 'M15.41,16.58L10.83,12L15.41,7.41L14,6L8,12L14,18L15.41,16.58Z';
const MDI_CHEVRON_RIGHT = 'M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z';
const MDI_MAP_MARKER_OUTLINE =
  'M12,6.5A2.5,2.5 0 0,1 14.5,9A2.5,2.5 0 0,1 12,11.5A2.5,2.5 0 0,1 9.5,9A2.5,2.5 0 0,1 12,6.5M12,2A7,7 0 0,1 19,9C19,14.25 12,22 12,22C12,22 5,14.25 5,9A7,7 0 0,1 12,2M12,4A5,5 0 0,0 7,9C7,10 7,12 12,18.71C17,12 17,10 17,9A5,5 0 0,0 12,4Z';
const MDI_ALERT_CIRCLE_OUTLINE =
  'M11,15H13V17H11V15M11,7H13V13H11V7M12,2C6.47,2 2,6.5 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20Z';

const icon = (path: string) =>
  html`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    ${svg`<path d=${path}></path>`}
  </svg>`;

@customElement('column-calendar-card')
export class ColumnCalendarCard extends LitElement {
  @property({ attribute: false }) hass?: HomeAssistant;
  /** Set by HA in sections view ("grid") when the card has a fixed size. */
  @property({ attribute: false }) layout?: string;

  @state() private config?: NormalizedConfig;
  /** Navigation offset in periods (0 = current week / today). */
  @state() private offset = 0;
  @state() private events: CalendarEvent[] = [];
  /** Per-entity subscription errors (entity id → message). */
  @state() private errors: Record<string, string> = {};
  @state() private selected?: CalendarEvent;
  /** Refreshed every minute: drives ended-dimming and midnight/week rollover. */
  @state() private now = new Date();

  @query('.scroller') private scroller?: HTMLElement;

  /** Sections-view fixed size: mirrored to the `fill` host attribute for `:host([fill])`. */
  private fill = false;
  private tz = 'UTC';
  private range?: DateRange;
  private subscription?: CalendarSubscription;
  private subscriptionKey?: string;
  private lastScrolledRangeKey?: string;
  private tickTimer?: ReturnType<typeof setTimeout>;
  private resetTimer?: ReturnType<typeof setTimeout>;

  static getStubConfig(hass?: HomeAssistant): ColumnCalendarCardConfig {
    return getStubConfig(hass);
  }

  /** Visual editor (bundled into the same file; see src/editor/). */
  static async getConfigElement(): Promise<HTMLElement> {
    return document.createElement('column-calendar-card-editor');
  }

  setConfig(config: ColumnCalendarCardConfig): void {
    this.config = normalizeConfig(config);
  }

  getGridOptions(): LovelaceGridOptions {
    return { columns: 12, min_columns: 6, rows: 'auto', min_rows: 3 };
  }

  getCardSize(): number {
    if (this.config?.height) {
      const px = /^(\d+(?:\.\d+)?)px$/.exec(this.config.height.trim());
      if (px) return Math.max(3, Math.round(Number(px[1]) / 50));
    }
    const buckets = this.buckets();
    const busiest = Math.max(0, ...buckets.map((b) => b.timed.length));
    const hasAllDay = buckets.some((b) => b.allDay.length > 0);
    return 3 + (hasAllDay ? 1 : 0) + Math.ceil(busiest * 1.2);
  }

  // ------------------------------------------------------------- lifecycle

  override connectedCallback(): void {
    super.connectedCallback();
    this.now = new Date();
    this.scheduleTick();
    this.armResetTimer();
    // Subscription is (re)created in `willUpdate` once hass + range are known.
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.tickTimer);
    clearTimeout(this.resetTimer);
    this.tickTimer = undefined;
    this.resetTimer = undefined;
    this.teardownSubscription();
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('layout') || changed.has('config')) {
      this.fill = this.isFillMode();
      this.toggleAttribute('fill', this.fill);
    }
    if (this.hass && this.config) {
      this.tz = resolveTimeZone(this.hass);
      const firstDay = resolveFirstDay(this.config, this.hass);
      this.range = computeRange(this.config, this.now, this.offset, this.tz, firstDay);
    } else {
      this.range = undefined;
    }
    // (Re)subscribe here rather than in `updated`: resetting `events`/`errors` now is part
    // of this update cycle instead of scheduling another one ("change-in-update").
    this.syncSubscription();
  }

  protected override updated(): void {
    this.scrollTodayIntoView();
  }

  private isFillMode(): boolean {
    return this.layout === 'grid' && typeof this.config?.gridRows === 'number';
  }

  /** Wake up just after each minute boundary. */
  private scheduleTick(): void {
    clearTimeout(this.tickTimer);
    const delay = 60_000 - (Date.now() % 60_000) + 50;
    this.tickTimer = setTimeout(() => {
      this.now = new Date(); // range recomputed in willUpdate; resubscribe if it changed
      this.scheduleTick();
    }, delay);
  }

  private rangeKey(): string | undefined {
    const r = this.range;
    return r ? `${r.start.getTime()}|${r.end.getTime()}` : undefined;
  }

  private syncSubscription(): void {
    const { hass, config, range } = this;
    if (!this.isConnected || !hass || !config || !range) return;
    const key = [
      this.rangeKey(),
      this.tz,
      config.entities.map((e) => `${e.entity}|${e.color}|${e.name ?? ''}`).join(','),
    ].join('#');
    if (key === this.subscriptionKey) return;

    this.teardownSubscription();
    this.subscriptionKey = key;
    this.events = [];
    this.errors = {};
    const sub: CalendarSubscription = new CalendarSubscription({
      hass,
      entities: config.entities,
      range,
      tz: this.tz,
      onEvents: (events) => {
        if (this.subscription === sub) this.events = events;
      },
      onError: (entity, error) => {
        if (this.subscription !== sub) return;
        this.errors = { ...this.errors, [entity]: errorMessage(error) };
      },
    });
    this.subscription = sub;
    sub.subscribe().catch((err: unknown) => {
      if (this.subscription === sub) {
        console.error('column-calendar-card: subscribe failed', err);
      }
    });
  }

  private teardownSubscription(): void {
    const sub = this.subscription;
    this.subscription = undefined;
    this.subscriptionKey = undefined;
    if (sub) void sub.unsubscribe().catch(() => {});
  }

  /** Horizontally scroll today's column into view when the range changes (never the page). */
  private scrollTodayIntoView(): void {
    const key = this.rangeKey();
    const scroller = this.scroller;
    if (!key || !scroller || key === this.lastScrolledRangeKey) return;
    this.lastScrolledRangeKey = key;
    const today = scroller.querySelector<HTMLElement>('.col-head.today');
    if (!today) {
      scroller.scrollLeft = 0;
      return;
    }
    if (scroller.scrollWidth <= scroller.clientWidth) return;
    // Measure via rects: offsetLeft would be relative to the offsetParent, not the scroller.
    const delta = today.getBoundingClientRect().left - scroller.getBoundingClientRect().left;
    scroller.scrollLeft += delta;
  }

  // ------------------------------------------------------------ navigation

  private navigate(delta: number | 'today'): void {
    this.offset = delta === 'today' ? 0 : this.offset + delta;
    this.armResetTimer();
  }

  private armResetTimer(): void {
    clearTimeout(this.resetTimer);
    this.resetTimer = undefined;
    const seconds = this.config?.navigationReset ?? 0;
    if (seconds <= 0 || this.offset === 0) return;
    this.resetTimer = setTimeout(() => {
      this.offset = 0;
    }, seconds * 1000);
  }

  // ---------------------------------------------------------------- render

  private buckets(): DayBucket[] {
    if (!this.range) return [];
    return bucketEvents(this.events, this.range, this.now, this.tz);
  }

  protected override render() {
    const { config, hass, range } = this;
    if (!config) return nothing;

    const cardClasses = {
      fill: this.fill,
      fixed: this.fill || !!config.height,
    };
    const cardStyle = {
      '--cc-accent': config.accentColor,
      '--cc-min-col': `${config.minColumnWidth}px`,
      height: !this.fill && config.height ? config.height : undefined,
    };

    if (!hass || !range) {
      return html`<ha-card class=${classMap(cardClasses)} style=${styleMap(cardStyle)}></ha-card>`;
    }

    const buckets = this.buckets();
    const hasAllDay = buckets.some((b) => b.allDay.length > 0);
    // Fixed height: the body row takes the remaining space and each body cell scrolls.
    const bodyRow = cardClasses.fixed ? 'minmax(0, 1fr)' : 'auto';
    const gridStyle = {
      '--cc-cols': String(buckets.length),
      gridTemplateRows: hasAllDay ? `auto auto ${bodyRow}` : `auto ${bodyRow}`,
    };

    return html`
      <ha-card class=${classMap(cardClasses)} style=${styleMap(cardStyle)}>
        ${this.renderHeader(config, hass, range)}
        <div class="scroller">
          <div class="grid" style=${styleMap(gridStyle)}>
            ${buckets.map((b, i) => this.renderColumnHead(b, i, hass))}
            ${hasAllDay ? buckets.map((b, i) => this.renderAllDayCell(b, i, hass)) : nothing}
            ${buckets.map((b, i) => this.renderBodyCell(b, i, config, hass))}
          </div>
        </div>
      </ha-card>
      <cc-event-dialog
        .hass=${hass}
        .event=${this.selected}
        .tz=${this.tz}
        @closed=${() => (this.selected = undefined)}
      ></cc-event-dialog>
    `;
  }

  private renderHeader(config: NormalizedConfig, hass: HomeAssistant, range: DateRange) {
    const errorEntities = Object.keys(this.errors);
    const title = config.title?.trim();
    if (!title && !config.showRange && !config.showNavigation && !errorEntities.length) {
      return nothing;
    }
    const nav = config.showNavigation;
    return html`
      <div class=${classMap({ header: true, 'no-title': !title })}>
        <div class="header-left">
          ${
            nav
              ? html`<button
                  class="icon-btn"
                  type="button"
                  title=${t(hass, 'previous')}
                  aria-label=${t(hass, 'previous')}
                  @click=${() => this.navigate(-1)}
                >
                  ${icon(MDI_CHEVRON_LEFT)}
                </button>`
              : nothing
          }
          ${
            config.showRange
              ? html`<span class="range" aria-live="polite"
                  >${formatRangeLabel(range, hass, this.tz)}</span
                >`
              : nothing
          }
          ${
            nav
              ? html`<button
                  class="icon-btn"
                  type="button"
                  title=${t(hass, 'next')}
                  aria-label=${t(hass, 'next')}
                  @click=${() => this.navigate(1)}
                >
                  ${icon(MDI_CHEVRON_RIGHT)}
                </button>`
              : nothing
          }
        </div>
        ${title ? html`<div class="title">${title}</div>` : nothing}
        <div class="header-right">
          ${
            nav
              ? html`<button
                  class=${classMap({ 'today-btn': true, active: this.offset !== 0 })}
                  type="button"
                  @click=${() => this.navigate('today')}
                >
                  ${t(hass, 'today')}
                </button>`
              : nothing
          }
        </div>
        ${
          errorEntities.length
            ? html`<div class="errors" role="status">
                ${errorEntities.map(
                  (entity) =>
                    html`<span title=${this.errors[entity]}
                      >${icon(MDI_ALERT_CIRCLE_OUTLINE)}${t(hass, 'error_loading', {
                        name: this.entityName(entity, hass),
                      })}</span
                    >`,
                )}
              </div>`
            : nothing
        }
      </div>
    `;
  }

  private cellClasses(b: DayBucket, i: number, kind: string) {
    return classMap({ cell: true, [kind]: true, first: i === 0, today: b.isToday, past: b.isPast });
  }

  private renderColumnHead(b: DayBucket, i: number, hass: HomeAssistant) {
    return html`<div
      class=${this.cellClasses(b, i, 'col-head')}
      aria-current=${b.isToday ? 'date' : nothing}
    >
      <div>
        <span class="weekday">${formatWeekday(b.date, hass, this.tz)}</span>
        <span class="daynum">${formatDayNumber(b.date, this.tz)}</span>
      </div>
    </div>`;
  }

  private renderAllDayCell(b: DayBucket, i: number, hass: HomeAssistant) {
    return html`<div class=${this.cellClasses(b, i, 'allday')}>
      ${b.allDay.map((item) => this.renderChip(item, hass))}
    </div>`;
  }

  private renderChip(item: AllDayItem, hass: HomeAssistant) {
    const { event } = item;
    return html`<button
      class="chip"
      type="button"
      style=${styleMap({ '--cc-color': event.color || 'var(--cc-accent)' })}
      title=${event.summary}
      @click=${() => (this.selected = event)}
    >
      <span class="chip-title">${event.summary}</span>${
        item.dayIndex > 1
          ? html`<span class="hint"
              >${t(hass, 'day_n_of_m', { n: item.dayIndex, m: item.totalDays })}</span
            >`
          : nothing
      }
    </button>`;
  }

  private renderBodyCell(b: DayBucket, i: number, config: NormalizedConfig, hass: HomeAssistant) {
    return html`<div class=${this.cellClasses(b, i, 'body')}>
      ${
        b.timed.length
          ? b.timed.map((item) => this.renderEvent(item, config, hass))
          : config.showEmpty
            ? html`<div class="empty">${t(hass, 'no_events')}</div>`
            : nothing
      }
    </div>`;
  }

  private renderEvent(item: TimedItem, config: NormalizedConfig, hass: HomeAssistant) {
    const { event } = item;
    const location = config.showLocation ? event.location?.trim() : undefined;
    return html`<button
      class=${classMap({ event: true, ended: item.isEnded })}
      type="button"
      style=${styleMap({ '--cc-color': event.color || 'var(--cc-accent)' })}
      @click=${() => (this.selected = event)}
    >
      <span class="time">${this.timeLabel(item, config, hass)}</span>
      <span class="summary">${event.summary}</span>
      ${
        location
          ? html`<span class="location"
              >${icon(MDI_MAP_MARKER_OUTLINE)}<span>${location}</span></span
            >`
          : nothing
      }
    </button>`;
  }

  /** "09:30", "09:30 – 10:30" (show_end_time), "… – 02:00" (continues from yesterday). */
  private timeLabel(item: TimedItem, config: NormalizedConfig, hass: HomeAssistant): string {
    const { event } = item;
    const start = item.startsBeforeDay ? '…' : formatTime(event.start, hass, this.tz);
    if (!config.showEndTime && !item.startsBeforeDay) return start;
    const end = item.endsAfterDay ? '…' : formatTime(event.end, hass, this.tz);
    return `${start} – ${end}`;
  }

  private entityName(entity: string, hass: HomeAssistant): string {
    const configured = this.config?.entities.find((e) => e.entity === entity)?.name;
    return configured ?? hass.states[entity]?.attributes.friendly_name ?? entity;
  }

  static override styles = cardStyles;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

declare global {
  interface HTMLElementTagNameMap {
    'column-calendar-card': ColumnCalendarCard;
  }
  interface Window {
    customCards?: { type: string; name: string; description?: string; preview?: boolean }[];
  }
}

window.customCards ??= [];
window.customCards.push({
  type: 'column-calendar-card',
  name: 'Column Calendar Card',
  description: 'Calendar events from multiple calendars as day columns.',
  preview: true,
});
