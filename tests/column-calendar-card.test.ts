import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/column-calendar-card';
import type { ColumnCalendarCard } from '../src/column-calendar-card';
import type { CcEventDialog } from '../src/components/cc-event-dialog';
import type { ColumnCalendarCardConfig, HassSubscribeMessage, HomeAssistant } from '../src/types';

// Wednesday 2026-10-21 12:00 in Europe/Berlin (CEST, +02:00).
const NOW = new Date('2026-10-21T10:00:00Z');
// Week (Monday start) 2026-10-19 … 2026-10-25; midnight Berlin = 22:00Z the day before.
const WEEK_START = '2026-10-18T22:00:00.000Z';
const WEEK_END = '2026-10-25T23:00:00.000Z'; // DST ended Oct 25 → +01:00
const NEXT_WEEK_END = '2026-11-01T23:00:00.000Z';

interface FakeSub {
  msg: HassSubscribeMessage;
  push: (payload: unknown) => void;
  unsub: ReturnType<typeof vi.fn>;
}

function fakeHass(language = 'en') {
  const subs: FakeSub[] = [];
  const subscribeMessage = vi.fn((callback: (m: unknown) => void, msg: HassSubscribeMessage) => {
    const unsub = vi.fn(async () => {});
    subs.push({ msg, push: callback, unsub });
    return Promise.resolve(unsub);
  });
  const hass = {
    language,
    locale: { language, time_format: '24', first_weekday: 'monday', time_zone: 'server' },
    config: { time_zone: 'Europe/Berlin' },
    states: {
      'calendar.family': {
        entity_id: 'calendar.family',
        state: 'off',
        attributes: { friendly_name: 'Family' },
      },
    },
    connection: { subscribeMessage },
  } as unknown as HomeAssistant;
  return { hass, subs, subscribeMessage };
}

const ENTITIES: ColumnCalendarCardConfig['entities'] = [
  'calendar.family',
  { entity: 'calendar.work', name: 'Work', color: '#1e88e5' },
];

let cards: ColumnCalendarCard[] = [];

async function flush(card: ColumnCalendarCard): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await card.updateComplete;
}

async function mount(
  config: Partial<ColumnCalendarCardConfig> = {},
  opts: { layout?: string; language?: string } = {},
) {
  const f = fakeHass(opts.language);
  const card = document.createElement('column-calendar-card');
  card.setConfig({ type: 'custom:column-calendar-card', entities: ENTITIES, ...config });
  if (opts.layout) card.layout = opts.layout;
  card.hass = f.hass;
  document.body.appendChild(card);
  cards.push(card);
  await flush(card);
  return { card, ...f, root: card.shadowRoot! };
}

const timed = (summary: string, start: string, end: string, extra = {}) => ({
  summary,
  start,
  end,
  all_day: false,
  ...extra,
});

