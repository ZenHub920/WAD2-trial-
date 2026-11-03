import { defineComponent, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MeetupAvailabilityGrid from '../../client/src/components/MeetupAvailabilityGrid.vue';

const start = Date.parse('2030-01-01T08:00:00Z');
const halfHour = 1800000;
const slots = [0, 1, 2].map(index => ({ startsAt: start + index * halfHour, availableCount: index }));
const originalHitTest = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
const mounted = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) if (wrapper.exists()) wrapper.unmount();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalHitTest) Object.defineProperty(document, 'elementFromPoint', originalHitTest);
  else delete document.elementFromPoint;
});
async function pointer(target, type, properties = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { value });
  target.element.dispatchEvent(event);
  await nextTick();
  return event;
}
function setup({ selected = [], grid = slots, disabled = false } = {}) {
  const values = ref(selected), locked = ref(disabled), rows = ref(grid);
  const wrapper = mount(defineComponent({
    components: { MeetupAvailabilityGrid },
    setup: () => ({ values, locked, rows }),
    template: '<MeetupAvailabilityGrid :grid="rows" :participant-count="2" v-model:selected="values" :disabled="locked" />',
  }), { attachTo: document.body });
  mounted.push(wrapper);
  const component = wrapper.getComponent(MeetupAvailabilityGrid);
  const cell = stamp => component.get(`[data-availability-start="${stamp}"]`);
  return { wrapper, component, values, locked, rows, cell };
}
describe('drag-to-paint group availability', () => {
  it.each([1, 2, 7])('preserves %i-day slot topology while the responsive table fills its viewport above a safe column minimum', days => {
    const grid = Array.from({ length: days }, (_, day) => slots.map(slot => ({ ...slot, startsAt: slot.startsAt + day * 86400000 }))).flat();
    const { component } = setup({ grid });
    expect(component.findAll('thead th')).toHaveLength(days + 1);
    expect(component.findAll('tbody tr')).toHaveLength(slots.length);
    expect(component.findAll('[data-availability-start]')).toHaveLength(days * slots.length);
    expect(component.get('table').element.style.width).toBe('');
    expect(component.get('table').element.style.minWidth).toBe(`${2.5 + days * 3.25}rem`);
    expect(component.classes('availability-grid--short')).toBe(days <= 2);
  });
  it('keeps dense long windows distinct from the larger short-window targets without dropping any half-hours', () => {
    const grid = Array.from({ length: 12 }, (_, index) => ({ startsAt: start + index * halfHour, availableCount: 1 }));
    const { component } = setup({ grid });
    expect(component.classes('availability-grid--short')).toBe(false);
    expect(component.findAll('[data-availability-start]')).toHaveLength(12);
    expect(component.findAll('tbody tr')).toHaveLength(12);
  });
  it('shows Singapore days, saved aggregate counts and independent own-selection marks', () => {
    const { component, cell } = setup({ selected: [start], grid: [
      ...slots, { startsAt: start + 86400000, availableCount: 1 },
    ] });
    expect(component.text()).toContain('Tue, 1 Jan');
    expect(component.text()).toContain('Wed, 2 Jan');
    expect(component.text()).toContain('16:00');
    expect(component.text()).toContain('All times are Singapore time.');
    expect(cell(start).attributes('aria-pressed')).toBe('true');
    expect(cell(start).text()).toContain('0/2');
    expect(cell(start).attributes('aria-label')).toContain('You are available.');
    expect(cell(start + halfHour * 2).attributes('data-heat')).toBe('4');
    expect(cell(start + halfHour * 2).attributes('aria-label')).toContain('2 of 2 available');
  });
  it('allows a tap or keyboard-generated click to add and remove a time', async () => {
    const { cell, values } = setup();
    await cell(start).trigger('click');
    expect(values.value).toEqual([start]);
    await cell(start).trigger('click');
    expect(values.value).toEqual([]);
  });
  it('keeps compact cells uncluttered while exposing exact counts on hover and focus', async () => {
    const { component, cell } = setup();
    expect(cell(start).get('.availability-grid__count').text()).toBe('0/2');
    await cell(start + halfHour * 2).trigger('mouseenter');
    expect(component.get('.availability-grid__inspection').text()).toContain('2 of 2 available');
    expect(component.get('.availability-grid__inspection').text()).toContain('17:00–17:30');
    await component.get('.availability-grid__scroll').trigger('mouseleave');
    await cell(start + halfHour).trigger('focus');
    expect(component.get('.availability-grid__inspection').text()).toContain('1 of 2 available');
  });
  it('paints skipped cells in one column without toggling them again on revisit or click', async () => {
    const { component, cell, values } = setup();
    const target = vi.fn(() => cell(start + halfHour * 2).element);
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: target });
    await pointer(cell(start), 'pointerdown', { button: 0, pointerId: 7, isPrimary: true });
    await pointer(component.get('.availability-grid__scroll'), 'pointermove', { pointerId: 7, clientX: 20, clientY: 50 });
    target.mockReturnValue(cell(start).element);
    await pointer(component.get('.availability-grid__scroll'), 'pointermove', { pointerId: 7, clientX: 20, clientY: 10 });
    await pointer(component.get('.availability-grid__scroll'), 'pointerup', { pointerId: 7 });
    cell(start).element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await nextTick();
    expect(values.value).toEqual([start, start + halfHour, start + halfHour * 2]);
  });
  it('erases using the first selected cell and stops after touch cancellation', async () => {
    vi.useFakeTimers();
    const { component, cell, values } = setup({ selected: slots.map(slot => slot.startsAt) });
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => cell(start + halfHour * 2).element });
    await pointer(cell(start), 'pointerdown', { button: 0, pointerId: 9, pointerType: 'touch' });
    await vi.advanceTimersByTimeAsync(300);
    await pointer(component.get('.availability-grid__scroll'), 'pointermove', { pointerId: 9 });
    await pointer(component.get('.availability-grid__scroll'), 'pointercancel', { pointerId: 9 });
    expect(values.value).toEqual([]);
    await pointer(component.get('.availability-grid__scroll'), 'pointermove', { pointerId: 9 });
    expect(values.value).toEqual([]);
  });
  it('supports arrow-key navigation and ignores disabled interaction', async () => {
    const { cell, locked, values, wrapper } = setup();
    cell(start).element.focus();
    await cell(start).trigger('keydown', { key: 'ArrowDown' });
    expect(document.activeElement).toBe(cell(start + halfHour).element);
    await cell(start + halfHour).trigger('keydown', { key: 'End' });
    expect(document.activeElement).toBe(cell(start + halfHour * 2).element);
    locked.value = true;
    await wrapper.vm.$nextTick();
    await pointer(cell(start), 'pointerdown', { button: 0, pointerId: 2 });
    await cell(start).trigger('click');
    expect(values.value).toEqual([]);
    expect(cell(start).element.disabled).toBe(true);
  });
  it('does not paint an element outside the grid and handles an empty planning window', async () => {
    const { component, cell, values, rows, wrapper } = setup();
    const outside = document.createElement('button');
    outside.dataset.availabilityStart = String(start + halfHour * 2);
    document.body.append(outside);
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => outside });
    await pointer(cell(start), 'pointerdown', { button: 0, pointerId: 3 });
    await pointer(component.get('.availability-grid__scroll'), 'pointermove', { pointerId: 3 });
    window.dispatchEvent(new Event('blur'));
    expect(values.value).toEqual([start]);
    rows.value = [];
    await wrapper.vm.$nextTick();
    expect(component.text()).toContain('No time slots in this planning window.');
    outside.remove();
  });
  it('waits for touch intent, then selects a tap exactly once without blocking native pan on touch down', async () => {
    vi.useFakeTimers();
    const { cell, values, component } = setup();
    const down = await pointer(cell(start), 'pointerdown', { button: 0, pointerId: 10, pointerType: 'touch', clientX: 20, clientY: 20 });
    expect(down.defaultPrevented).toBe(false);
    await vi.advanceTimersByTimeAsync(299);
    expect(values.value).toEqual([]);
    await pointer(cell(start), 'pointerup', { pointerId: 10 });
    cell(start).element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await nextTick();
    expect(values.value).toEqual([start]);
    expect(component.get('.availability-grid__scroll').attributes('data-touch-painting')).toBe('false');
  });
  it('allows a vertical or horizontal swipe to scroll without selecting or later claiming the gesture', async () => {
    vi.useFakeTimers();
    const { component, cell, values } = setup();
    const scroll = component.get('.availability-grid__scroll');
    for (const movement of [{ clientX: 40, clientY: 20 }, { clientX: 20, clientY: 40 }]) {
      await pointer(cell(start), 'pointerdown', { button: 0, pointerId: 11, pointerType: 'touch', clientX: 20, clientY: 20 });
      const move = await pointer(scroll, 'pointermove', { pointerId: 11, ...movement });
      const touch = await pointer(scroll, 'touchmove', { touches: [{}] });
      expect(move.defaultPrevented).toBe(false);
      expect(touch.defaultPrevented).toBe(false);
      await vi.advanceTimersByTimeAsync(400);
      await pointer(scroll, 'pointerup', { pointerId: 11 });
      cell(start).element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      await nextTick();
      expect(values.value).toEqual([]);
    }
  });
  it('holds to paint skipped half-hours and prevents native scrolling only while painting is claimed', async () => {
    vi.useFakeTimers();
    const { component, cell, values } = setup();
    const scroll = component.get('.availability-grid__scroll');
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => cell(start + halfHour * 2).element });
    await pointer(cell(start), 'pointerdown', { button: 0, pointerId: 12, pointerType: 'touch' });
    await vi.advanceTimersByTimeAsync(300);
    expect(values.value).toEqual([start]);
    expect(scroll.attributes('data-touch-painting')).toBe('true');
    expect((await pointer(scroll, 'touchmove', { touches: [{}] })).defaultPrevented).toBe(true);
    await pointer(scroll, 'pointermove', { pointerId: 12 });
    expect(values.value).toEqual(slots.map(slot => slot.startsAt));
    expect((await pointer(scroll, 'contextmenu')).defaultPrevented).toBe(true);
    await pointer(scroll, 'pointerup', { pointerId: 12 });
    expect((await pointer(scroll, 'touchmove', { touches: [{}] })).defaultPrevented).toBe(false);
    expect((await pointer(scroll, 'contextmenu')).defaultPrevented).toBe(false);
  });
  it.each(['pointercancel', 'blur', 'disabled', 'unmount'])('cancels a pending hold on %s without changing the draft', async reason => {
    vi.useFakeTimers();
    const { component, cell, values, locked, wrapper } = setup();
    const remove = vi.spyOn(window, 'removeEventListener');
    const removeTouch = vi.spyOn(component.get('.availability-grid__scroll').element, 'removeEventListener');
    await pointer(cell(start), 'pointerdown', { button: 0, pointerId: 13, pointerType: 'touch' });
    if (reason === 'pointercancel') await pointer(cell(start), 'pointercancel', { pointerId: 13 });
    if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    if (reason === 'disabled') { locked.value = true; await nextTick(); }
    if (reason === 'unmount') {
      wrapper.unmount();
      expect(remove).toHaveBeenCalledWith('pointerup', expect.any(Function));
      expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
      expect(removeTouch).toHaveBeenCalledWith('touchmove', expect.any(Function));
      expect(removeTouch).toHaveBeenCalledWith('touchstart', expect.any(Function));
    }
    await vi.advanceTimersByTimeAsync(400);
    expect(values.value).toEqual([]);
  });
  it('cancels pending touch painting when a second finger starts so pinch zoom stays native', async () => {
    vi.useFakeTimers();
    const { component, cell, values } = setup();
    const scroll = component.get('.availability-grid__scroll');
    await pointer(cell(start), 'pointerdown', { button: 0, pointerId: 14, pointerType: 'touch' });
    expect((await pointer(scroll, 'touchstart', { touches: [{}, {}] })).defaultPrevented).toBe(false);
    await vi.advanceTimersByTimeAsync(400);
    expect((await pointer(scroll, 'touchmove', { touches: [{}, {}] })).defaultPrevented).toBe(false);
    expect(values.value).toEqual([]);
  });
  it('announces horizontal overflow only when more days extend beyond the scroll viewport', async () => {
    const { component } = setup();
    const scroll = component.get('.availability-grid__scroll').element;
    Object.defineProperties(scroll, {
      clientWidth: { configurable: true, value: 200 },
      scrollWidth: { configurable: true, value: 600 },
    });
    window.dispatchEvent(new Event('resize'));
    await nextTick();
    expect(component.get('.availability-grid__scroll-hint').text()).toContain('Scroll sideways for more days');
    expect(component.get('table').attributes('aria-describedby')).toContain(component.get('.availability-grid__scroll-hint').attributes('id'));
    Object.defineProperty(scroll, 'scrollWidth', { configurable: true, value: 200 });
    window.dispatchEvent(new Event('resize'));
    await nextTick();
    expect(component.find('.availability-grid__scroll-hint').exists()).toBe(false);
  });
});
