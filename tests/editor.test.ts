import { afterEach, describe, expect, it } from 'vitest';
import '../src/editor/column-calendar-card-editor';
import {
  applyFormChange,
  buildSchema,
  formData,
  schemaFields,
  setOption,
  type ColumnCalendarCardEditor,
} from '../src/editor/column-calendar-card-editor';
import { ColumnCalendarCard } from '../src/column-calendar-card';
import type { ColumnCalendarCardConfig, HomeAssistant } from '../src/types';

const hass = {
  language: 'en',
  locale: { language: 'en', time_format: '24', first_weekday: 'monday', time_zone: 'server' },
  config: { time_zone: 'Europe/Berlin' },
  states: Object.fromEntries(
    ['calendar.family', 'calendar.work', 'calendar.trash'].map((entity_id) => [
      entity_id,
      { entity_id, state: 'off', attributes: { friendly_name: entity_id.slice(9) } },
    ]),
  ),
  connection: { subscribeMessage: () => Promise.resolve(async () => {}) },
} as unknown as HomeAssistant;

type Cfg = ColumnCalendarCardConfig & Record<string, unknown>;

let editors: ColumnCalendarCardEditor[] = [];

afterEach(() => {
  for (const editor of editors) editor.remove();
  editors = [];
});

async function mount(config: object) {
  const editor = document.createElement('column-calendar-card-editor');
  editor.hass = hass;
  editor.setConfig({ type: 'custom:column-calendar-card', ...config } as ColumnCalendarCardConfig);
  const events: Cfg[] = [];
  editor.addEventListener('config-changed', (ev) =>
    events.push((ev as CustomEvent<{ config: Cfg }>).detail.config),
  );
  document.body.append(editor);
  editors.push(editor);
  await editor.updateComplete;
  const $ = <T extends Element>(sel: string) => editor.shadowRoot!.querySelector<T>(sel)!;
  const $$ = <T extends Element>(sel: string) => [...editor.shadowRoot!.querySelectorAll<T>(sel)];
  const last = () => events[events.length - 1];
  return { editor, events, last, $, $$ };
}

function change(el: HTMLInputElement | HTMLSelectElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('change'));
}

describe('editor: calendars', () => {
  it('adds an entity in short string form', async () => {
    const { $, last } = await mount({ entities: ['calendar.family'] });
    change($<HTMLSelectElement>('.add-select'), 'calendar.work');
    expect(last().entities).toEqual(['calendar.family', 'calendar.work']);
  });

  it('works with an empty entity list (no throw)', async () => {
    const { $, $$, last } = await mount({ entities: [] });
    expect($('.empty')).not.toBeNull();
    expect($$('.row')).toHaveLength(0);
    change($<HTMLSelectElement>('.add-select'), 'calendar.trash');
    expect(last().entities).toEqual(['calendar.trash']);
  });

  it('setting a color switches to object form', async () => {
    const { $$, last } = await mount({ entities: ['calendar.family', 'calendar.work'] });
    change($$<HTMLInputElement>('input[type=color]')[1], '#ff0000');
    expect(last().entities).toEqual([
      'calendar.family',
      { entity: 'calendar.work', color: '#ff0000' },
    ]);
  });

  it('shows the auto palette color when unset', async () => {
    const { $$ } = await mount({ entities: ['calendar.family', 'calendar.work'] });
    const swatches = $$<HTMLInputElement>('input[type=color]');
    expect(swatches.map((s) => s.value)).toEqual(['#1e88e5', '#43a047']);
  });

  it('setting a name switches to object form', async () => {
    const { $, last } = await mount({ entities: ['calendar.family'] });
    change($<HTMLInputElement>('input.name'), 'Home');
    expect(last().entities).toEqual([{ entity: 'calendar.family', name: 'Home' }]);
  });

  it('clearing color and name collapses back to the string form', async () => {
    const { editor, $, last } = await mount({
      entities: [{ entity: 'calendar.work', color: '#1e88e5', name: 'Work' }],
    });
    $<HTMLButtonElement>('button.reset').click();
    expect(last().entities).toEqual([{ entity: 'calendar.work', name: 'Work' }]);
    await editor.updateComplete;
    change($<HTMLInputElement>('input.name'), '  ');
    expect(last().entities).toEqual(['calendar.work']);
  });

  it('keeps unknown keys of entity objects', async () => {
    const { $, last } = await mount({
      entities: [{ entity: 'calendar.work', color: '#1e88e5', icon: 'mdi:x' } as never],
    });
    $<HTMLButtonElement>('button.reset').click();
    expect(last().entities).toEqual([{ entity: 'calendar.work', icon: 'mdi:x' }]);
  });

  it('reorders with up/down buttons', async () => {
    const entities = ['calendar.family', { entity: 'calendar.work', name: 'W' }, 'calendar.trash'];
    const { editor, $$, last } = await mount({ entities });
    const up = $$<HTMLButtonElement>('button.up');
    const down = $$<HTMLButtonElement>('button.down');
    expect(up[0].disabled).toBe(true);
    expect(down[2].disabled).toBe(true);
    up[2].click();
    expect(last().entities).toEqual([
      'calendar.family',
      'calendar.trash',
      { entity: 'calendar.work', name: 'W' },
    ]);
    await editor.updateComplete;
    $$<HTMLButtonElement>('button.down')[0].click();
    expect(last().entities).toEqual([
      'calendar.trash',
      'calendar.family',
      { entity: 'calendar.work', name: 'W' },
    ]);
  });

  it('removes a row', async () => {
    const { $$, last } = await mount({ entities: ['calendar.family', 'calendar.work'] });
    $$<HTMLButtonElement>('button.remove')[0].click();
    expect(last().entities).toEqual(['calendar.work']);
  });

  it('changes the entity of a row, keeping color/name', async () => {
    const { $, last } = await mount({ entities: [{ entity: 'calendar.family', name: 'F' }] });
    change($<HTMLSelectElement>('.entity-select'), 'calendar.trash');
    expect(last().entities).toEqual([{ entity: 'calendar.trash', name: 'F' }]);
  });
});

