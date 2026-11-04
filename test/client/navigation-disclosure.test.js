import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';
import GroupFilters from '../../client/src/components/GroupFilters.vue';
import SegmentedTabs from '../../client/src/components/SegmentedTabs.vue';
import SiteHeader from '../../client/src/components/SiteHeader.vue';
import { mountPage } from './helpers.js';

vi.mock('../../client/src/auth.js', async () => {
  const { ref } = await import('vue');
  return { currentUser: ref(null) };
});
vi.mock('../../client/src/chatLive.js', async () => {
  const { ref } = await import('vue');
  return { unreadTotal: ref(0) };
});
afterEach(() => vi.restoreAllMocks());

describe('navigation and filter disclosure', () => {
  it('moves segmented selection and keyboard focus together with arrows, Home and End', async () => {
    let wrapper;
    wrapper = mount(SegmentedTabs, { attachTo: document.body, props: {
      modelValue: 'companion',
      tabs: [{ id: 'companion', label: 'Companions' }, { id: 'tickets', label: 'Tickets' }, { id: 'groups', label: 'Groups' }],
      'onUpdate:modelValue': value => wrapper.setProps({ modelValue: value }),
    } });
    const tabs = wrapper.findAll('[role="tab"]');
    expect(tabs.map(tab => tab.attributes('tabindex'))).toEqual(['0', '-1', '-1']);
    tabs[0].element.focus();
    await tabs[0].trigger('keydown', { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tabs[2].element);
    expect(tabs[2].attributes('aria-selected')).toBe('true');
    expect(tabs.map(tab => tab.attributes('tabindex'))).toEqual(['-1', '-1', '0']);
    await tabs[2].trigger('keydown', { key: 'Home' });
    expect(document.activeElement).toBe(tabs[0].element);
    await tabs[0].trigger('keydown', { key: 'End' });
    expect(document.activeElement).toBe(tabs[2].element);
    await tabs[2].trigger('keydown', { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[0].element);
    await tabs[1].trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([['groups'], ['companion'], ['groups'], ['companion'], ['tickets']]);
  });

  it('retains edited filter controls while closing them to interaction and restores trigger focus on Escape', async () => {
    const filters = reactive({ query: '', sort: 'compatibility', section: '', minCapacity: 0, spendBand: '', arrival: '', activity: '', vibe: '', preferredOnly: false });
    const wrapper = mount(GroupFilters, { attachTo: document.body, props: { filters } });
    const trigger = wrapper.get('button[aria-controls]');
    const panel = wrapper.get(`#${trigger.attributes('aria-controls')}`);
    expect(panel.attributes('inert')).toBe('');
    expect(panel.attributes('aria-hidden')).toBe('true');
    await trigger.trigger('click');
    expect(panel.attributes('inert')).toBeUndefined();
    await panel.findAll('select')[0].setValue('capacity');
    await panel.findAll('select')[1].setValue('minCapacity');
    const places = panel.get('input[type="number"]');
    await places.setValue(2);
    places.element.focus();
    await places.trigger('keydown', { key: 'Escape' });
    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(panel.attributes('inert')).toBe('');
    expect(document.activeElement).toBe(trigger.element);
    expect(panel.get('input[type="number"]').element).toBe(places.element);
    await trigger.trigger('click');
    expect(panel.get('input[type="number"]').element.value).toBe('2');
    expect(filters.sort).toBe('capacity');
    expect(filters.minCapacity).toBe(2);
  });

  it('closes the mobile menu with Escape without hiding desktop navigation after resize', async () => {
    const originalMatchMedia = window.matchMedia;
    let onChange;
    vi.spyOn(window, 'matchMedia').mockImplementation(query => query === '(max-width: 1100px)' ? {
      matches: true,
      addEventListener: (_event, listener) => { onChange = listener; },
      removeEventListener: vi.fn(),
    } : originalMatchMedia(query));
    const { wrapper } = await mountPage(SiteHeader, { path: '/concerts' });
    const menu = wrapper.get('nav[aria-label="Main navigation"]');
    const trigger = wrapper.get('button[aria-controls="main-navigation"]');
    expect(menu.attributes('inert')).toBe('');
    await trigger.trigger('click');
    expect(menu.attributes('inert')).toBeUndefined();
    const link = menu.get('a');
    link.element.focus();
    await link.trigger('keydown', { key: 'Escape' });
    expect(menu.attributes('inert')).toBe('');
    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger.element);
    onChange({ matches: false });
    await nextTick();
    expect(menu.attributes('inert')).toBeUndefined();
  });
});
