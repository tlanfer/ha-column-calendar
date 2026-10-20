import { describe, expect, it } from 'vitest';
import { t } from '../src/i18n';
import type { HomeAssistant } from '../src/types';

const hassWithLang = (language: string) => ({ language, locale: { language } }) as HomeAssistant;

describe('i18n', () => {
  it('translates with English fallback and placeholders', () => {
    expect(t(hassWithLang('de-AT'), 'today')).toBe('Heute');
    expect(t(hassWithLang('fr'), 'today')).toBe('Today');
    expect(t(hassWithLang('de'), 'day_n_of_m', { n: 2, m: 5 })).toBe('Tag 2/5');
  });
});

describe('card registration', () => {
  it('defines the custom element', async () => {
    await import('../src/column-calendar-card');
    expect(customElements.get('column-calendar-card')).toBeDefined();
    expect(window.customCards?.some((c) => c.type === 'column-calendar-card')).toBe(true);
  });
});
