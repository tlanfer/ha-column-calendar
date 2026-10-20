import type {
  HassConnection,
  HassEntity,
  HassSubscribeMessage,
  HomeAssistant,
  HaFirstWeekday,
  HaTimeFormat,
  SubscriptionUnsubscribe,
} from '../src/types';

/**
 * Mock `hass` for the dev harness.
 *
 * URL parameters:
 * - `?lang=de|en`            UI language (default en)
 * - `?tf=language|system|12|24`  time format (default language)
 * - `?first=language|monday|…`   first weekday (default language)
 * - `?error=calendar.trash`  push `{events: null}` for these entities (comma-separated)
 * - `?push=30`               re-push events every N seconds (tests "push replaces list")
 *
 * Events are generated relative to *today* (browser local time) so the demo always
 * shows the same pattern: a busy today, an event crossing midnight, a 4-day vacation,
 * a long-text event and some empty days.
 */

/** Wire format of `calendar/event/subscribe` pushes (see docs/ha-api-notes.md). */
interface SubEvent {
  summary: string;
  start: string;
  end: string;
  all_day: boolean;
  description?: string | null;
  location?: string | null;
  uid?: string | null;
  recurrence_id?: string | null;
  rrule?: string | null;
  status?: string | null;
}

interface CalendarEventSubscription {
  events: SubEvent[] | null;
}

export const MOCK_CALENDARS: Record<string, string> = {
  'calendar.family': 'Family',
  'calendar.work': 'Work',
  'calendar.trash': 'Trash pickup',
};

const params = new URLSearchParams(location.search);

export interface MockHassOptions {
  language?: string;
  timeFormat?: HaTimeFormat;
  firstWeekday?: HaFirstWeekday;
}

// ---------------------------------------------------------------------------
// Date helpers (browser local time)
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Whole days between two local midnights (DST safe). */
function dayDiff(a: Date, b: Date): number {
  return Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
      86_400_000,
  );
}

