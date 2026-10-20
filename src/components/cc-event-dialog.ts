import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { formatDateTimeRange } from '../format';
import { t } from '../i18n';
import type { CalendarEvent, HomeAssistant } from '../types';

/** mdi:map-marker-outline */
const MAP_MARKER_PATH =
  'M12,6.5A2.5,2.5 0 0,1 14.5,9A2.5,2.5 0 0,1 12,11.5A2.5,2.5 0 0,1 9.5,9A2.5,2.5 0 0,1 12,6.5M12,2A7,7 0 0,1 19,9C19,14.25 12,22 12,22C12,22 5,14.25 5,9A7,7 0 0,1 12,2M12,4A5,5 0 0,0 7,9C7,10 7,12 12,18.71C17,12 17,10 17,9A5,5 0 0,0 12,4Z';

/** mdi:close */
const CLOSE_PATH =
  'M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z';

/**
 * Read-only event details dialog owned by the card.
 * Shows title, start–end, location, description, calendar name with color dot.
 * Renders nothing while `event` is undefined. Fires `closed` (bubbles, composed)
 * when the user dismisses it (close button, Esc, backdrop click); the parent
 * then clears `event`.
 *
 * Uses a native `<dialog>` opened with `showModal()`, which renders in the top
 * layer (escaping the card's shadow DOM / overflow) and handles focus + Esc.
 */
@customElement('cc-event-dialog')
export class CcEventDialog extends LitElement {
  @property({ attribute: false }) hass?: HomeAssistant;
  @property({ attribute: false }) event?: CalendarEvent;
  /** Display time zone for formatting. */
  @property({ attribute: false }) tz?: string;

  @query('dialog') private dialogEl?: HTMLDialogElement;

  static override styles = css`
    :host {
      display: contents;
    }
    dialog {
      box-sizing: border-box;
      width: min(420px, 92vw);
      max-width: 420px;
      max-height: 80vh;
      padding: 0;
      margin: auto;
      border: none;
      border-radius: 16px;
      overflow: hidden;
      background: var(--card-background-color, var(--ha-card-background, #fff));
      color: var(--primary-text-color, #212121);
      box-shadow:
        0 12px 32px rgba(0, 0, 0, 0.18),
        0 2px 6px rgba(0, 0, 0, 0.08);
      font-family: inherit;
    }
    dialog::backdrop {
      background: rgba(0, 0, 0, 0.4);
    }
    .content {
      position: relative;
      box-sizing: border-box;
      max-height: 80vh;
      overflow-y: auto;
      padding: 20px 20px 22px 26px;
    }
    .bar {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
      width: 6px;
      background: var(--cc-event-color, var(--cc-accent, #e8173a));
    }
    .close {
      position: absolute;
      top: 10px;
      right: 10px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: transparent;
      color: var(--secondary-text-color, #727272);
      cursor: pointer;
    }
    .close:hover,
    .close:focus-visible {
      background: color-mix(in srgb, var(--primary-text-color, #212121) 8%, transparent);
      outline: none;
    }
    .close svg {
      width: 22px;
      height: 22px;
      fill: currentColor;
    }
    h2 {
      margin: 0 40px 4px 0;
      font-size: 1.25rem;
      font-weight: 700;
      line-height: 1.3;
      overflow-wrap: anywhere;
    }
    .when {
      margin: 0 40px 0 0;
      font-size: 0.95rem;
      font-weight: 500;
      color: var(--cc-accent, #e8173a);
    }
    .section {
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
    }
    .label {
      margin-bottom: 4px;
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--secondary-text-color, #727272);
    }
    .row {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      color: var(--secondary-text-color, #727272);
      overflow-wrap: anywhere;
    }
    .row svg {
      flex: none;
      width: 18px;
      height: 18px;
      margin-top: 1px;
      fill: currentColor;
    }
    .description {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      line-height: 1.45;
    }
    .calendar {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .dot {
      flex: none;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--cc-event-color, var(--cc-accent, #e8173a));
    }
  `;

  protected override render() {
    const ev = this.event;
    if (!ev) return nothing;
    const when = this.formatWhen(ev);
    return html`
      <dialog
        aria-labelledby="cc-dialog-title"
        style="--cc-event-color: ${ev.color}"
        @cancel=${this.onCancel}
        @click=${this.onDialogClick}
      >
        <div class="content">
          <span class="bar" aria-hidden="true"></span>
          <button
            class="close"
            type="button"
            aria-label=${t(this.hass, 'close')}
            title=${t(this.hass, 'close')}
            @click=${this.close}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d=${CLOSE_PATH}></path></svg>
          </button>
          <h2 id="cc-dialog-title">${ev.summary}</h2>
          ${when ? html`<p class="when">${when}</p>` : nothing}
          ${
            ev.location
              ? html`<div class="section">
                  <div class="label">${t(this.hass, 'location')}</div>
                  <div class="row location">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d=${MAP_MARKER_PATH}></path>
                    </svg>
                    <span>${ev.location}</span>
                  </div>
                </div>`
              : nothing
          }
          ${
            ev.description
              ? html`<div class="section">
                  <div class="label">${t(this.hass, 'description')}</div>
                  <div class="description">${ev.description}</div>
                </div>`
              : nothing
          }
          <div class="section">
            <div class="label">${t(this.hass, 'calendar')}</div>
            <div class="calendar">
              <span class="dot" aria-hidden="true"></span>
              <span class="calendar-name">${ev.calendarName}</span>
            </div>
          </div>
        </div>
      </dialog>
    `;
  }

  protected override updated(changed: PropertyValues<this>): void {
    super.updated(changed);
    if (changed.has('event') && this.event) this.openDialog();
  }

  private formatWhen(ev: CalendarEvent): string {
    if (!this.hass) return '';
    const tz =
      this.tz || this.hass.config?.time_zone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      return formatDateTimeRange(ev, this.hass, tz);
    } catch {
      return '';
    }
  }

  private openDialog(): void {
    const dialog = this.dialogEl;
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === 'function') {
      try {
        dialog.showModal();
        return;
      } catch {
        // Not connected / unsupported: fall through to plain open attribute.
      }
    }
    dialog.setAttribute('open', '');
  }

  /** Esc: keep the dialog under our control and let the parent clear `event`. */
  private onCancel(e: Event): void {
    e.preventDefault();
    this.close();
  }

  /** Clicks directly on the <dialog> element (not its content) hit the backdrop. */
  private onDialogClick(e: MouseEvent): void {
    if (e.target === this.dialogEl) this.close();
  }

  protected close(): void {
    const dialog = this.dialogEl;
    if (dialog?.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
    this.dispatchEvent(new CustomEvent('closed', { bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'cc-event-dialog': CcEventDialog;
  }
}
