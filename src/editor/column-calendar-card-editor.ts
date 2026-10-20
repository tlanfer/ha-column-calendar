import { LitElement, css, html, nothing, svg } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { DEFAULT_ACCENT_COLOR, PALETTE } from '../config';
import { isTranslationKey, t, type TranslationKey } from '../i18n';
import type { ColumnCalendarCardConfig, EntityConfig, HassEntity, HomeAssistant } from '../types';

// ---------------------------------------------------------------------------
// Pure config helpers (exported for tests)
// ---------------------------------------------------------------------------

/** Defaults of the general options; a value equal to its default is removed from the config. */
export const GENERAL_DEFAULTS = {
  mode: 'week',
  first_day: 'auto',
  days: 7,
  show_range: true,
  show_navigation: true,
  navigation_reset: 120,
  show_end_time: false,
  show_location: true,
  show_empty: true,
  min_column_width: 120,
  accent_color: DEFAULT_ACCENT_COLOR,
} as const satisfies Partial<Record<keyof ColumnCalendarCardConfig, unknown>>;

/** Keys edited by the general-options form. */
export type GeneralKey = keyof typeof GENERAL_DEFAULTS | 'title' | 'height';

/** Minimal `ha-form` schema subset used by this editor. */
export interface FormSchema {
  name: string;
  type?: 'grid';
  schema?: FormSchema[];
  column_min_width?: string;
  selector?: {
    select?: { mode?: 'dropdown' | 'list'; options: { value: string; label: string }[] };
    number?: { min?: number; max?: number; step?: number; mode?: 'box' | 'slider' };
    boolean?: Record<string, never>;
    text?: Record<string, never>;
  };
}

type RawConfig = ColumnCalendarCardConfig & Record<string, unknown>;
type Translate = (key: TranslationKey) => string;

const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

/**
 * Builds the `ha-form` schema for the general options. Fields depending on other
 * options are only included when relevant: `first_day` in week mode, `days` in rolling
 * mode, `navigation_reset` while navigation is shown.
 */
export function buildSchema(
  config: Partial<ColumnCalendarCardConfig>,
  translate: Translate = (key) => key,
  language = 'en',
): FormSchema[] {
  const mode = config.mode ?? GENERAL_DEFAULTS.mode;
  const weekdayName = (index: number) =>
    new Intl.DateTimeFormat(language, { weekday: 'long', timeZone: 'UTC' }).format(
      // 2023-01-02 was a Monday.
      new Date(Date.UTC(2023, 0, 2 + index)),
    );

  const rangeFields: FormSchema[] = [
    {
      name: 'mode',
      selector: {
        select: {
          mode: 'dropdown',
          options: [
            { value: 'week', label: translate('editor_mode_week') },
            { value: 'rolling', label: translate('editor_mode_rolling') },
          ],
        },
      },
    },
  ];
  if (mode === 'week') {
    rangeFields.push({
      name: 'first_day',
      selector: {
        select: {
          mode: 'dropdown',
          options: [
            { value: 'auto', label: translate('editor_first_day_auto') },
            ...WEEKDAYS.map((day, i) => ({ value: day, label: weekdayName(i) })),
          ],
        },
      },
    });
  } else {
    rangeFields.push({ name: 'days', selector: { number: { min: 1, max: 31, mode: 'box' } } });
  }

  const navigationFields: FormSchema[] = [{ name: 'show_navigation', selector: { boolean: {} } }];
  if (config.show_navigation !== false) {
    navigationFields.push({
      name: 'navigation_reset',
      selector: { number: { min: 0, step: 1, mode: 'box' } },
    });
  }

  return [
    { name: '', type: 'grid', schema: rangeFields },
    { name: 'title', selector: { text: {} } },
    { name: '', type: 'grid', schema: navigationFields },
    {
      name: '',
      type: 'grid',
      schema: [
        { name: 'show_range', selector: { boolean: {} } },
        { name: 'show_end_time', selector: { boolean: {} } },
        { name: 'show_location', selector: { boolean: {} } },
        { name: 'show_empty', selector: { boolean: {} } },
      ],
    },
    {
      name: '',
      type: 'grid',
      schema: [
        { name: 'min_column_width', selector: { number: { min: 1, step: 1, mode: 'box' } } },
        { name: 'height', selector: { text: {} } },
      ],
    },
    { name: 'accent_color', selector: { text: {} } },
  ];
}

