import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import SwipeDeck from '../src/components/SwipeDeck.vue';

const motion = vi.hoisted(() => ({ reduced: true }));
vi.mock('../src/composables/useReducedMotion.js', async () => {
  const { computed } = await import('vue');
  return { useReducedMotion: () => computed(() => motion.reduced) };
});
const items = [{ id: 'a', user: { displayName: 'Sam' } }, { id: 'b', user: { displayName: 'Lee' } }];
const makeDeck = commitItem => mount(SwipeDeck, { props: { items, commitItem, nounSingular: 'profile', yesLabel: 'Like', noLabel: 'Skip' }, slots: { card: '<a href="/people/test">Profile</a>' } });

describe('swipe feedback and persistence', () => {
  it('shows readable actions, saves once and advances only after persistence', async () => {
    motion.reduced = true;
    let resolve;
    const commit = vi.fn(() => new Promise(done => { resolve = done; }));
    const wrapper = makeDeck(commit);
    expect(wrapper.get('[aria-label="Like this profile"]').text()).toBe('Like');
    await wrapper.get('[aria-label="Like this profile"]').trigger('click');
    await wrapper.get('.deck__stage').trigger('keydown', { key: 'ArrowRight' });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(wrapper.get('.deck__count').text()).toContain('2');
    expect(wrapper.text()).toContain('Saving decision');
    resolve(); await flushPromises();
    expect(wrapper.get('.deck__count').text()).toContain('1');
    expect(wrapper.emitted('shortlist')).toHaveLength(1);
  });
  it('keeps a failed decision available for retry without announcing a successful like', async () => {
    motion.reduced = true;
    const wrapper = makeDeck(vi.fn().mockRejectedValue(new Error('unavailable')));
    await wrapper.get('[aria-label="Like this profile"]').trigger('click'); await flushPromises();
    expect(wrapper.get('.deck__count').text()).toContain('2');
    expect(wrapper.emitted('shortlist')).toBeUndefined();
    expect(wrapper.text()).toContain('Could not save decision');
    expect(wrapper.get('[aria-label="Like this profile"]').element.disabled).toBe(false);
  });
  it('starts the request immediately with motion enabled and suppresses duplicate decisions during its animation', async () => {
    vi.useFakeTimers(); motion.reduced = false;
    const commit = vi.fn().mockResolvedValue({});
    const wrapper = makeDeck(commit);
    await wrapper.get('[aria-label="Like this profile"]').trigger('click'); await flushPromises();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(wrapper.get('.deck__count').text()).toContain('2');
    await wrapper.get('.deck__stage').trigger('keydown', { key: 'ArrowLeft' });
    await vi.advanceTimersByTimeAsync(210); await flushPromises();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('shortlist')).toHaveLength(1);
    expect(wrapper.get('.deck__count').text()).toContain('1');
  });
  it('keeps background profiles inert and ignores non-primary dragging', async () => {
    motion.reduced = true;
    const commit = vi.fn(); const wrapper = makeDeck(commit);
    expect(wrapper.findAll('.deck__card')[1].attributes()).toHaveProperty('inert');
    const card = wrapper.get('.deck__card--top');
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
      const event = new MouseEvent(type, { bubbles: true, button: 2, clientX: type === 'pointerdown' ? 0 : 200 });
      Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
      card.element.dispatchEvent(event);
    }
    await flushPromises();
    expect(commit).not.toHaveBeenCalled();
    expect(card.classes()).not.toContain('deck__card--held');
  });
  it('does not emit a successful decision into a departed view', async () => {
    motion.reduced = true;
    let resolve; const wrapper = makeDeck(() => new Promise(done => { resolve = done; }));
    await wrapper.get('[aria-label="Like this profile"]').trigger('click');
    wrapper.unmount(); resolve(); await flushPromises();
    expect(wrapper.emitted('shortlist')).toBeUndefined();
  });
});
