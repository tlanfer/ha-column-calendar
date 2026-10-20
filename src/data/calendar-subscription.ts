import { TZDate } from '@date-fns/tz';
import type {
  CalendarEvent,
  DateRange,
  HomeAssistant,
  ResolvedEntity,
  SubscriptionUnsubscribe,
} from '../types';

export interface CalendarSubscriptionOptions {
  hass: HomeAssistant;
  /** In config order; this order is the secondary sort key. */
  entities: ResolvedEntity[];
  range: DateRange;
  /** Display time zone (needed to interpret all-day `date` values). */
  tz: string;
  /** Called with the merged events of all entities whenever any entity updates. */
  onEvents: (events: CalendarEvent[]) => void;
  /**
   * Called when subscribing for one entity fails (rejected subscription) or HA
   * pushes `events: null` (backend fetch failed). Other entities keep working.
   */
  onError?: (entity: string, error: unknown) => void;
}

/** Wire format of one `calendar/event/subscribe` push (see docs/ha-api-notes.md). */
interface SubscriptionPayload {
  events: unknown[] | null;
}

/** Display name: config name → `friendly_name` → entity id. */
export function calendarNameFor(entity: ResolvedEntity, hass: HomeAssistant): string {
  const friendly = hass.states?.[entity.entity]?.attributes?.friendly_name;
  return entity.name ?? (typeof friendly === 'string' && friendly ? friendly : entity.entity);
}

/**
 * Live event feed for a set of calendars over one range.
 *
 * Opens one `calendar/event/subscribe` WebSocket subscription per entity
 * (`{ type, entity_id, start, end }` with UTC ISO timestamps of `range.start` / `range.end`),
 * keeps the latest events per entity (each push replaces that entity's list) and emits
 * the merged list — sorted by start, ties broken by entity config order (stable) — via
 * `onEvents`. To change the range: `unsubscribe()` and create a new one.
 */
export class CalendarSubscription {
  private unsubs: Promise<SubscriptionUnsubscribe | undefined>[] = [];
  private eventsByEntity = new Map<string, CalendarEvent[]>();
  /** Incremented on every (un)subscribe; callbacks from older generations are ignored. */
  private generation = 0;

  constructor(private readonly options: CalendarSubscriptionOptions) {}

  /** Start all per-entity subscriptions. Resolves once all subscribe calls settled. */
  async subscribe(): Promise<void> {
    if (this.unsubs.length) await this.unsubscribe();
    const gen = ++this.generation;
    const { hass, entities, range, tz, onError } = this.options;
    this.eventsByEntity = new Map();

    this.unsubs = entities.map((entity) => {
      const name = calendarNameFor(entity, hass);
      const callback = (message: SubscriptionPayload) => {
        if (gen !== this.generation) return;
        if (!message || !Array.isArray(message.events)) {
          this.eventsByEntity.delete(entity.entity);
          onError?.(entity.entity, new Error('calendar events unavailable'));
        } else {
          this.eventsByEntity.set(entity.entity, parseEventPayload(message, entity, name, tz));
        }
        this.emit();
      };
      let promise: Promise<SubscriptionUnsubscribe>;
      try {
        promise = hass.connection.subscribeMessage<SubscriptionPayload>(callback, {
          type: 'calendar/event/subscribe',
          entity_id: entity.entity,
          // Plain-Date conversion: `TZDate#toISOString()` keeps the zone offset, HA's own
          // frontend sends UTC ("…Z") strings.
          start: new Date(range.start.getTime()).toISOString(),
          end: new Date(range.end.getTime()).toISOString(),
        });
      } catch (err) {
        promise = Promise.reject(err);
      }
      return promise.then(
        (unsub) => unsub,
        (err: unknown) => {
          if (gen === this.generation) onError?.(entity.entity, err);
          return undefined;
        },
      );
    });

    await Promise.all(this.unsubs);
  }

  /** Cancel all subscriptions; safe to call multiple times and before `subscribe` settled. */
  async unsubscribe(): Promise<void> {
    this.generation++;
    const pending = this.unsubs;
    this.unsubs = [];
    this.eventsByEntity = new Map();
    await Promise.all(
      pending.map((p) =>
        p
          .then((unsub) => unsub?.())
          .catch(() => {
            /* already gone / connection closed */
          }),
      ),
    );
  }

  private emit(): void {
    const order = new Map(this.options.entities.map((e, i) => [e.entity, i]));
    const merged: CalendarEvent[] = [];
    for (const e of this.options.entities)
      merged.push(...(this.eventsByEntity.get(e.entity) ?? []));
    merged.sort(
      (a, b) =>
        a.start.getTime() - b.start.getTime() ||
        (order.get(a.entity) ?? 0) - (order.get(b.entity) ?? 0),
    );
    this.options.onEvents(merged);
  }
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseAllDay(value: unknown, tz: string): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const m = DATE_RE.exec(value);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new TZDate(y, mo - 1, d, tz);
  // Reject overflowing dates such as 2026-02-31.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) {
    return undefined;
  }
  return date;
}

function parseTimed(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !value.includes('T')) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function optString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Convert one `calendar/event/subscribe` push (`{ events: SubEvent[] | null }`) into
 * normalized events. All-day events have "YYYY-MM-DD" start/end (interpreted as midnight
 * in `tz`, end exclusive); timed events ISO date-times with offset (honored as given).
 * Malformed and cancelled items are skipped; `events: null` yields `[]`.
 */
export function parseEventPayload(
  payload: unknown,
  entity: ResolvedEntity,
  calendarName: string,
  tz: string,
): CalendarEvent[] {
  const events = (payload as SubscriptionPayload | null | undefined)?.events;
  if (!Array.isArray(events)) return [];
  const result: CalendarEvent[] = [];
  for (const raw of events) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.status === 'string' && item.status.toUpperCase() === 'CANCELLED') continue;
    const allDay =
      item.all_day === true || (item.all_day == null && DATE_RE.test(String(item.start)));
    const start = allDay ? parseAllDay(item.start, tz) : parseTimed(item.start);
    const end = allDay ? parseAllDay(item.end, tz) : parseTimed(item.end);
    if (!start || !end || end.getTime() < start.getTime()) continue;
    result.push({
      uid: optString(item.uid),
      entity: entity.entity,
      calendarName,
      color: entity.color,
      summary: typeof item.summary === 'string' ? item.summary : '',
      description: optString(item.description),
      location: optString(item.location),
      start,
      end,
      allDay,
    });
  }
  return result;
}
