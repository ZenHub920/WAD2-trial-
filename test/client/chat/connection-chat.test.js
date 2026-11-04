import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import ConnectionChannelView from '../../../client/src/views/ConnectionChannelView.vue';
import { api } from '../../../client/src/api.js';
import { invalidateMeetupSummaries } from '../../../client/src/composables/useMeetupSummaries.js';
import { button, mountPage } from '../helpers.js';
vi.mock('../../../client/src/api.js', async original => ({ ...await original(), api: {
  connectionChannel: vi.fn(), readConnectionChannel: vi.fn(), sendConnectionChannelMessage: vi.fn(),
  meetups: vi.fn(), meetupContext: vi.fn(),
} }));
vi.mock('../../../client/src/auth.js', async () => {
  const { ref } = await import('vue');
  return { currentUser: ref({ id: 'user-1', name: 'Alex' }) };
});
vi.mock('../../../client/src/chatLive.js', async () => {
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
beforeEach(() => {
  vi.resetAllMocks(); invalidateMeetupSummaries(); api.readConnectionChannel.mockResolvedValue({});
  api.meetups.mockResolvedValue({ meetups: [{ id: 'shared-plan', title: 'Shared group meetup', status: 'planning',
    scope: { connectionId: 'connection-1' }, isHistorical: false, hasAvailability: false,
    participantCount: 2, availabilityParticipantCount: 1, capabilities: { canApprove: false } }] });
});
describe('connected groups shared chat', () => {
  it('uses a privacy-safe unavailable state and recovery links for revoked coordination', async () => {
    api.connectionChannel.mockRejectedValue(Object.assign(new Error('connection_channel_not_found'), { status: 404 }));
    const { wrapper } = await mountPage(ConnectionChannelView, { props: { id: 'old-connection' } });
    expect(wrapper.text()).toContain('Shared coordination is currently unavailable.');
    expect(wrapper.text()).toContain('The current participation or safety settings prevent access.');
    expect(wrapper.find('a[href="/groups/connect"]').exists()).toBe(true);
    expect(wrapper.find('a[href="/messages"]').exists()).toBe(true);
    expect(wrapper.find('input[aria-label="Message both groups"]').exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/blocked|blocker|blocked_pair/);
  });

  it('shows both groups and members and opens their existing scoped plan', async () => {
    api.connectionChannel.mockResolvedValue({ channel: channel([]) });
    const { wrapper, router } = await mountPage(ConnectionChannelView, { props: { id: 'connection-1' } });
    expect(wrapper.text()).toContain('Current members of Alpha and Beta share this room.');
    expect(wrapper.text()).toContain('Your groups remain separate.');
    expect(wrapper.text()).toContain('Both group hosts must approve a shared meetup plan');
    await button(wrapper, 'Members').trigger('click');
    expect(wrapper.get('[aria-label="Shared chat members"]').text()).toContain('Alex');
    expect(wrapper.get('[aria-label="Shared chat members"]').text()).toContain('Sam');
    expect(api.readConnectionChannel).toHaveBeenCalledWith('connection-1');
    const action = wrapper.get('[aria-label="Meetup planner for both connected groups"] a.btn');
    expect(action.text()).toBe('Share availability');
    expect(action.attributes('href')).toBe('/meetups/shared-plan?from=conversation#meetup-availability');
    expect(api.meetupContext).not.toHaveBeenCalled();
    await action.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/meetups/shared-plan?from=conversation#meetup-availability');
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