function dateOnly(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** ISO datetime with the local offset, e.g. "2026-10-20T09:30:00+02:00". */
function isoLocal(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${dateOnly(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** ISO datetime in UTC, e.g. "2026-10-20T07:30:00+00:00" (HA may send either form). */
function isoUtc(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

// ---------------------------------------------------------------------------
// Event generation
// ---------------------------------------------------------------------------

interface Draft {
  summary: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  location?: string;
  description?: string;
  /** Serialize timed start/end in UTC instead of local offset. */
  utc?: boolean;
}

function timed(day: Date, h: number, m: number, durationMin: number): { start: Date; end: Date } {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
  return { start, end: new Date(start.getTime() + durationMin * 60_000) };
}

function allDay(day: Date, days = 1): { start: Date; end: Date; allDay: true } {
  return { start: day, end: addDays(day, days), allDay: true };
}

/**
 * Events *starting* on `day`; `k` = days relative to today.
 * Pattern repeats every 7 (some every 14) days. k ≡ 3 (mod 7) is empty for all calendars.
 */
function eventsStartingOn(entity: string, day: Date, k: number): Draft[] {
  const w = mod(k, 7);
  const out: Draft[] = [];
  if (w === 3) return out; // empty day everywhere

  switch (entity) {
    case 'calendar.family':
      if (w === 0) {
        // Busy day: 4 family + 2 work = 6 timed events.
        out.push(
          {
            summary: 'Breakfast with grandma',
            ...timed(day, 7, 30, 60),
            location: 'Café Lindenhof',
          },
          { summary: 'Dentist', ...timed(day, 10, 0, 45), location: 'Dr. Weber, Hauptstr. 12' },
          { summary: 'Pick up kids', ...timed(day, 15, 30, 30), utc: true },
          {
            summary: 'Dinner',
            ...timed(day, 19, 0, 120),
            location: 'Trattoria Roma',
            description: 'Table for 4, booked under Lanfer.',
          },
        );
      }
      if (w === 1) {
        out.push({
          summary: 'Soccer practice',
          ...timed(day, 17, 0, 90),
          location: 'Sportpark Nord, Field 3',
        });
      }
      if (w === 2) {
        out.push({
          summary:
            'Parent-teacher conference about the upcoming school trip and the new homework policy',
          ...timed(day, 18, 30, 90),
          location:
            'Städtisches Gymnasium am Stadtpark, Building B, Room 2.14 (second floor, use the side entrance next to the gym)',
          description:
            'Bring:\n- signed consent form\n- 25 € trip deposit\n- questions about the homework policy\n\nParking is limited, better take the bike.',
        });
      }
      if (w === 4) {
        out.push({ summary: "Mia's birthday", ...allDay(day) });
      }
      if (w === 6) {
        out.push(
          { summary: 'Farmers market', ...timed(day, 9, 0, 120), location: 'Marktplatz' },
          { summary: 'Movie night', ...timed(day, 20, 15, 135), utc: true },
        );
      }
      // 4-day vacation every two weeks, starting on day k ≡ 9 (mod 14).
      if (mod(k, 14) === 9) {
        out.push({
          summary: 'Vacation at the Baltic Sea',
          ...allDay(day, 4),
          location: 'Ferienhaus Strandkorb, Zingst',
        });
      }
      break;

    case 'calendar.work':
      if (w === 0) {
        out.push(
          { summary: 'Daily standup', ...timed(day, 9, 30, 15), location: 'Teams' },
          { summary: 'Sprint review', ...timed(day, 13, 0, 90), location: 'Room Ada' },
        );
      } else if (w === 1 || w === 2) {
        out.push({ summary: 'Daily standup', ...timed(day, 9, 30, 15), location: 'Teams' });
      }
      if (w === 2) {
        out.push({ summary: '1:1 with Sarah', ...timed(day, 11, 0, 30), utc: true });
      }
      if (w === 4) {
        // Crosses midnight: 22:00 → 06:00 next day.
        out.push({
          summary: 'On-call night shift',
          ...timed(day, 22, 0, 8 * 60),
          description: 'Escalations go to the ops channel.',
        });
      }
      break;

    case 'calendar.trash':
      if (w === 1) out.push({ summary: 'Paper bin', ...allDay(day) });
      if (mod(k, 14) === 4) out.push({ summary: 'Residual waste', ...allDay(day) });
      if (mod(k, 14) === 11) out.push({ summary: 'Recycling (yellow bag)', ...allDay(day) });
      break;
  }
  return out;
}

function toWire(entity: string, d: Draft): SubEvent {
  const fmt = d.utc ? isoUtc : isoLocal;
  return {
    summary: d.summary,
    start: d.allDay ? dateOnly(d.start) : fmt(d.start),
    end: d.allDay ? dateOnly(d.end) : fmt(d.end),
    all_day: !!d.allDay,
    description: d.description ?? null,
    location: d.location ?? null,
    uid: `${entity}-${d.summary}-${d.start.getTime()}`,
    recurrence_id: null,
    rrule: null,
    status: null,
  };
}

/** All events of `entity` overlapping [start, end). */
export function generateEvents(entity: string, start: Date, end: Date): SubEvent[] {
  const today = startOfLocalDay(new Date());
  const result: SubEvent[] = [];
  // Look back a few days so multi-day / overnight events starting earlier are included.
  for (let day = addDays(startOfLocalDay(start), -5); day < end; day = addDays(day, 1)) {
    for (const draft of eventsStartingOn(entity, day, dayDiff(today, day))) {
      if (draft.start < end && draft.end > start) result.push(toWire(entity, draft));
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

class MockError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function createConnection(): HassConnection {
  const errorEntities = new Set(
    (params.get('error') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const pushSeconds = Number(params.get('push') ?? 0);
  let nextId = 1;

  return {
    async subscribeMessage<Result>(
      callback: (message: Result) => void,
      msg: HassSubscribeMessage,
    ): Promise<SubscriptionUnsubscribe> {
      if (msg.type !== 'calendar/event/subscribe') {
        throw new MockError('unknown_command', `Mock does not support ${msg.type}`);
      }
      const entity = String(msg.entity_id);
      if (!(entity in MOCK_CALENDARS)) {
        throw new MockError('not_found', `Calendar entity not found: ${entity}`);
      }
      const start = new Date(String(msg.start));
      const end = new Date(String(msg.end));
      if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
        throw new MockError('invalid_format', 'Start must be before end');
      }

      const id = nextId++;
      console.info(`[mock-hass] subscribe #${id}`, entity, msg.start, '→', msg.end);

      let active = true;
      const push = () => {
        if (!active) return;
        const payload: CalendarEventSubscription = errorEntities.has(entity)
          ? { events: null }
          : { events: generateEvents(entity, start, end) };
        callback(payload as Result);
      };
      // HA pushes the initial result asynchronously, after the subscribe resolves.
      setTimeout(push, 150 + Math.random() * 250);
      const timer = pushSeconds > 0 ? setInterval(push, pushSeconds * 1000) : undefined;

      return async () => {
        active = false;
        if (timer) clearInterval(timer);
        console.info(`[mock-hass] unsubscribe #${id}`, entity);
      };
    },
  };
}

const sharedConnection = createConnection();

function createStates(): Record<string, HassEntity> {
  return Object.fromEntries(
    Object.entries(MOCK_CALENDARS).map(([entity_id, friendly_name]) => [
      entity_id,
      { entity_id, state: 'off', attributes: { friendly_name } },
    ]),
  );
}

/** Builds a mock `hass`. Options default to the URL parameters. Connection is shared. */
export function createMockHass(options: MockHassOptions = {}): HomeAssistant {
  const language = options.language ?? params.get('lang') ?? 'en';
  return {
    language,
    locale: {
      language,
      time_format: options.timeFormat ?? (params.get('tf') as HaTimeFormat | null) ?? 'language',
      first_weekday:
        options.firstWeekday ?? (params.get('first') as HaFirstWeekday | null) ?? 'language',
      time_zone: 'local',
    },
    config: { time_zone: 'Europe/Berlin' },
    states: createStates(),
    connection: sharedConnection,
  };
}
