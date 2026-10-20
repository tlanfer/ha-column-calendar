import { describe, expect, it } from 'vitest';
import { DEFAULT_ACCENT_COLOR, PALETTE, getStubConfig, normalizeConfig } from '../src/config';
import type { ColumnCalendarCardConfig, HomeAssistant } from '../src/types';

const base = (extra: Partial<ColumnCalendarCardConfig> = {}): ColumnCalendarCardConfig => ({
  type: 'custom:column-calendar-card',
  entities: ['calendar.family'],
  ...extra,
});

const raw = (cfg: Record<string, unknown>) => cfg as unknown as ColumnCalendarCardConfig;

describe('normalizeConfig defaults', () => {
  it('applies all defaults', () => {
    const c = normalizeConfig(base());
    expect(c).toEqual({
      entities: [{ entity: 'calendar.family', color: PALETTE[0] }],
      mode: 'week',
      firstDay: 'auto',
      days: 7,
      showRange: true,
      showNavigation: true,
      navigationReset: 120,
      showEndTime: false,
      showLocation: true,
      showEmpty: true,
      minColumnWidth: 120,
      accentColor: DEFAULT_ACCENT_COLOR,
    });
    expect(c.accentColor).toBe('#e8173a');
    expect('title' in c).toBe(false);
    expect('height' in c).toBe(false);
    expect('gridRows' in c).toBe(false);
  });

  it('maps all explicit options', () => {
    const c = normalizeConfig(
      base({
        mode: 'rolling',
        first_day: 'sunday',
        days: 3,
        title: 'Family',
        show_range: false,
        show_navigation: false,
        navigation_reset: 0,
        show_end_time: true,
        show_location: false,
        show_empty: false,
        min_column_width: 80,
        accent_color: '#000',
        height: '500px',
        grid_options: { rows: 6, columns: 12 },
      }),
    );
    expect(c).toMatchObject({
      mode: 'rolling',
      firstDay: 0,
      days: 3,
      title: 'Family',
      showRange: false,
      showNavigation: false,
      navigationReset: 0,
      showEndTime: true,
      showLocation: false,
      showEmpty: false,
      minColumnWidth: 80,
      accentColor: '#000',
      height: '500px',
      gridRows: 6,
    });
  });

  it('maps every weekday name to its index', () => {
    const names = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ] as const;
    names.forEach((name, i) => expect(normalizeConfig(base({ first_day: name })).firstDay).toBe(i));
    expect(normalizeConfig(base({ first_day: 'auto' })).firstDay).toBe('auto');
  });

  it('ignores grid_options.rows "auto"', () => {
    expect(normalizeConfig(base({ grid_options: { rows: 'auto' } })).gridRows).toBeUndefined();
  });
});

describe('normalizeConfig entities & colors', () => {
  it('accepts mixed strings and objects, auto-assigning palette colors by index', () => {
    const c = normalizeConfig(
      base({
        entities: [
          'calendar.a',
          { entity: 'calendar.b', color: '#123456', name: 'Work' },
          { entity: 'calendar.c' },
        ],
      }),
    );
    expect(c.entities).toEqual([
      { entity: 'calendar.a', color: PALETTE[0] },
      { entity: 'calendar.b', color: '#123456', name: 'Work' },
      { entity: 'calendar.c', color: PALETTE[2] },
    ]);
  });

  it('wraps around the palette', () => {
    const entities = Array.from({ length: PALETTE.length + 2 }, (_, i) => `calendar.c${i}`);
    const c = normalizeConfig(base({ entities }));
    expect(c.entities[PALETTE.length].color).toBe(PALETTE[0]);
    expect(c.entities[PALETTE.length + 1].color).toBe(PALETTE[1]);
  });

  it.each([
    [undefined, /entities: at least one/],
    [[], /entities: at least one/],
    ['calendar.a', /entities: at least one/],
    [['sensor.x'], /entities\[0\].*not a calendar/],
    [['calendar.a', 'light.b'], /entities\[1\].*not a calendar/],
    [[{ color: 'red' }], /entities\[0\]/],
    [[42], /entities\[0\]/],
    [[null], /entities\[0\]/],
    [[{ entity: 'calendar.a', color: 5 }], /color/],
    [[{ entity: 'calendar.a', name: 5 }], /name/],
  ])('rejects entities %j', (entities, msg) => {
    expect(() => normalizeConfig(raw({ type: 'x', entities }))).toThrow(msg);
  });

  it('rejects a missing config', () => {
    expect(() => normalizeConfig(undefined as unknown as ColumnCalendarCardConfig)).toThrow();
  });
});

describe('normalizeConfig validation', () => {
  it.each([
    [{ mode: 'month' }, /mode/],
    [{ first_day: 'funday' }, /first_day/],
    [{ first_day: 1 }, /first_day/],
    [{ days: 0 }, /days/],
    [{ days: -1 }, /days/],
    [{ days: 2.5 }, /days/],
    [{ days: '7' }, /days/],
    [{ min_column_width: 0 }, /min_column_width/],
    [{ min_column_width: -10 }, /min_column_width/],
    [{ min_column_width: 'wide' }, /min_column_width/],
    [{ navigation_reset: -1 }, /navigation_reset/],
    [{ navigation_reset: 'never' }, /navigation_reset/],
    [{ show_range: 'yes' }, /show_range/],
    [{ height: 5 }, /height/],
  ])('rejects %j', (extra, msg) => {
    expect(() => normalizeConfig(raw({ ...base(), ...extra }))).toThrow(msg);
  });

  it('accepts days: 1 and navigation_reset: 0', () => {
    const c = normalizeConfig(base({ days: 1, navigation_reset: 0 }));
    expect(c.days).toBe(1);
    expect(c.navigationReset).toBe(0);
  });
});

describe('getStubConfig', () => {
  it('picks the first three calendar entities', () => {
    const hass = {
      states: {
        'calendar.a': {},
        'light.x': {},
        'calendar.b': {},
        'calendar.c': {},
        'calendar.d': {},
      },
    } as unknown as HomeAssistant;
    const stub = getStubConfig(hass);
    expect(stub.entities).toEqual(['calendar.a', 'calendar.b', 'calendar.c']);
  });
});
