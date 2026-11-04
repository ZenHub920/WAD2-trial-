import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import NotificationBell from '../../../client/src/components/NotificationBell.vue';
import { api, notificationRevision } from '../../../client/src/api.js';
import { currentUser } from '../../../client/src/auth.js';
import { mountPage } from '../helpers.js';
vi.mock('../../../client/src/api.js', async original => ({ ...await original(), api: {
  notifications: vi.fn(), unreadNotifications: vi.fn(), readNotification: vi.fn(),
} }));

beforeEach(() => {
  vi.resetAllMocks();
  currentUser.value = { id: 'user-a' };
  api.notifications.mockResolvedValue({ notifications: [] });
  api.readNotification.mockResolvedValue({});
});
const badge = wrapper => wrapper.find('.notification-bell__badge');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const item = (id, title, path = '/messages') => ({ id, title, path, readAt: null, createdAt: '2026-10-30T12:00:00Z' });

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

  it('keeps a usable inbox when the independent unread-count request fails', async () => {
    api.unreadNotifications.mockResolvedValueOnce({ unread: 0 }).mockRejectedValue(new Error('count offline'));
    api.notifications.mockResolvedValue({ notifications: [item('n1', 'Saved meetup update')] });
    const { wrapper } = await mountPage(NotificationBell);
    await wrapper.get('.notification-bell__button').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Saved meetup update');
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not refresh the unread count');
    expect(wrapper.text()).not.toContain('Could not load notifications');
  });

  it('keeps a valid count and the previous inbox when refreshing the list fails', async () => {
    api.unreadNotifications.mockResolvedValue({ unread: 1 });
    api.notifications.mockResolvedValue({ notifications: [item('n1', 'Preserved update')] });
    const { wrapper } = await mountPage(NotificationBell);
    await wrapper.get('.notification-bell__button').trigger('click'); await flushPromises();
    api.notifications.mockRejectedValue(new Error('list offline'));
    api.unreadNotifications.mockResolvedValue({ unread: 2 });
    await wrapper.findAll('button').find(b => b.text().includes('Refresh')).trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Preserved update'); expect(badge(wrapper).text()).toBe('2');
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not load notifications');
  });

  it('discards an old account inbox even if it arrives after the new account has loaded', async () => {
    const old = deferred();
    api.unreadNotifications.mockResolvedValue({ unread: 0 });
    api.notifications.mockReturnValueOnce(old.promise).mockResolvedValue({ notifications: [item('new', 'New account update')] });
    const { wrapper } = await mountPage(NotificationBell);
    await wrapper.get('.notification-bell__button').trigger('click'); await flushPromises();
    currentUser.value = { id: 'user-b' }; await flushPromises();
    expect(wrapper.find('#notification-popover').exists()).toBe(false);
    await wrapper.get('.notification-bell__button').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('New account update');
    old.resolve({ notifications: [item('old', 'Private old account update')] }); await flushPromises();
    expect(wrapper.text()).toContain('New account update'); expect(wrapper.text()).not.toContain('Private old account update');
  });

  it('discards an old account count and does not revive it after sign out', async () => {
    const old = deferred();
    api.unreadNotifications.mockReturnValueOnce(old.promise).mockResolvedValue({ unread: 2 });
    const { wrapper } = await mountPage(NotificationBell);
    currentUser.value = { id: 'user-b' }; await flushPromises();
    expect(badge(wrapper).text()).toBe('2');
    currentUser.value = null; await flushPromises();
    const calls = api.unreadNotifications.mock.calls.length;
    old.resolve({ unread: 99 }); await flushPromises();
    expect(badge(wrapper).exists()).toBe(false); expect(api.unreadNotifications).toHaveBeenCalledTimes(calls);
    expect(api.readNotification).not.toHaveBeenCalled();
  });

  it('never resolves an old-account notification under a new account', async () => {
    const old = deferred();
    api.unreadNotifications.mockResolvedValueOnce({ unread: 1 }).mockResolvedValue({ unread: 0 });
    api.notifications.mockReturnValueOnce(old.promise);
    const { wrapper } = await mountPage(NotificationBell);
    currentUser.value = { id: 'user-b' }; await flushPromises();
    old.resolve({ notifications: [item('private-old', 'Old page update', '/')] }); await flushPromises();
    expect(api.readNotification).not.toHaveBeenCalled(); expect(badge(wrapper).exists()).toBe(false);
  });

  it('an old mark-read completion cannot reload or unlock a new account operation', async () => {
    const oldRead = deferred(), newRead = deferred();
    api.unreadNotifications.mockResolvedValue({ unread: 0 });
    api.notifications.mockImplementation(async () => ({ notifications: [item(currentUser.value.id, `Update for ${currentUser.value.id}`)] }));
    api.readNotification.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise);
    const { wrapper } = await mountPage(NotificationBell);
    const openAndRead = async () => {
      await wrapper.get('.notification-bell__button').trigger('click'); await flushPromises();
      await wrapper.get('.notification-popover__read').trigger('click'); await flushPromises();
    };
    await openAndRead();
    currentUser.value = { id: 'user-b' }; await flushPromises(); await openAndRead();
    const inboxCalls = api.notifications.mock.calls.length;
    oldRead.reject(new Error('old account offline')); await flushPromises();
    expect(api.notifications).toHaveBeenCalledTimes(inboxCalls);
    expect(wrapper.get('.notification-popover__read').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    newRead.resolve({}); await flushPromises();
    expect(wrapper.get('.notification-popover__read').attributes('disabled')).toBeUndefined();
  });

  it('does not mark stale-route or unmounted notifications read after a deferred lookup', async () => {
    const old = deferred();
    api.unreadNotifications.mockResolvedValue({ unread: 1 }); api.notifications.mockReturnValue(old.promise);
    const { wrapper, router } = await mountPage(NotificationBell);
    await router.push('/profile'); await flushPromises();
    wrapper.unmount();
    old.resolve({ notifications: [item('old', 'Late lookup', '/profile')] }); await flushPromises();
    expect(api.readNotification).not.toHaveBeenCalled();
  });

  it('uses the latest count response when live invalidations overlap', async () => {
    const initial = deferred(), latest = deferred();
    api.unreadNotifications.mockReturnValueOnce(initial.promise).mockReturnValueOnce(latest.promise);
    const { wrapper } = await mountPage(NotificationBell);
    notificationRevision.value++; await flushPromises();
    latest.resolve({ unread: 2 }); await flushPromises();
    initial.resolve({ unread: 7 }); await flushPromises();
    expect(badge(wrapper).text()).toBe('2');
  });

  it('retains a confirmed read when its subsequent inbox refresh fails', async () => {
    api.unreadNotifications.mockResolvedValue({ unread: 1 });
    api.notifications.mockResolvedValue({ notifications: [item('n1', 'Already saved read')] });
    const { wrapper } = await mountPage(NotificationBell);
    await wrapper.get('.notification-bell__button').trigger('click'); await flushPromises();
    api.notifications.mockRejectedValue(new Error('refresh offline'));
    api.unreadNotifications.mockResolvedValue({ unread: 0 });
    await wrapper.get('.notification-popover__read').trigger('click'); await flushPromises();
    expect(api.readNotification).toHaveBeenCalledExactlyOnceWith('n1');
    expect(wrapper.find('.notification-popover__read').exists()).toBe(false);
    expect(wrapper.text()).toContain('Read'); expect(wrapper.text()).toContain('Could not load notifications');
    expect(wrapper.text()).not.toContain('Could not mark this notification as read');
  });
});
