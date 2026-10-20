import type { HomeAssistant } from './types';

const en = {
  all_day: 'All day',
  today: 'Today',
  no_events: 'No events',
  day_n_of_m: 'Day {n}/{m}',
  previous: 'Previous',
  next: 'Next',
  close: 'Close',
  location: 'Location',
  description: 'Description',
  calendar: 'Calendar',
  error_loading: 'Could not load {name}',
  editor_calendars: 'Calendars',
  editor_add_calendar: 'Add calendar',
  editor_no_calendars: 'No calendars yet. Add at least one.',
  editor_general: 'General',
  editor_move_up: 'Move up',
  editor_move_down: 'Move down',
  editor_remove: 'Remove',
  editor_color: 'Color',
  editor_reset_color: 'Use automatic color',
  editor_name: 'Name',
  editor_entity: 'Calendar',
  editor_mode: 'Mode',
  editor_mode_week: 'Week',
  editor_mode_rolling: 'Rolling days',
  editor_first_day: 'First day of the week',
  editor_first_day_auto: 'Automatic (user profile)',
  editor_days: 'Number of days',
  editor_title: 'Title',
  editor_show_range: 'Show date range',
  editor_show_navigation: 'Show navigation',
  editor_navigation_reset: 'Return to today after (seconds)',
  editor_navigation_reset_helper: '0 = never',
  editor_show_end_time: 'Show end times',
  editor_show_location: 'Show locations',
  editor_show_empty: 'Show "No events" placeholder',
  editor_min_column_width: 'Minimum column width (px)',
  editor_accent_color: 'Accent color',
  editor_accent_color_helper: 'CSS color, e.g. #e8173a',
  editor_height: 'Height',
  editor_height_helper: 'CSS length, e.g. 500px. Empty = automatic.',
  editor_components_unavailable:
    'Home Assistant form components are unavailable; showing basic inputs.',
};

export type TranslationKey = keyof typeof en;

export function isTranslationKey(key: string): key is TranslationKey {
  return Object.hasOwn(en, key);
}

const translations: Record<string, Partial<Record<TranslationKey, string>>> = {
  en,
  de: {
    all_day: 'Ganztägig',
    today: 'Heute',
    no_events: 'Keine Termine',
    day_n_of_m: 'Tag {n}/{m}',
    previous: 'Zurück',
    next: 'Weiter',
    close: 'Schließen',
    location: 'Ort',
    description: 'Beschreibung',
    calendar: 'Kalender',
    error_loading: '{name} konnte nicht geladen werden',
    editor_calendars: 'Kalender',
    editor_add_calendar: 'Kalender hinzufügen',
    editor_no_calendars: 'Noch keine Kalender. Füge mindestens einen hinzu.',
    editor_general: 'Allgemein',
    editor_move_up: 'Nach oben',
    editor_move_down: 'Nach unten',
    editor_remove: 'Entfernen',
    editor_color: 'Farbe',
    editor_reset_color: 'Automatische Farbe verwenden',
    editor_name: 'Name',
    editor_entity: 'Kalender',
    editor_mode: 'Modus',
    editor_mode_week: 'Woche',
    editor_mode_rolling: 'Fortlaufende Tage',
    editor_first_day: 'Erster Wochentag',
    editor_first_day_auto: 'Automatisch (Benutzerprofil)',
    editor_days: 'Anzahl Tage',
    editor_title: 'Titel',
    editor_show_range: 'Zeitraum anzeigen',
    editor_show_navigation: 'Navigation anzeigen',
    editor_navigation_reset: 'Zurück zu heute nach (Sekunden)',
    editor_navigation_reset_helper: '0 = nie',
    editor_show_end_time: 'Endzeiten anzeigen',
    editor_show_location: 'Orte anzeigen',
    editor_show_empty: 'Platzhalter „Keine Termine“ anzeigen',
    editor_min_column_width: 'Minimale Spaltenbreite (px)',
    editor_accent_color: 'Akzentfarbe',
    editor_accent_color_helper: 'CSS-Farbe, z. B. #e8173a',
    editor_height: 'Höhe',
    editor_height_helper: 'CSS-Länge, z. B. 500px. Leer = automatisch.',
    editor_components_unavailable:
      'Home-Assistant-Formularelemente nicht verfügbar; einfache Eingaben werden angezeigt.',
  },
};

/**
 * Translate `key` for the user's language (`hass.locale.language`, e.g. "de-AT" → "de"),
 * falling back to English. `{name}` placeholders are replaced from `vars`.
 */
export function t(
  hass: HomeAssistant | undefined,
  key: TranslationKey,
  vars?: Record<string, string | number>,
): string {
  const lang = (hass?.locale?.language ?? hass?.language ?? 'en').split('-')[0].toLowerCase();
  const template = translations[lang]?.[key] ?? en[key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    vars && name in vars ? String(vars[name]) : match,
  );
}
