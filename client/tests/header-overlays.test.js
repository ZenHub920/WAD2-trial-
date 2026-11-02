import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import SiteHeader from '../src/components/SiteHeader.vue';
import { api } from '../src/api.js';
import { mountPage } from './helpers.js';

vi.mock('../src/auth.js', async () => {
  const { ref } = await import('vue');
  return { currentUser: ref({ id: 'self', displayName: 'Concert fan' }) };
});

async function deferredHeader(path) {
  const history = createMemoryHistory();
  history.replace(path);
  let resolveView;
  const view = new Promise(resolve => { resolveView = resolve; });
  const router = createRouter({ history, routes: [
    { path, component: () => view },
    { path: '/next', component: { template: '<p>Next page</p>' } },
    { path: '/:pathMatch(.*)*', component: { template: '<p>Other page</p>' } },
  ] });
  const wrapper = mount(SiteHeader, { attachTo: document.body, global: { plugins: [router] } });
  await flushPromises();
  expect(router.currentRoute.value.matched).toHaveLength(0);
  return { wrapper, router, resolve: () => resolveView({ template: '<p>Loaded page</p>' }) };
}

describe('header overlays during initial lazy routing', () => {
  for (const path of ['/', '/loading']) for (const kind of ['notifications', 'menu']) {
    it(`keeps ${kind} open when ${path} initially resolves, then closes on real navigation`, async () => {
      const { wrapper, router, resolve } = await deferredHeader(path);
      const control = wrapper.get(`button[aria-controls="${kind === 'menu' ? 'main-navigation' : 'notification-popover'}"]`);
      await control.trigger('click'); await flushPromises();
      expect(control.attributes('aria-expanded')).toBe('true');
      resolve(); await router.isReady(); await flushPromises();
      expect(router.currentRoute.value.matched).toHaveLength(1);
      expect(control.attributes('aria-expanded')).toBe('true');
      for (const destination of [`${path}?view=test`, `${path}?view=test#details`, '/next']) {
        await router.push(destination); await flushPromises();
        expect(control.attributes('aria-expanded')).toBe('false');
        if (destination !== '/next') { await control.trigger('click'); await flushPromises(); }
      }
    });
  }

  for (const kind of ['notifications', 'menu']) {
    it(`dismisses an explicit ${kind} destination chosen before the first route resolves`, async () => {
      api.notifications.mockResolvedValue({ notifications: [{ id: 'message', title: 'A new message', path: '/next', createdAt: '2030-01-01T00:00:00Z' }] });
      const { wrapper, router, resolve } = await deferredHeader('/loading');
      const control = wrapper.get(`button[aria-controls="${kind === 'menu' ? 'main-navigation' : 'notification-popover'}"]`);
      await control.trigger('click'); await flushPromises();
      const destination = kind === 'menu' ? wrapper.get('nav a') : wrapper.get('#notification-popover li a');
      await destination.trigger('click'); await flushPromises();
      expect(control.attributes('aria-expanded')).toBe('false');
      resolve(); await router.isReady(); await flushPromises();
    });
  }
});
vi.mock('../src/chatLive.js', async () => {
  const { ref } = await import('vue');
  return { unreadTotal: ref(0) };
});
vi.mock('../src/api.js', async original => ({ ...await original(), api: {
  notifications: vi.fn(), unreadNotifications: vi.fn(), readNotification: vi.fn(),
} }));

beforeEach(() => {
  vi.resetAllMocks();
  api.notifications.mockResolvedValue({ notifications: [] });
  api.unreadNotifications.mockResolvedValue({ unread: 0 });
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  });
});

describe('header overlay ownership', () => {
  it('opens only one header panel at a time and returns notification focus on Escape', async () => {
    const { wrapper } = await mountPage(SiteHeader);
    const menu = wrapper.get('button[aria-controls="main-navigation"]');
    const bell = wrapper.get('button[aria-controls="notification-popover"]');
    await bell.trigger('click');
    await flushPromises();
    expect(wrapper.find('#notification-popover').exists()).toBe(true);
    await menu.trigger('click');
    await flushPromises();
    expect(menu.attributes('aria-expanded')).toBe('true');
    await vi.waitFor(() => expect(document.activeElement).toBe(wrapper.get('nav[aria-label="Main navigation"] a').element));
    expect(wrapper.find('#notification-popover').exists()).toBe(false);
    await bell.trigger('click');
    await flushPromises();
    expect(menu.attributes('aria-expanded')).toBe('false');
    const panel = wrapper.get('#notification-popover');
    expect(document.activeElement).toBe(panel.element);
    await panel.trigger('keydown', { key: 'Escape' });
    await flushPromises();
    expect(wrapper.find('#notification-popover').exists()).toBe(false);
    expect(document.activeElement).toBe(bell.element);
  });

  it('dismisses mobile navigation outside without stealing focus and restores its trigger on Escape', async () => {
    const { wrapper } = await mountPage(SiteHeader, { path: '/concerts' });
    const menu = wrapper.get('button[aria-controls="main-navigation"]');
    const outside = document.createElement('button');
    outside.textContent = 'Outside action';
    document.body.append(outside);
    await menu.trigger('click');
    outside.focus();
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await flushPromises();
    expect(menu.attributes('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(outside);
    await menu.trigger('click');
    const link = wrapper.get('nav[aria-label="Main navigation"] a');
    link.element.focus();
    await link.trigger('keydown', { key: 'Escape' });
    expect(menu.attributes('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(menu.element);
  });
});
