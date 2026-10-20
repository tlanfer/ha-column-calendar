import { TZDate } from '@date-fns/tz';
import { describe, expect, it, vi } from 'vitest';
import {
  CalendarSubscription,
  calendarNameFor,
  parseEventPayload,
} from '../src/data/calendar-subscription';
import type {
  CalendarEvent,
  DateRange,
  HassSubscribeMessage,
  HomeAssistant,
  ResolvedEntity,
} from '../src/types';

const TZ = 'America/New_York';
const fam: ResolvedEntity = { entity: 'calendar.family', color: '#f00' };
const work: ResolvedEntity = { entity: 'calendar.work', color: '#00f', name: 'Work' };

describe('parseEventPayload', () => {
  it('parses all-day dates as midnight in the target tz, end exclusive', () => {
    const [ev] = parseEventPayload(
      { events: [{ summary: 'Trip', start: '2026-10-20', end: '2026-10-23', all_day: true }] },
      fam,
      'Family',
      TZ,
    );
    expect(ev.allDay).toBe(true);
    // midnight New York (EDT, -04:00)
    expect(ev.start.getTime()).toBe(Date.parse('2026-10-20T04:00:00Z'));
    expect(ev.end.getTime()).toBe(Date.parse('2026-10-23T04:00:00Z'));
    expect(ev).toMatchObject({
      entity: 'calendar.family',
      calendarName: 'Family',
      color: '#f00',
      summary: 'Trip',
    });
  });

  it('honors explicit offsets for timed events (Z vs +02:00)', () => {
    const events = parseEventPayload(
      {
        events: [
          {
            summary: 'UTC',
            start: '2026-10-20T08:00:00Z',
            end: '2026-10-20T09:00:00Z',
            all_day: false,
          },
          {
            summary: 'Berlin',
            start: '2026-10-20T10:00:00+02:00',
            end: '2026-10-20T11:30:00+02:00',
            all_day: false,
            location: 'Office',
            description: 'Notes',
            uid: 'abc',
          },
        ],
      },
      fam,
      'Family',
      TZ,
    );
    expect(events).toHaveLength(2);
    expect(events[0].start.toISOString()).toBe('2026-10-20T08:00:00.000Z');
    expect(events[1].start.toISOString()).toBe('2026-10-20T08:00:00.000Z');
    expect(events[1].end.toISOString()).toBe('2026-10-20T09:30:00.000Z');
    expect(events[1]).toMatchObject({ location: 'Office', description: 'Notes', uid: 'abc' });
  });

  it('maps null optional fields to undefined', () => {
    const [ev] = parseEventPayload(
      {
        events: [
          {
            summary: 'X',
            start: '2026-10-20T08:00:00Z',
            end: '2026-10-20T09:00:00Z',
            all_day: false,
            description: null,
            location: null,
            uid: null,
            status: null,
          },
        ],
      },
      fam,
      'Family',
      TZ,
    );
    expect(ev.description).toBeUndefined();
    expect(ev.location).toBeUndefined();
    expect(ev.uid).toBeUndefined();
  });

  it('returns [] for null events or garbage payloads', () => {
    expect(parseEventPayload({ events: null }, fam, 'F', TZ)).toEqual([]);
    expect(parseEventPayload(null, fam, 'F', TZ)).toEqual([]);
    expect(parseEventPayload('nope', fam, 'F', TZ)).toEqual([]);
  });

  it('skips malformed and cancelled items without throwing', () => {
    const ok = { summary: 'ok', start: '2026-10-20T08:00:00Z', end: '2026-10-20T09:00:00Z' };
    const events = parseEventPayload(
      {
        events: [
          null,
          42,
          { summary: 'no start', end: '2026-10-20T09:00:00Z', all_day: false },
          { summary: 'bad', start: 'garbage', end: '2026-10-20T09:00:00Z', all_day: false },
          { summary: 'bad date', start: '2026-02-31', end: '2026-03-01', all_day: true },
          { summary: 'timed as date', start: '2026-10-20', end: '2026-10-21', all_day: false },
          { summary: 'reversed', start: '2026-10-21T08:00:00Z', end: '2026-10-20T09:00:00Z' },
          { ...ok, all_day: false, status: 'CANCELLED' },
          { ...ok, all_day: false, status: 'cancelled' },
          { ...ok, all_day: false, status: 'CONFIRMED' },
        ],
      },
      fam,
      'F',
      TZ,
    );
    expect(events.map((e) => e.summary)).toEqual(['ok']);
  });
});