/** Leaf fields of a schema (grids flattened). */
export function schemaFields(schema: FormSchema[]): FormSchema[] {
  return schema.flatMap((item) => (item.schema ? schemaFields(item.schema) : [item]));
}

/** Values shown in the form: configured value, else the default (so toggles render correctly). */
export function formData(config: Partial<ColumnCalendarCardConfig>): Record<string, unknown> {
  return { ...GENERAL_DEFAULTS, ...pickGeneral(config) };
}

function pickGeneral(config: Partial<ColumnCalendarCardConfig>): Record<string, unknown> {
  const keys: GeneralKey[] = [
    ...(Object.keys(GENERAL_DEFAULTS) as GeneralKey[]),
    'title',
    'height',
  ];
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (config[key] !== undefined) result[key] = config[key];
  }
  return result;
}

/**
 * Sets one option. Empty values (`undefined`, `null`, `''`) and values equal to the
 * default delete the key, so the YAML stays minimal. Returns a new object.
 */
export function setOption<C extends Partial<ColumnCalendarCardConfig>>(
  config: C,
  key: string,
  value: unknown,
): C {
  const next: Record<string, unknown> = { ...config };
  const defaults: Record<string, unknown> = GENERAL_DEFAULTS;
  if (value === undefined || value === null || value === '' || defaults[key] === value) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next as C;
}

/** Applies only the keys whose form value changed between `before` and `after`. */
export function applyFormChange<C extends Partial<ColumnCalendarCardConfig>>(
  config: C,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): C {
  let next = config;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[key] !== after[key]) next = setOption(next, key, after[key]);
  }
  return next;
}

/** Entity list item as object (strings and junk entries become `{ entity }`). */
export function entityObject(item: unknown): EntityConfig {
  if (typeof item === 'string') return { entity: item };
  if (item && typeof item === 'object' && typeof (item as EntityConfig).entity === 'string') {
    return item as EntityConfig;
  }
  return { entity: '' };
}

/**
 * Compacts an entity item: drops empty `color` / `name`, collapses to the short
 * `calendar.x` string form when no other key is left. Unknown keys are kept.
 */
export function compactEntity(item: EntityConfig): string | EntityConfig {
  const next: Record<string, unknown> = { ...item };
  for (const key of ['color', 'name'] as const) {
    if (next[key] === undefined || next[key] === null || next[key] === '') delete next[key];
  }
  return Object.keys(next).length === 1 && 'entity' in next
    ? item.entity
    : (next as unknown as EntityConfig);
}

function entityList(config: Partial<ColumnCalendarCardConfig>): unknown[] {
  return Array.isArray(config.entities) ? config.entities : [];
}

export function addEntity<C extends Partial<ColumnCalendarCardConfig>>(
  config: C,
  entity: string,
): C {
  return { ...config, entities: [...entityList(config), entity] };
}

export function updateEntity<C extends Partial<ColumnCalendarCardConfig>>(
  config: C,
  index: number,
  patch: Partial<EntityConfig>,
): C {
  const entities = [...entityList(config)];
  entities[index] = compactEntity({ ...entityObject(entities[index]), ...patch });
  return { ...config, entities } as C;
}

export function removeEntity<C extends Partial<ColumnCalendarCardConfig>>(
  config: C,
  index: number,
): C {
  return { ...config, entities: entityList(config).filter((_, i) => i !== index) } as C;
}

