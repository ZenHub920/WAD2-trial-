import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import ProfileNotifications from '../../../client/src/components/ProfileNotifications.vue';
import NotificationBell from '../../../client/src/components/NotificationBell.vue';
import { api } from '../../../client/src/api.js';
import { currentUser } from '../../../client/src/auth.js';
import { browserPushStatus, enableBrowserPush } from '../../../client/src/browserPush.js';
import { button, field, mountPage } from '../helpers.js';
vi.mock('../../../client/src/api.js', async original => ({ ...await original(), api: {
  notificationSettings: vi.fn(), saveNotificationSettings: vi.fn(), notifications: vi.fn(), unreadNotifications: vi.fn(), readNotification: vi.fn(),
} }));
vi.mock('../../../client/src/browserPush.js', () => ({ browserPushStatus: vi.fn(), enableBrowserPush: vi.fn(), disableBrowserPush: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  currentUser.value = { id: 'notification-user' };
  api.notificationSettings.mockResolvedValue({ preferences: { chat: true, group: true, match: true, meetup: true, feedback: true } });
  api.saveNotificationSettings.mockResolvedValue({});
  browserPushStatus.mockResolvedValue({ supported: true, configured: true, enabled: false });
});
describe('notification settings and inbox', () => {
  it('preserves request, proposal, invitation and meetup context when following notifications', async () => {
    const paths = [
      '/groups/connect?groupId=group-a&requestId=request-a#join-requests',
      '/groups?concertId=concert-a&mode=algorithm&proposalId=proposal-a#automatic-offers',
      '/groups/connect?view=connections&groupId=group-b&connectionId=invitation-a#group-connections',
      '/meetups/plan-a#meetup-review',
    ];
    api.unreadNotifications.mockResolvedValue({ unread: 0 });
    api.readNotification.mockResolvedValue({});
    api.notifications.mockResolvedValue({ notifications: paths.map((path, index) => ({
      id: `context-${index}`, title: `Context update ${index}`, path, createdAt: '2026-10-30T12:00:00Z', readAt: null,
    })) });
    const { wrapper, router } = await mountPage(NotificationBell);
    for (const [index, path] of paths.entries()) {
      await wrapper.get('.notification-bell__button').trigger('click'); await flushPromises();
      await wrapper.findAll('a').find(link => link.text() === `Context update ${index}`).trigger('click'); await flushPromises();
      expect(router.currentRoute.value.fullPath).toBe(path);
    }
  });

  it('saves a category as soon as it is unticked, without asking for push permission on mount', async () => {
    const { wrapper } = await mountPage(ProfileNotifications);
    expect(enableBrowserPush).not.toHaveBeenCalled();
    expect(wrapper.findAll('button').some((b) => b.text() === 'Save notification preferences')).toBe(false);
    await field(wrapper, 'Companion and ticket messages').setValue(false);
    await flushPromises();
    expect(api.saveNotificationSettings).toHaveBeenCalledWith({ chat: false, group: true, match: true, meetup: true, feedback: true });
    expect(wrapper.get('[role="status"]').text()).toContain('Saved');
  });
  it('requests push only after a click and explains denied permission', async () => {
    enableBrowserPush.mockRejectedValue(new Error('push_permission_denied'));
    const { wrapper } = await mountPage(ProfileNotifications);
    await button(wrapper, 'Enable browser notifications').trigger('click');
    await flushPromises();
    expect(enableBrowserPush).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Notifications are blocked. Allow them in your browser settings');
  });
  it('marks a group notification read, updates its badge and follows its link', async () => {
    const item = { id: 'notification-1', category: 'group', title: 'Your groups are connected', path: '/groups/connections/connection-1/channel', createdAt: '2026-10-30T12:00:00Z', readAt: null };
    let read = false;
    api.unreadNotifications.mockImplementation(async () => ({ unread: read ? 0 : 1 }));
    api.notifications.mockImplementation(async () => ({ notifications: [{ ...item, readAt: read ? '2026-10-30T12:01:00Z' : null }] }));
    api.readNotification.mockImplementation(async () => { read = true; });
    const { wrapper, router } = await mountPage(NotificationBell);
    await wrapper.get('button[aria-label="Notifications, 1 unread"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain(item.title);
    expect(wrapper.text()).toContain('Unread');
    await button(wrapper, 'Mark read').trigger('click');
    await flushPromises();
    expect(api.readNotification).toHaveBeenCalledExactlyOnceWith(item.id);
    expect(wrapper.get('button[aria-label="Notifications"]').attributes('aria-expanded')).toBe('true');
    expect(wrapper.text()).not.toContain('Mark read');
    await wrapper.findAll('a').find(a => a.text() === item.title).trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(item.path);
    expect(wrapper.find('#notification-popover').exists()).toBe(false);
  });
});
