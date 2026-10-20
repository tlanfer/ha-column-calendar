import '../src/column-calendar-card';
import type { ColumnCalendarCardConfig } from '../src/types';
import { createMockHass } from './mock-hass';

/**
 * Single-card page for README screenshots (no harness chrome).
 *
 * URL params: `?shot=week|rolling|narrow` (default week), `?theme=dark`, `?lang=de`,
 * plus the mock-hass params (`?first=monday`, `?tf=24`, …).
 */

const ENTITIES: ColumnCalendarCardConfig['entities'] = [
  { entity: 'calendar.family', color: '#43a047' },
  { entity: 'calendar.work', color: '#1e88e5', name: 'Work' },
  { entity: 'calendar.trash', color: '#8d6e63' },
];

const SHOTS: Record<string, { width: string; config: Omit<ColumnCalendarCardConfig, 'type'> }> = {
  week: { width: '1200px', config: { mode: 'week', title: 'Family', entities: ENTITIES } },
  rolling: {
    width: '700px',
    config: {
      mode: 'rolling',
      days: 5,
      title: 'Next 5 days',
      show_end_time: true,
      entities: ENTITIES,
    },
  },
  narrow: {
    width: '380px',
    config: { mode: 'week', title: 'Family', entities: ENTITIES, show_range: false },
  },
};

const params = new URLSearchParams(location.search);
const shot = SHOTS[params.get('shot') ?? 'week'] ?? SHOTS.week;
const lang = params.get('lang') === 'de' ? 'de' : 'en';
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.lang = lang;

const host = document.getElementById('shot')!;
host.style.setProperty('--shot-width', shot.width);
const card = document.createElement('column-calendar-card');
card.setConfig({ type: 'custom:column-calendar-card', ...shot.config });
card.hass = createMockHass({ language: lang });
host.append(card);