describe('calendarNameFor', () => {
  it('prefers config name, then friendly_name, then entity id', () => {
    const hass = {
      states: {
        'calendar.family': {
          entity_id: 'calendar.family',
          state: 'off',
          attributes: { friendly_name: 'Family Cal' },
        },
      },
    } as unknown as HomeAssistant;
    expect(calendarNameFor(work, hass)).toBe('Work');
    expect(calendarNameFor(fam, hass)).toBe('Family Cal');
    expect(calendarNameFor({ entity: 'calendar.x', color: '#000' }, hass)).toBe('calendar.x');
  });
});

// ---------------------------------------------------------------------------
// Fake connection
// ---------------------------------------------------------------------------

interface FakeSub {
  msg: HassSubscribeMessage;
  push: (payload: unknown) => void;
  unsub: ReturnType<typeof vi.fn>;
  resolve: () => void;
  reject: (err: unknown) => void;
}

function fakeHass(opts: { manual?: boolean; failFor?: string[] } = {}) {
  const subs: FakeSub[] = [];
  const connection = {
    subscribeMessage: vi.fn(
      (callback: (m: unknown) => void, msg: HassSubscribeMessage) =>
        new Promise((resolve, reject) => {
          const unsub = vi.fn(async () => {});
          const sub: FakeSub = {
            msg,
            push: callback,
            unsub,
            resolve: () => resolve(unsub),
            reject,
          };
          subs.push(sub);
          if (opts.failFor?.includes(msg.entity_id as string)) reject(new Error('not_found'));
          else if (!opts.manual) resolve(unsub);
        }),
    ),
  };
  const hass = {
    language: 'en',
    locale: { language: 'en', time_format: '24', first_weekday: 'monday', time_zone: 'server' },
    config: { time_zone: TZ },
    states: {},
    connection,
  } as unknown as HomeAssistant;
  return { hass, subs, connection };
}

const range: DateRange = {
  start: new Date('2026-10-19T04:00:00Z'),
  end: new Date('2026-10-26T04:00:00Z'),
  days: [],
};

const timed = (summary: string, start: string, end: string) => ({
  summary,
  start,
  end,
  all_day: false,
});

function setup(opts: Parameters<typeof fakeHass>[0] = {}) {
  const f = fakeHass(opts);
  const onEvents = vi.fn<(events: CalendarEvent[]) => void>();
  const onError = vi.fn();
  const sub = new CalendarSubscription({
    hass: f.hass,
    entities: [fam, work],
    range,
    tz: TZ,
    onEvents,
    onError,
  });
  const last = () => onEvents.mock.calls.at(-1)?.[0].map((e) => e.summary);
  return { ...f, sub, onEvents, onError, last };
}