export function moveEntity<C extends Partial<ColumnCalendarCardConfig>>(
  config: C,
  from: number,
  to: number,
): C {
  const entities = [...entityList(config)];
  if (to < 0 || to >= entities.length || from === to) return config;
  const [item] = entities.splice(from, 1);
  entities.splice(to, 0, item);
  return { ...config, entities } as C;
}

/** `#rgb` / `#rrggbb` → `#rrggbb` (what `<input type="color">` accepts), else undefined. */
export function toHexColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const value = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(value);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : undefined;
}

// ---------------------------------------------------------------------------
// Lazy loading of HA's form components
// ---------------------------------------------------------------------------

const HA_TAGS = ['ha-form', 'ha-entity-picker'] as const;
let loading: Promise<void> | undefined;

/**
 * `ha-form` / `ha-entity-picker` are lazy-loaded by HA. Opening the built-in entities
 * card editor once forces them to load. Resolves when both are defined or after a
 * timeout (then the editor keeps its native fallback inputs).
 */
export function loadHaComponents(timeoutMs = 5000): Promise<void> {
  if (HA_TAGS.every((tag) => customElements.get(tag))) return Promise.resolve();
  loading ??= (async () => {
    try {
      const helpers = await window.loadCardHelpers?.();
      if (!helpers) return;
      const card = await helpers.createCardElement({ type: 'entities', entities: [] });
      const ctor = card.constructor as { getConfigElement?: () => Promise<unknown> };
      await ctor.getConfigElement?.();
      await Promise.race([
        Promise.all(HA_TAGS.map((tag) => customElements.whenDefined(tag))),
        new Promise((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    } catch {
      // Keep the native fallback.
    }
  })();
  return loading;
}

// ---------------------------------------------------------------------------
// Element
// ---------------------------------------------------------------------------

const MDI_ARROW_UP = 'M13,20H11V8L5.5,13.5L4.08,12.08L12,4.16L19.92,12.08L18.5,13.5L13,8V20Z';
const MDI_ARROW_DOWN = 'M11,4H13V16L18.5,10.5L19.92,11.92L12,19.84L4.08,11.92L5.5,10.5L11,16V4Z';
const MDI_DELETE =
  'M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z';
const MDI_CLOSE =
  'M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z';

const icon = (path: string) =>
  html`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    ${svg`<path d=${path}></path>`}
  </svg>`;

const isCalendar = (entity: HassEntity) => entity.entity_id.startsWith('calendar.');

@customElement('column-calendar-card-editor')
export class ColumnCalendarCardEditor extends LitElement {
  @property({ attribute: false }) hass?: HomeAssistant;
  @state() private config: RawConfig = { type: 'custom:column-calendar-card', entities: [] };

  setConfig(config: ColumnCalendarCardConfig): void {
    // No validation here: the user may be mid-edit (e.g. empty entity list).
    this.config = { ...(config as RawConfig) };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void loadHaComponents().then(() => this.requestUpdate());
  }

  private t = (key: TranslationKey) => t(this.hass, key);

  private commit(config: RawConfig): void {
    this.config = config;
    this.dispatchEvent(
      new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }),
    );
  }

  protected override render() {
    const haForm = !!customElements.get('ha-form');
    const picker = !!customElements.get('ha-entity-picker');
    return html`
      ${
        haForm && picker
          ? nothing
          : html`<p class="note">${this.t('editor_components_unavailable')}</p>`
      }
      <section>
        <h3>${this.t('editor_calendars')}</h3>
        ${this.renderEntities(picker)}
      </section>
      <section>
        <h3>${this.t('editor_general')}</h3>
        ${haForm ? this.renderHaForm() : this.renderNativeForm()}
      </section>
    `;
  }

  // ----------------------------------------------------------- calendars

  private renderEntities(picker: boolean) {
    const items = entityList(this.config).map(entityObject);
    const used = items.map((item) => item.entity);
    return html`
      ${items.length === 0 ? html`<p class="empty">${this.t('editor_no_calendars')}</p>` : nothing}
      <div class="rows">
        ${items.map((item, index) => this.renderRow(item, index, items.length, picker))}
      </div>
      <div class="add">
        ${
          picker
            ? html`<ha-entity-picker
                .hass=${this.hass}
                .value=${''}
                .label=${this.t('editor_add_calendar')}
                .includeDomains=${['calendar']}
                .entityFilter=${isCalendar}
                .excludeEntities=${used}
                @value-changed=${this.onAdd}
              ></ha-entity-picker>`
            : html`<select
                class="native add-select"
                aria-label=${this.t('editor_add_calendar')}
                @change=${this.onAdd}
              >
                <option value="" selected>${this.t('editor_add_calendar')} …</option>
                ${this.calendarIds()
                  .filter((id) => !used.includes(id))
                  .map((id) => html`<option value=${id}>${this.friendlyName(id)}</option>`)}
              </select>`
        }
      </div>
    `;
  }

  private renderRow(item: EntityConfig, index: number, count: number, picker: boolean) {
    const auto = PALETTE[index % PALETTE.length];
    const explicit = item.color;
    const swatch = toHexColor(explicit) ?? (explicit ? undefined : auto);
    return html`
      <div class="row" data-index=${index}>
        <div class="order">
          <button
            class="icon up"
            title=${this.t('editor_move_up')}
            aria-label=${this.t('editor_move_up')}
            ?disabled=${index === 0}
            @click=${() => this.commit(moveEntity(this.config, index, index - 1))}
          >
            ${icon(MDI_ARROW_UP)}
          </button>
          <button
            class="icon down"
            title=${this.t('editor_move_down')}
            aria-label=${this.t('editor_move_down')}
            ?disabled=${index === count - 1}
            @click=${() => this.commit(moveEntity(this.config, index, index + 1))}
          >
            ${icon(MDI_ARROW_DOWN)}
          </button>
        </div>
        <div class="entity">
          ${
            picker
              ? html`<ha-entity-picker
                  .hass=${this.hass}
                  .value=${item.entity}
                  .label=${this.t('editor_entity')}
                  .includeDomains=${['calendar']}
                  .entityFilter=${isCalendar}
                  @value-changed=${(ev: CustomEvent<{ value?: string }>) =>
                    this.onEntityChanged(index, ev.detail.value)}
                ></ha-entity-picker>`
              : html`<select
                  class="native entity-select"
                  aria-label=${this.t('editor_entity')}
                  @change=${(ev: Event) =>
                    this.onEntityChanged(index, (ev.target as HTMLSelectElement).value)}
                >
                  ${[...new Set([item.entity, ...this.calendarIds()])].map(
                    (id) =>
                      html`<option value=${id} ?selected=${id === item.entity}>
                        ${id ? this.friendlyName(id) : '—'}
                      </option>`,
                  )}
                </select>`
          }
          <input
            class="native name"
            type="text"
            aria-label=${this.t('editor_name')}
            placeholder=${`${this.t('editor_name')}: ${this.friendlyName(item.entity)}`}
            .value=${item.name ?? ''}
            @change=${(ev: Event) =>
              this.commit(
                updateEntity(this.config, index, {
                  name: (ev.target as HTMLInputElement).value.trim(),
                }),
              )}
          />
        </div>
        <div class="color ${explicit ? 'explicit' : 'auto'}">
          <input
            type="color"
            title=${explicit ? `${this.t('editor_color')}: ${explicit}` : this.t('editor_color')}
            aria-label=${this.t('editor_color')}
            .value=${swatch ?? '#000000'}
            style=${swatch ? '' : `background:${explicit}`}
            @change=${(ev: Event) =>
              this.commit(
                updateEntity(this.config, index, { color: (ev.target as HTMLInputElement).value }),
              )}
          />
          ${
            explicit
              ? html`<button
                  class="icon reset"
                  title=${this.t('editor_reset_color')}
                  aria-label=${this.t('editor_reset_color')}
                  @click=${() => this.commit(updateEntity(this.config, index, { color: undefined }))}
                >
                  ${icon(MDI_CLOSE)}
                </button>`
              : nothing
          }
        </div>
        <button
          class="icon remove"
          title=${this.t('editor_remove')}
          aria-label=${this.t('editor_remove')}
          @click=${() => this.commit(removeEntity(this.config, index))}
        >
          ${icon(MDI_DELETE)}
        </button>
      </div>
    `;
  }

  private onAdd = (ev: Event) => {
    const target = ev.target as HTMLSelectElement & { value: string };
    const value = (ev as CustomEvent<{ value?: string }>).detail?.value ?? target.value;
    if (!value) return;
    target.value = '';
    this.commit(addEntity(this.config, value));
  };

  private onEntityChanged(index: number, value: string | undefined) {
    // Clearing a row's picker removes the row (like HA's entities editor).
    this.commit(
      value
        ? updateEntity(this.config, index, { entity: value })
        : removeEntity(this.config, index),
    );
  }

  private calendarIds(): string[] {
    return Object.keys(this.hass?.states ?? {})
      .filter((id) => id.startsWith('calendar.'))
      .sort();
  }

  private friendlyName(id: string): string {
    return this.hass?.states[id]?.attributes.friendly_name ?? id;
  }

  // ----------------------------------------------------- general options

  private schema(): FormSchema[] {
    const language = this.hass?.locale?.language ?? this.hass?.language ?? 'en';
    return buildSchema(this.config, this.t, language);
  }

  private computeLabel = (schema: FormSchema) =>
    schema.name ? this.t(`editor_${schema.name}` as TranslationKey) : '';

  private computeHelper = (schema: FormSchema) => {
    const key = `editor_${schema.name}_helper`;
    return schema.name && isTranslationKey(key) ? this.t(key) : undefined;
  };

  private renderHaForm() {
    return html`<ha-form
      .hass=${this.hass}
      .data=${formData(this.config)}
      .schema=${this.schema()}
      .computeLabel=${this.computeLabel}
      .computeHelper=${this.computeHelper}
      @value-changed=${(ev: CustomEvent<{ value: Record<string, unknown> }>) => {
        ev.stopPropagation();
        this.commit(applyFormChange(this.config, formData(this.config), ev.detail.value));
      }}
    ></ha-form>`;
  }

  /** Minimal stand-in for `ha-form` when HA's components are unavailable (dev harness). */
  private renderNativeForm() {
    const data = formData(this.config);
    const change = (name: string, value: unknown) =>
      this.commit(applyFormChange(this.config, data, { ...data, [name]: value }));
    return html`<div class="native-form">
      ${schemaFields(this.schema()).map((field) => {
        const value = data[field.name];
        const label = this.computeLabel(field);
        const { select, number, boolean } = field.selector ?? {};
        if (boolean) {
          return html`<label class="check" data-name=${field.name}>
            <input
              type="checkbox"
              .checked=${value === true}
              @change=${(ev: Event) => change(field.name, (ev.target as HTMLInputElement).checked)}
            />
            ${label}
          </label>`;
        }
        let control;
        if (select) {
          control = html`<select
            class="native"
            @change=${(ev: Event) => change(field.name, (ev.target as HTMLSelectElement).value)}
          >
            ${select.options.map(
              (o) =>
                html`<option value=${o.value} ?selected=${o.value === value}>${o.label}</option>`,
            )}
          </select>`;
        } else {
          control = html`<input
            class="native"
            type=${number ? 'number' : 'text'}
            min=${number?.min ?? nothing}
            max=${number?.max ?? nothing}
            .value=${value === undefined ? '' : String(value)}
            @change=${(ev: Event) => {
              const raw = (ev.target as HTMLInputElement).value.trim();
              change(field.name, number ? (raw === '' ? undefined : Number(raw)) : raw);
            }}
          />`;
        }
        const helper = this.computeHelper(field);
        return html`<label class="field" data-name=${field.name}>
          <span>${label}</span>${control}${helper ? html`<small>${helper}</small>` : nothing}
        </label>`;
      })}
    </div>`;
  }

  static override styles = css`
    :host {
      display: block;
      --cc-editor-text: var(--primary-text-color, #212121);
      --cc-editor-muted: var(--secondary-text-color, #727272);
      --cc-editor-divider: var(--divider-color, rgba(0, 0, 0, 0.12));
      --cc-editor-field: var(
        --mdc-text-field-fill-color,
        color-mix(in srgb, var(--cc-editor-text) 4%, transparent)
      );
      color: var(--cc-editor-text);
    }
    section + section {
      margin-top: 24px;
    }
    h3 {
      margin: 0 0 8px;
      font-size: 16px;
      font-weight: 500;
    }
    .note,
    .empty {
      margin: 0 0 12px;
      font-size: 13px;
      color: var(--cc-editor-muted);
    }
    .rows {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      border: 1px solid var(--cc-editor-divider);
      border-radius: 12px;
    }
    .order {
      display: flex;
      flex-direction: column;
    }
    .entity {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .add {
      margin-top: 12px;
    }
    .native {
      box-sizing: border-box;
      width: 100%;
      min-height: 40px;
      padding: 8px 12px;
      font: inherit;
      font-size: 14px;
      color: inherit;
      background: var(--cc-editor-field);
      border: none;
      border-bottom: 1px solid var(--cc-editor-muted);
      border-radius: 4px 4px 0 0;
    }
    .native:focus {
      outline: none;
      border-bottom: 2px solid var(--primary-color, #03a9f4);
    }
    .native::placeholder {
      color: var(--cc-editor-muted);
    }
    select.native option {
      color: initial;
    }
    button.icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: none;
      color: var(--cc-editor-muted);
      cursor: pointer;
    }
    button.icon:hover:not(:disabled) {
      background: color-mix(in srgb, var(--cc-editor-text) 8%, transparent);
      color: var(--cc-editor-text);
    }
    button.icon:disabled {
      opacity: 0.3;
      cursor: default;
    }
    button.icon svg {
      width: 20px;
      height: 20px;
      fill: currentColor;
    }
    .color {
      position: relative;
      flex: none;
    }
    input[type='color'] {
      display: block;
      width: 32px;
      height: 32px;
      padding: 0;
      border: 2px solid var(--cc-editor-divider);
      border-radius: 50%;
      background: none;
      cursor: pointer;
      -webkit-appearance: none;
      appearance: none;
    }
    .color.auto input[type='color'] {
      border-style: dashed;
    }
    input[type='color']::-webkit-color-swatch-wrapper {
      padding: 2px;
    }
    input[type='color']::-webkit-color-swatch {
      border: none;
      border-radius: 50%;
    }
    input[type='color']::-moz-color-swatch {
      border: none;
      border-radius: 50%;
    }
    button.reset {
      position: absolute;
      top: -6px;
      right: -6px;
      width: 18px;
      height: 18px;
      background: var(--card-background-color, #fff);
      border: 1px solid var(--cc-editor-divider);
    }
    button.reset svg {
      width: 12px;
      height: 12px;
    }
    .native-form {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px 16px;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 13px;
      color: var(--cc-editor-muted);
    }
    .field small {
      font-size: 12px;
    }
    .check {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'column-calendar-card-editor': ColumnCalendarCardEditor;
  }
  interface Window {
    loadCardHelpers?: () => Promise<{
      createCardElement(config: Record<string, unknown>): HTMLElement | Promise<HTMLElement>;
    }>;
  }
}
