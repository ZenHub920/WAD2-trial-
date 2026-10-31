import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import ConnectionChannelView from '../src/views/ConnectionChannelView.vue';
import { api } from '../src/api.js';
import { button, mountPage } from './helpers.js';
vi.mock('../src/api.js', async original => ({ ...await original(), api: {
  connectionChannel: vi.fn(), readConnectionChannel: vi.fn(), sendConnectionChannelMessage: vi.fn(),
} }));
vi.mock('../src/auth.js', async () => {
  const { ref } = await import('vue');
  return { currentUser: ref({ id: 'user-1', name: 'Alex' }) };
});
vi.mock('../src/chatLive.js', async () => {
  const { ref } = await import('vue');
  return { connectionState: ref('live'), onChatEvent: vi.fn(() => () => {}), refreshUnread: vi.fn() };
});
const message = overrides => ({
  id: 'message-1', seq: 1, body: 'Meet at City Hall', sender: { id: 'user-2', displayName: 'Sam' },
  createdAt: '2026-10-30T12:00:00Z', mine: false, deleted: false, readBy: [], ...overrides,
});
const channel = messages => ({
  id: 'connection-1', name: 'Alpha + Beta', concert: { artist: 'Test artist' },
  partyA: { id: 'group-a', name: 'Alpha' }, partyB: { id: 'group-b', name: 'Beta' },
  members: [{ id: 'user-1', displayName: 'Alex', partyId: 'group-a' }, { id: 'user-2', displayName: 'Sam', partyId: 'group-b' }],
  messages, page: { nextCursor: null }, background: 'default',
});
beforeEach(() => { vi.resetAllMocks(); api.readConnectionChannel.mockResolvedValue({}); });
describe('connected groups shared chat', () => {
  it('shows both groups and members and opens their planner with a button', async () => {
    api.connectionChannel.mockResolvedValue({ channel: channel([]) });
    const { wrapper, router } = await mountPage(ConnectionChannelView, { props: { id: 'connection-1' } });
    expect(wrapper.text()).toContain('Current members of Alpha and Beta share this room.');
    await button(wrapper, 'Members').trigger('click');
    expect(wrapper.get('[aria-label="Shared chat members"]').text()).toContain('Alex');
    expect(wrapper.get('[aria-label="Shared chat members"]').text()).toContain('Sam');
    expect(api.readConnectionChannel).toHaveBeenCalledWith('connection-1');
    await button(wrapper, 'Plan meetup').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/meetups?connectionId=connection-1');
  });
  it('sends a reply to the selected message and displays the saved result', async () => {
    api.connectionChannel.mockResolvedValue({ channel: channel([message()]) });
    api.sendConnectionChannelMessage.mockResolvedValue({ message: message({
      id: 'message-2', seq: 2, body: 'See you there', mine: true,
      sender: { id: 'user-1', displayName: 'Alex' }, replyTo: { id: 'message-1', body: 'Meet at City Hall', deleted: false },
    }) });
    const { wrapper } = await mountPage(ConnectionChannelView, { props: { id: 'connection-1' } });
    await button(wrapper, 'Reply').trigger('click');
    expect(wrapper.text()).toContain('Replying to Sam');
    await wrapper.get('input[aria-label="Message both groups"]').setValue('See you there');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.sendConnectionChannelMessage).toHaveBeenCalledExactlyOnceWith('connection-1', 'See you there', 'message-1');
    expect(wrapper.text()).toContain('See you there');
    expect(wrapper.get('blockquote').text()).toBe('Meet at City Hall');
    expect(wrapper.get('input[aria-label="Message both groups"]').element.value).toBe('');
  });
  it('keeps an unsent draft after failure and hides deleted content', async () => {
    api.connectionChannel.mockResolvedValue({ channel: channel([message({ deleted: true, body: 'Old sensitive text' })]) });
    api.sendConnectionChannelMessage.mockRejectedValue(new Error('offline'));
    const { wrapper } = await mountPage(ConnectionChannelView, { props: { id: 'connection-1' } });
    expect(wrapper.text()).toContain('Message deleted');
    expect(wrapper.text()).not.toContain('Old sensitive text');
    expect(wrapper.findAll('button').some(item => item.text() === 'Reply')).toBe(false);
    await wrapper.get('input[aria-label="Message both groups"]').setValue('Keep my draft');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Your draft is unchanged');
    expect(wrapper.get('input[aria-label="Message both groups"]').element.value).toBe('Keep my draft');
    expect(button(wrapper, 'Send').element.disabled).toBe(false);
  });
});