describe('CalendarSubscription', () => {
  it('opens one subscription per entity with ISO range', async () => {
    const { sub, subs } = setup();
    await sub.subscribe();
    expect(subs.map((s) => s.msg)).toEqual([
      {
        type: 'calendar/event/subscribe',
        entity_id: 'calendar.family',
        start: '2026-10-19T04:00:00.000Z',
        end: '2026-10-26T04:00:00.000Z',
      },
      {
        type: 'calendar/event/subscribe',
        entity_id: 'calendar.work',
        start: '2026-10-19T04:00:00.000Z',
        end: '2026-10-26T04:00:00.000Z',
      },
    ]);
  });

  it('sends UTC ("Z") ISO strings even for TZDate range boundaries', async () => {
    const f = fakeHass();
    const tzRange: DateRange = {
      start: new TZDate(2026, 9, 19, TZ),
      end: new TZDate(2026, 9, 26, TZ),
      days: [],
    };
    // Sanity: TZDate's own toISOString keeps the zone offset.
    expect(tzRange.start.toISOString()).toMatch(/-04:00$/);
    const sub = new CalendarSubscription({
      hass: f.hass,
      entities: [fam],
      range: tzRange,
      tz: TZ,
      onEvents: () => {},
    });
    await sub.subscribe();
    expect(f.subs[0].msg.start).toBe('2026-10-19T04:00:00.000Z');
    expect(f.subs[0].msg.end).toBe('2026-10-26T04:00:00.000Z');
  });

  it('merges by start, ties in entity config order, and replaces per push', async () => {
    const { sub, subs, last, onEvents } = setup();
    await sub.subscribe();
    subs[1].push({ events: [timed('w9', '2026-10-20T09:00:00Z', '2026-10-20T10:00:00Z')] });
    expect(last()).toEqual(['w9']);
    subs[0].push({
      events: [
        timed('f9', '2026-10-20T09:00:00Z', '2026-10-20T10:00:00Z'),
        timed('f8', '2026-10-20T08:00:00Z', '2026-10-20T09:00:00Z'),
      ],
    });
    expect(last()).toEqual(['f8', 'f9', 'w9']);
    // Replace family's list entirely.
    subs[0].push({ events: [timed('f10', '2026-10-20T10:00:00Z', '2026-10-20T11:00:00Z')] });
    expect(last()).toEqual(['w9', 'f10']);
    expect(onEvents.mock.calls.at(-1)?.[0][0].calendarName).toBe('Work');
    expect(onEvents.mock.calls.at(-1)?.[0][1].calendarName).toBe('calendar.family');
  });

  it('reports events:null as an error and drops that entity', async () => {
    const { sub, subs, last, onError } = setup();
    await sub.subscribe();
    subs[0].push({ events: [timed('f', '2026-10-20T09:00:00Z', '2026-10-20T10:00:00Z')] });
    subs[1].push({ events: [timed('w', '2026-10-20T09:00:00Z', '2026-10-20T10:00:00Z')] });
    subs[0].push({ events: null });
    expect(onError).toHaveBeenCalledWith('calendar.family', expect.any(Error));
    expect(last()).toEqual(['w']);
  });

  it('reports rejected subscriptions; others keep working', async () => {
    const { sub, subs, last, onError } = setup({ failFor: ['calendar.family'] });
    await expect(sub.subscribe()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith('calendar.family', expect.any(Error));
    subs[1].push({ events: [timed('w', '2026-10-20T09:00:00Z', '2026-10-20T10:00:00Z')] });
    expect(last()).toEqual(['w']);
    await sub.unsubscribe();
    expect(subs[1].unsub).toHaveBeenCalledOnce();
  });

  it('unsubscribe calls every unsub, swallows errors, ignores late pushes', async () => {
    const { sub, subs, onEvents } = setup();
    await sub.subscribe();
    subs[0].unsub.mockRejectedValueOnce(new Error('connection lost'));
    await expect(sub.unsubscribe()).resolves.toBeUndefined();
    expect(subs[0].unsub).toHaveBeenCalledOnce();
    expect(subs[1].unsub).toHaveBeenCalledOnce();
    subs[0].push({ events: [timed('late', '2026-10-20T09:00:00Z', '2026-10-20T10:00:00Z')] });
    expect(onEvents).not.toHaveBeenCalled();
    await sub.unsubscribe(); // idempotent
    expect(subs[0].unsub).toHaveBeenCalledOnce();
  });

  it('unsubscribe before subscribe settled still cancels once resolved', async () => {
    const { sub, subs, onEvents } = setup({ manual: true });
    const subscribing = sub.subscribe();
    const unsubscribing = sub.unsubscribe();
    subs.forEach((s) => s.resolve());
    await Promise.all([subscribing, unsubscribing]);
    expect(subs.every((s) => s.unsub.mock.calls.length === 1)).toBe(true);
    subs[0].push({ events: [] });
    expect(onEvents).not.toHaveBeenCalled();
  });

  it('subscribe() twice unsubscribes the previous set first', async () => {
    const { sub, subs, last, onEvents } = setup();
    await sub.subscribe();
    const first = [...subs];
    first[0].push({ events: [timed('old', '2026-10-20T09:00:00Z', '2026-10-20T10:00:00Z')] });
    await sub.subscribe();
    expect(subs).toHaveLength(4);
    expect(first.every((s) => s.unsub.mock.calls.length === 1)).toBe(true);
    const calls = onEvents.mock.calls.length;
    first[0].push({ events: [timed('stale', '2026-10-20T09:00:00Z', '2026-10-20T10:00:00Z')] });
    expect(onEvents.mock.calls.length).toBe(calls);
    subs[2].push({ events: [timed('new', '2026-10-20T09:00:00Z', '2026-10-20T10:00:00Z')] });
    expect(last()).toEqual(['new']);
  });
});
