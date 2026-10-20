import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/format', () => ({
  formatDateTimeRange: () => 'Tue, Oct 20, 09:00 – 10:00',
}));

import { CcEventDialog } from '../src/components/cc-event-dialog';
import type { CalendarEvent, HomeAssistant } from '../src/types';

const hass = {
  language: 'en',
  locale: { language: 'en', time_format: '24', first_weekday: 'monday', time_zone: 'server' },
  config: { time_zone: 'Europe/Berlin' },
  states: {},
} as unknown as HomeAssistant;

const event: CalendarEvent = {
  entity: 'calendar.family',
  calendarName: 'Family',
  color: '#1e88e5',
  summary: 'Dentist <b>bold</b>',
  location: 'Main St 1 <script>x</script>',
  description: 'Line one\nLine <i>two</i>',
  start: new Date('2026-10-20T07:00:00Z'),
  end: new Date('2026-10-20T08:00:00Z'),
  allDay: false,
};

async function mount(ev?: CalendarEvent): Promise<CcEventDialog> {
  const el = document.createElement('cc-event-dialog');
  el.hass = hass;
  el.tz = 'Europe/Berlin';
  el.event = ev;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('cc-event-dialog', () => {
  it('renders nothing without an event', async () => {
    const el = await mount();
    expect(el.shadowRoot!.querySelector('dialog')).toBeNull();
    expect(el.shadowRoot!.textContent?.trim()).toBe('');
  });

  it('renders event details as escaped text and opens the dialog', async () => {
    const el = await mount(event);
    const root = el.shadowRoot!;
    const dialog = root.querySelector('dialog')!;
    expect(dialog).not.toBeNull();
    expect(dialog.hasAttribute('open') || dialog.open).toBe(true);

    expect(root.querySelector('h2')!.textContent).toBe('Dentist <b>bold</b>');
    expect(root.querySelector('h2 b')).toBeNull();
    expect(root.querySelector('.location span')!.textContent).toBe('Main St 1 <script>x</script>');
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('.description')!.textContent).toBe('Line one\nLine <i>two</i>');
    expect(root.querySelector('.description i')).toBeNull();
    expect(root.querySelector('.when')!.textContent).toBe('Tue, Oct 20, 09:00 – 10:00');
    expect(root.querySelector('.calendar-name')!.textContent).toBe('Family');
    expect(root.querySelector('.close')!.getAttribute('aria-label')).toBe('Close');
  });

  it('omits location and description sections when absent', async () => {
    const el = await mount({ ...event, location: undefined, description: undefined });
    const root = el.shadowRoot!;
    expect(root.querySelector('.location')).toBeNull();
    expect(root.querySelector('.description')).toBeNull();
  });

  it('fires a bubbling, composed `closed` event from the close button', async () => {
    const el = await mount(event);
    const onClosed = vi.fn();
    document.body.addEventListener('closed', onClosed);
    (el.shadowRoot!.querySelector('.close') as HTMLButtonElement).click();
    expect(onClosed).toHaveBeenCalledTimes(1);
    const fired = onClosed.mock.calls[0][0] as CustomEvent;
    expect(fired.bubbles).toBe(true);
    expect(fired.composed).toBe(true);
    document.body.removeEventListener('closed', onClosed);
  });

  it('fires `closed` on Esc (cancel) and backdrop click', async () => {
    const el = await mount(event);
    const onClosed = vi.fn();
    el.addEventListener('closed', onClosed);
    const dialog = el.shadowRoot!.querySelector('dialog')!;
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(onClosed).toHaveBeenCalledTimes(1);
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClosed).toHaveBeenCalledTimes(2);
    // Clicks inside the content do not close.
    (el.shadowRoot!.querySelector('h2') as HTMLElement).click();
    expect(onClosed).toHaveBeenCalledTimes(2);
  });
});