describe('editor: general options', () => {
  it('preserves unknown keys and only writes changed keys', async () => {
    const config = {
      entities: ['calendar.family'],
      show_range: true, // explicit default must survive unrelated edits
      grid_options: { columns: 12, rows: 6 },
      view_layout: { position: 'sidebar' },
      visibility: [{ condition: 'screen' }],
    };
    const { $, last } = await mount(config);
    change($<HTMLInputElement>('[data-name=title] input'), 'Family');
    expect(last()).toEqual({ type: 'custom:column-calendar-card', ...config, title: 'Family' });
  });

  it('setting an option back to its default removes the key', async () => {
    const { $, last } = await mount({ entities: ['calendar.family'], show_range: false, days: 5 });
    const box = $<HTMLInputElement>('[data-name=show_range] input');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(last()).not.toHaveProperty('show_range');
    expect(last().days).toBe(5);
  });

  it('switching mode writes only mode and shows the rolling fields', async () => {
    const { editor, $, last } = await mount({ entities: ['calendar.family'] });
    expect($('[data-name=first_day]')).not.toBeNull();
    expect($('[data-name=days]')).toBeNull();
    change($<HTMLSelectElement>('[data-name=mode] select'), 'rolling');
    expect(last()).toEqual({
      type: 'custom:column-calendar-card',
      entities: ['calendar.family'],
      mode: 'rolling',
    });
    await editor.updateComplete;
    expect($('[data-name=days]')).not.toBeNull();
    expect($('[data-name=first_day]')).toBeNull();
  });

  it('clearing a text field removes the key', async () => {
    const { $, last } = await mount({ entities: ['calendar.family'], height: '400px' });
    change($<HTMLInputElement>('[data-name=height] input'), '');
    expect(last()).not.toHaveProperty('height');
  });
});

describe('buildSchema', () => {
  const names = (config: Partial<ColumnCalendarCardConfig>) =>
    schemaFields(buildSchema(config)).map((f) => f.name);

  it('week mode (default) shows first_day, hides days', () => {
    expect(names({})).toContain('first_day');
    expect(names({})).not.toContain('days');
    expect(names({ mode: 'week' })).toContain('first_day');
  });

  it('rolling mode shows days, hides first_day', () => {
    expect(names({ mode: 'rolling' })).toContain('days');
    expect(names({ mode: 'rolling' })).not.toContain('first_day');
  });

  it('navigation_reset only while navigation is shown', () => {
    expect(names({})).toContain('navigation_reset');
    expect(names({ show_navigation: false })).not.toContain('navigation_reset');
  });

  it('lists all general options', () => {
    expect(names({}).sort()).toEqual(
      [
        'mode',
        'first_day',
        'title',
        'show_range',
        'show_navigation',
        'navigation_reset',
        'show_end_time',
        'show_location',
        'show_empty',
        'min_column_width',
        'accent_color',
        'height',
      ].sort(),
    );
  });
});

describe('config helpers', () => {
  it('setOption drops defaults and empty values', () => {
    const base = { type: 't', entities: [] } as ColumnCalendarCardConfig;
    expect(setOption({ ...base, days: 5 }, 'days', 7)).toEqual(base);
    expect(setOption({ ...base, title: 'x' }, 'title', '')).toEqual(base);
    expect(setOption(base, 'min_column_width', undefined)).toEqual(base);
    expect(setOption(base, 'show_end_time', true)).toEqual({ ...base, show_end_time: true });
  });

  it('applyFormChange (ha-form full-data payload) only touches changed keys', () => {
    const config = {
      type: 't',
      entities: ['calendar.a'],
      show_location: true,
    } as ColumnCalendarCardConfig;
    const before = formData(config);
    const next = applyFormChange(config, before, { ...before, navigation_reset: 0 });
    expect(next).toEqual({ ...config, navigation_reset: 0 });
  });
});

describe('card wiring', () => {
  it('getConfigElement returns the editor', async () => {
    const el = await ColumnCalendarCard.getConfigElement();
    expect(el.tagName.toLowerCase()).toBe('column-calendar-card-editor');
  });

  it('stub config loads in the editor', async () => {
    const stub = ColumnCalendarCard.getStubConfig(hass);
    const { $$ } = await mount(stub);
    expect($$('.row')).toHaveLength(3);
  });
});