const texts = (root: ParentNode, sel: string) =>
  [...root.querySelectorAll(sel)].map((e) => e.textContent?.trim());

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  for (const c of cards) c.remove();
  cards = [];
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('column-calendar-card', () => {
  it('renders 7 columns in week mode with today marked', async () => {
    const { root } = await mount({ mode: 'week' });
    const heads = root.querySelectorAll('.col-head');
    expect(heads).toHaveLength(7);
    expect(texts(root, '.col-head .daynum')).toEqual(['19', '20', '21', '22', '23', '24', '25']);
    const today = root.querySelectorAll('.col-head.today');
    expect(today).toHaveLength(1);
    expect(today[0].querySelector('.daynum')!.textContent).toBe('21');
    expect(today[0].getAttribute('aria-current')).toBe('date');
    expect(root.querySelectorAll('.col-head.past')).toHaveLength(2);
  });

  it('renders `days` columns in rolling mode starting today', async () => {
    const { root, subs } = await mount({ mode: 'rolling', days: 4 });
    expect(texts(root, '.col-head .daynum')).toEqual(['21', '22', '23', '24']);
    expect(root.querySelector('.col-head.first')!.classList.contains('today')).toBe(true);
    expect(subs[0].msg.start).toBe('2026-10-20T22:00:00.000Z');
  });

  it('subscribes once per entity with UTC ISO range', async () => {
    const { subs } = await mount();
    expect(subs.map((s) => s.msg)).toEqual([
      {
        type: 'calendar/event/subscribe',
        entity_id: 'calendar.family',
        start: WEEK_START,
        end: WEEK_END,
      },
      {
        type: 'calendar/event/subscribe',
        entity_id: 'calendar.work',
        start: WEEK_START,
        end: WEEK_END,
      },
    ]);
  });

  it('places pushed events in the right columns, ordered by start then entity order', async () => {
    const { card, root, subs } = await mount();
    subs[1].push({
      events: [
        timed('Standup', '2026-10-21T07:00:00Z', '2026-10-21T07:15:00Z', { location: 'Teams' }),
      ],
    });
    subs[0].push({
      events: [
        timed('School', '2026-10-21T07:00:00+00:00', '2026-10-21T08:00:00+00:00'),
        timed('Early', '2026-10-21T06:00:00+02:00', '2026-10-21T06:30:00+02:00'),
        timed('Thursday', '2026-10-22T16:00:00Z', '2026-10-22T17:00:00Z'),
      ],
    });
    await flush(card);
    const bodies = root.querySelectorAll('.body');
    expect(bodies).toHaveLength(7);
    expect(texts(bodies[2], '.summary')).toEqual(['Early', 'School', 'Standup']);
    expect(texts(bodies[2], '.time')).toEqual(['06:00', '09:00', '09:00']);
    expect(texts(bodies[3], '.summary')).toEqual(['Thursday']);
    expect(bodies[0].querySelector('.empty')!.textContent).toBe('No events');
    expect(bodies[2].querySelector('.location')!.textContent!.trim()).toBe('Teams');
    // Ended events (06:00–06:30 local, now 12:00) are dimmed.
    expect(bodies[2].querySelector('.event')!.classList.contains('ended')).toBe(true);
  });

  it('shows the all-day strip only when all-day events exist, with "Day n/m" hint', async () => {
    const { card, root, subs } = await mount();
    expect(root.querySelector('.allday')).toBeNull();
    subs[0].push({
      events: [{ summary: 'Trip', start: '2026-10-20', end: '2026-10-23', all_day: true }],
    });
    await flush(card);
    const cells = root.querySelectorAll('.allday');
    expect(cells).toHaveLength(7);
    expect(texts(cells[0], '.chip')).toEqual([]);
    expect(cells[1].querySelector('.chip')!.textContent!.trim()).toBe('Trip');
    expect(cells[1].querySelector('.hint')).toBeNull();
    expect(cells[2].querySelector('.hint')!.textContent).toBe('Day 2/3');
    expect(cells[3].querySelector('.hint')!.textContent).toBe('Day 3/3');
    expect(cells[4].querySelector('.chip')).toBeNull();
  });

  it('prev/next shift the range and resubscribe; idle reset returns to today', async () => {
    const { card, root, subs } = await mount({ navigation_reset: 60 });
    expect(subs).toHaveLength(2);
    const next = root.querySelector<HTMLButtonElement>('.icon-btn[aria-label="Next"]')!;
    next.click();
    await flush(card);
    expect(subs.slice(0, 2).every((s) => s.unsub.mock.calls.length === 1)).toBe(true);
    expect(subs).toHaveLength(4);
    expect(subs[2].msg.start).toBe(WEEK_END);
    expect(subs[2].msg.end).toBe(NEXT_WEEK_END);
    expect(texts(root, '.col-head .daynum')[0]).toBe('26');
    expect(root.querySelector('.col-head.today')).toBeNull();
    expect(root.querySelector('.today-btn')!.classList.contains('active')).toBe(true);

    const prev = root.querySelector<HTMLButtonElement>('.icon-btn[aria-label="Previous"]')!;
    prev.click();
    prev.click();
    await flush(card);
    expect(subs.at(-1)!.msg.start).toBe('2026-10-11T22:00:00.000Z');
    expect(texts(root, '.col-head .daynum')[0]).toBe('12');

    vi.advanceTimersByTime(59_000);
    await flush(card);
    expect(texts(root, '.col-head .daynum')[0]).toBe('12');
    vi.advanceTimersByTime(1_000);
    await flush(card);
    expect(texts(root, '.col-head .daynum')[0]).toBe('19');
    expect(subs.at(-1)!.msg.start).toBe(WEEK_START);
    expect(root.querySelector('.col-head.today')).not.toBeNull();
  });

  it('"today" button resets the offset immediately', async () => {
    const { card, root, subs } = await mount();
    root.querySelector<HTMLButtonElement>('.icon-btn[aria-label="Next"]')!.click();
    await flush(card);
    root.querySelector<HTMLButtonElement>('.today-btn')!.click();
    await flush(card);
    expect(subs.at(-1)!.msg.start).toBe(WEEK_START);
    expect(texts(root, '.col-head .daynum')[0]).toBe('19');
  });

  it('does not resubscribe on unrelated hass updates', async () => {
    const { card, subs, hass } = await mount();
    card.hass = { ...hass, states: { ...hass.states } };
    await flush(card);
    expect(subs).toHaveLength(2);
  });

  it('unsubscribes everything on disconnect and resubscribes on reconnect', async () => {
    const { card, subs } = await mount();
    card.remove();
    await flush(card);
    expect(subs.every((s) => s.unsub.mock.calls.length === 1)).toBe(true);
    document.body.appendChild(card);
    await flush(card);
    expect(subs).toHaveLength(4);
  });

  it('opens the details dialog with the clicked event', async () => {
    const { card, root, subs } = await mount();
    subs[1].push({
      events: [
        timed('Review', '2026-10-21T11:00:00Z', '2026-10-21T12:00:00Z', { location: 'Room Ada' }),
      ],
    });
    await flush(card);
    const dialog = root.querySelector('cc-event-dialog') as CcEventDialog;
    expect(dialog.event).toBeUndefined();
    root.querySelector<HTMLButtonElement>('.event')!.click();
    await flush(card);
    await dialog.updateComplete;
    expect(dialog.event?.summary).toBe('Review');
    expect(dialog.event?.calendarName).toBe('Work');
    expect(dialog.shadowRoot!.querySelector('h2')!.textContent).toBe('Review');
    // Closing clears the selection.
    dialog.shadowRoot!.querySelector<HTMLButtonElement>('.close')!.click();
    await flush(card);
    expect(dialog.event).toBeUndefined();
  });

  it('shows a per-calendar warning when HA pushes events: null', async () => {
    const { card, root, subs } = await mount();
    expect(root.querySelector('.errors')).toBeNull();
    subs[1].push({ events: null });
    await flush(card);
    expect(root.querySelector('.errors')!.textContent!.trim()).toBe('Could not load Work');
  });

  it('localizes the warning', async () => {
    const { card, root, subs } = await mount({}, { language: 'de' });
    subs[0].push({ events: null });
    await flush(card);
    expect(root.querySelector('.errors')!.textContent!.trim()).toBe(
      'Family konnte nicht geladen werden',
    );
  });

  it('returns the sections grid options', async () => {
    const { card } = await mount();
    expect(card.getGridOptions()).toEqual({
      columns: 12,
      min_columns: 6,
      rows: 'auto',
      min_rows: 3,
    });
  });

  it('fills the cell only for layout=grid with numeric grid_options.rows', async () => {
    const filled = await mount({ grid_options: { rows: 6 } }, { layout: 'grid' });
    expect(filled.card.hasAttribute('fill')).toBe(true);
    expect(filled.root.querySelector('ha-card')!.classList.contains('fill')).toBe(true);

    const notGrid = await mount({ grid_options: { rows: 6 } });
    expect(notGrid.card.hasAttribute('fill')).toBe(false);

    const autoRows = await mount({ grid_options: { rows: 'auto' } }, { layout: 'grid' });
    expect(autoRows.card.hasAttribute('fill')).toBe(false);
  });

  it('setConfig throws on invalid config', () => {
    const card = document.createElement('column-calendar-card');
    expect(() => card.setConfig({ type: 'custom:column-calendar-card', entities: [] })).toThrow(
      /entities/,
    );
    expect(() =>
      card.setConfig({
        type: 'custom:column-calendar-card',
        entities: ['calendar.a'],
        mode: 'month' as never,
      }),
    ).toThrow(/mode/);
  });
});
