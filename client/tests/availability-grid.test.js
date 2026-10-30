import { defineComponent, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MeetupAvailabilityGrid from '../src/components/MeetupAvailabilityGrid.vue';

const start = Date.parse('2030-01-01T08:00:00Z');
const halfHour = 1800000;
const slots = [0, 1, 2].map(index => ({ startsAt: start + index * halfHour, availableCount: index }));
const originalHitTest = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
afterEach(() => {
  if (originalHitTest) Object.defineProperty(document, 'elementFromPoint', originalHitTest);
  else delete document.elementFromPoint;
});
async function pointer(target, type, properties = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { value });
  target.element.dispatchEvent(event);
  await nextTick();
}
function setup({ selected = [], grid = slots, disabled = false } = {}) {
  const values = ref(selected), locked = ref(disabled), rows = ref(grid);
  const wrapper = mount(defineComponent({
    components: { MeetupAvailabilityGrid },
    setup: () => ({ values, locked, rows }),
    template: '<MeetupAvailabilityGrid :grid="rows" :participant-count="2" v-model:selected="values" :disabled="locked" />',
  }), { attachTo: document.body });
  const component = wrapper.getComponent(MeetupAvailabilityGrid);
  const cell = stamp => component.get(`[data-availability-start="${stamp}"]`);
  return { wrapper, component, values, locked, rows, cell };
}
describe('drag-to-paint group availability', () => {
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
    const { component, cell, values } = setup({ selected: slots.map(slot => slot.startsAt) });
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => cell(start + halfHour * 2).element });
    await pointer(cell(start), 'pointerdown', { button: 0, pointerId: 9, pointerType: 'touch' });
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
  });
});
