import '../src/column-calendar-card';
import type { ColumnCalendarCard } from '../src/column-calendar-card';
import type { ColumnCalendarCardEditor } from '../src/editor/column-calendar-card-editor';
import type { ColumnCalendarCardConfig } from '../src/types';
import { createMockHass } from './mock-hass';

interface Demo {
  label: string;
  config: Omit<ColumnCalendarCardConfig, 'type'>;
  /** Wrapper class: `narrow` (360px) or `grid-cell` (sections rows: 6). */
  wrapper?: 'narrow' | 'grid-cell';
  /** Sets `card.layout = 'grid'` like HA's sections view. */
  grid?: boolean;
  full?: boolean;
}

const ENTITIES: ColumnCalendarCardConfig['entities'] = [
  'calendar.family',
  { entity: 'calendar.work', color: '#1e88e5', name: 'Work' },
  'calendar.trash',
];

const DEMOS: Demo[] = [
  {
    label: 'Week mode (full width)',
    full: true,
    config: { mode: 'week', title: 'Family', entities: ENTITIES },
  },
  {
    label: 'Rolling, 5 days, end times',
    config: { mode: 'rolling', days: 5, show_end_time: true, entities: ENTITIES },
  },
  {
    label: 'Narrow container (360px) → horizontal scroll',
    wrapper: 'narrow',
    config: { mode: 'week', entities: ENTITIES, show_navigation: false },
  },
  {
    label: 'Fixed height 400px, custom accent',
    config: {
      mode: 'week',
      height: '400px',
      accent_color: '#8e24aa',
      entities: [
        { entity: 'calendar.family', color: '#43a047' },
        { entity: 'calendar.work', color: '#fb8c00', name: 'Job' },
        'calendar.trash',
      ],
    },
  },
  {
    label: "Sections grid cell (layout='grid', grid_options.rows: 6)",
    wrapper: 'grid-cell',
    grid: true,
    config: {
      mode: 'rolling',
      days: 7,
      title: 'Sections',
      entities: ENTITIES,
      grid_options: { columns: 12, rows: 6 },
    },
  },
  {
    label: 'Invalid config (error display)',
    config: { entities: [] },
  },
];

const params = new URLSearchParams(location.search);
let theme = params.get('theme') === 'dark' ? 'dark' : 'light';
let lang = params.get('lang') === 'de' ? 'de' : 'en';

const cards: ColumnCalendarCard[] = [];
const app = document.getElementById('app')!;

for (const demo of DEMOS) {
  const section = document.createElement('section');
  section.className = demo.full ? 'demo full' : 'demo';
  const heading = document.createElement('h2');
  heading.textContent = demo.label;
  section.append(heading);

  let host: HTMLElement = section;
  if (demo.wrapper) {
    host = document.createElement('div');
    host.className = demo.wrapper;
    section.append(host);
  }

  const card = document.createElement('column-calendar-card');
  try {
    card.setConfig({ type: 'custom:column-calendar-card', ...demo.config });
    if (demo.grid) card.layout = 'grid';
    card.hass = createMockHass({ language: lang });
    cards.push(card);
    host.append(card);
  } catch (err) {
    // HA shows a red error card for setConfig throws; mimic that.
    const box = document.createElement('div');
    box.className = 'config-error';
    box.textContent = `Configuration error: ${err instanceof Error ? err.message : String(err)}`;
    host.append(box);
  }
  app.append(section);
}

// ------------------------------------------------------------- visual editor demo
// Outside HA `ha-form` / `ha-entity-picker` are not available, so the editor shows its
// native fallback inputs here. config-changed → card.setConfig + YAML-ish JSON dump.
const editors: ColumnCalendarCardEditor[] = [];
{
  const section = document.createElement('section');
  section.className = 'demo full editor-demo';
  section.innerHTML = `<h2>Visual editor (native fallback; HA components unavailable)</h2>
    <div class="editor-grid">
      <div class="editor-pane"></div>
      <div class="preview-pane"><pre class="config-dump"></pre></div>
    </div>`;
  const editorPane = section.querySelector<HTMLElement>('.editor-pane')!;
  const previewPane = section.querySelector<HTMLElement>('.preview-pane')!;
  const dump = section.querySelector<HTMLElement>('.config-dump')!;

  let config: ColumnCalendarCardConfig = {
    type: 'custom:column-calendar-card',
    title: 'Editor preview',
    entities: ['calendar.family', { entity: 'calendar.work', name: 'Work' }],
    grid_options: { columns: 12 },
  };

  const editor = document.createElement('column-calendar-card-editor');
  editor.hass = createMockHass({ language: lang });
  editor.setConfig(config);
  editors.push(editor);
  editorPane.append(editor);

  const card = document.createElement('column-calendar-card');
  card.hass = createMockHass({ language: lang });
  cards.push(card);
  const error = document.createElement('div');
  error.className = 'config-error';
  previewPane.prepend(card, error);

  const apply = () => {
    dump.textContent = JSON.stringify(config, null, 2);
    try {
      card.setConfig(config);
      card.hidden = false;
      error.hidden = true;
    } catch (err) {
      card.hidden = true;
      error.hidden = false;
      error.textContent = `Configuration error: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
  editor.addEventListener('config-changed', (ev) => {
    config = (ev as CustomEvent<{ config: ColumnCalendarCardConfig }>).detail.config;
    apply();
  });
  apply();
  app.prepend(section);
}

function syncUrl() {
  const url = new URL(location.href);
  url.searchParams.set('theme', theme);
  url.searchParams.set('lang', lang);
  history.replaceState(null, '', url);
}

const themeBtn = document.getElementById('toggle-theme')!;
const langBtn = document.getElementById('toggle-lang')!;

function applyTheme() {
  document.documentElement.dataset.theme = theme;
  themeBtn.textContent = `Theme: ${theme}`;
}

function applyLang() {
  document.documentElement.lang = lang;
  langBtn.textContent = `Language: ${lang}`;
  // HA hands cards a new `hass` object whenever anything changes.
  for (const card of cards) card.hass = createMockHass({ language: lang });
  for (const editor of editors) editor.hass = createMockHass({ language: lang });
}

themeBtn.addEventListener('click', () => {
  theme = theme === 'light' ? 'dark' : 'light';
  applyTheme();
  syncUrl();
});
langBtn.addEventListener('click', () => {
  lang = lang === 'en' ? 'de' : 'en';
  applyLang();
  syncUrl();
});

applyTheme();
applyLang();
