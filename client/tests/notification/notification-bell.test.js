import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import NotificationBell from '../../src/components/NotificationBell.vue';
import { api } from '../../src/api.js';
import { mountPage } from '../helpers.js';
vi.mock('../../src/api.js', async original => ({ ...await original(), api: {
  notifications: vi.fn(), unreadNotifications: vi.fn(), readNotification: vi.fn(),
} }));

beforeEach(() => {
  vi.resetAllMocks();
  api.notifications.mockResolvedValue({ notifications: [] });
});
const badge = wrapper => wrapper.find('.notification-bell__badge');

describe('notification bell', () => {
  it('shows the unread count on mount and caps it at 99+', async () => {
    api.unreadNotifications.mockResolvedValue({ unread: 150 });
    const { wrapper } = await mountPage(NotificationBell);
    expect(badge(wrapper).text()).toBe('99+');
    expect(wrapper.get('.notification-bell__button').attributes('aria-label')).toBe('Notifications, 150 unread');
  });

  it('shows no badge when everything is read', async () => {
    api.unreadNotifications.mockResolvedValue({ unread: 0 });
    const { wrapper } = await mountPage(NotificationBell);
    expect(badge(wrapper).exists()).toBe(false);
  });

  it('polls the unread count every 30 seconds', async () => {
    vi.useFakeTimers();
    let unread = 0;
    api.unreadNotifications.mockImplementation(async () => ({ unread }));
    const { wrapper } = await mountPage(NotificationBell);
    expect(badge(wrapper).exists()).toBe(false);
    unread = 3;
    await vi.advanceTimersByTimeAsync(30000);
    await flushPromises();
    expect(badge(wrapper).text()).toBe('3');
  });

  it('shows an empty state and an error state in the popover', async () => {
    api.unreadNotifications.mockResolvedValue({ unread: 0 });
    const { wrapper } = await mountPage(NotificationBell);
    await wrapper.get('.notification-bell__button').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('No notifications yet.');

    api.notifications.mockRejectedValue(new Error('offline'));
    await wrapper.findAll('button').find(b => b.text().includes('Refresh')).trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not load notifications');
  });

  it('sends chat notifications that point at the generic inbox to /messages', async () => {
    api.unreadNotifications.mockResolvedValue({ unread: 1 });
    api.notifications.mockResolvedValue({ notifications: [
      { id: 'n1', category: 'chat', title: 'Message from Sam', path: '/kaki/chat', createdAt: '2026-10-30T12:00:00Z', readAt: null },
    ] });
    const { wrapper, router } = await mountPage(NotificationBell);
    await wrapper.get('.notification-bell__button').trigger('click');
    await flushPromises();
    await wrapper.findAll('a').find(a => a.text() === 'Message from Sam').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/messages');
  });

  it('closes on Escape', async () => {
    api.unreadNotifications.mockResolvedValue({ unread: 0 });
    const { wrapper } = await mountPage(NotificationBell);
    await wrapper.get('.notification-bell__button').trigger('click');
    await flushPromises();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(wrapper.find('#notification-popover').exists()).toBe(false);
  });
});
