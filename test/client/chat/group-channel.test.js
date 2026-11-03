import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import GroupChannelView from '../../../client/src/views/GroupChannelView.vue';
import { api } from '../../../client/src/api.js';
import { currentUser } from '../../../client/src/auth.js';
import { onChatEvent, refreshUnread } from '../../../client/src/chatLive.js';
import { button, mountPage } from '../helpers.js';

vi.mock('../../../client/src/api.js', async original => ({ ...await original(), api: {
  groupChannel: vi.fn(), groupChannelCandidates: vi.fn(), sendGroupChannelMessage: vi.fn(),
  deleteGroupChannelMessage: vi.fn(), addToGroupChannel: vi.fn(), leaveGroupChannel: vi.fn(),
} }));
vi.mock('../../../client/src/auth.js', async () => ({ currentUser: (await import('vue')).ref({ id: 'host' }) }));
vi.mock('../../../client/src/chatLive.js', async () => ({
  connectionState: (await import('vue')).ref('live'), onChatEvent: vi.fn(() => () => {}), refreshUnread: vi.fn(),
}));
vi.mock('../../../client/src/components/MeetupEntryCard.vue', () => ({ default: { template: '<div />' } }));

const member = { id: 'host', displayName: 'Host', isHost: true };
const message = overrides => ({ id: 'm1', seq: 1, body: 'Saved message', mine: true, deleted: false,
  sender: member, createdAt: '2030-01-01T10:00:00Z', ...overrides });
const channel = (messages = [], id = 'group-1') => ({ partyId: id, isHost: true,
  concert: { artist: id, venue: 'Hall' }, members: [member], messages, page: { nextCursor: null } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const event = (type, data = {}) => onChatEvent.mock.calls.at(-1)[0](type, data);
const failed = status => Object.assign(new Error('read_failed'), { status });

beforeEach(() => {
  vi.resetAllMocks();
  currentUser.value = { id: 'host' };
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  onChatEvent.mockReturnValue(vi.fn());
  api.groupChannel.mockImplementation(async id => ({ channel: channel([], id) }));
  api.groupChannelCandidates.mockResolvedValue({ candidates: [] });
});

describe('group channel recovery and realtime scope', () => {
  it('shows confirmed send separately from a failed refresh and retries only the read', async () => {
    const { wrapper } = await mountPage(GroupChannelView, { props: { id: 'group-1' } });
    api.sendGroupChannelMessage.mockResolvedValue({ message: message() });
    api.groupChannel.mockRejectedValue(failed(503));
    await wrapper.get('input[aria-label="Message the group"]').setValue('Saved message');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toContain('Your message was sent.');
    expect(wrapper.text()).toContain('Saved message');
    expect(wrapper.text()).not.toContain('Could not send');
    expect(wrapper.get('input[aria-label="Message the group"]').element.value).toBe('');
    api.groupChannel.mockResolvedValue({ channel: channel([message()]) });
    await button(wrapper, 'Refresh channel').trigger('click'); await flushPromises();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(api.sendGroupChannelMessage).toHaveBeenCalledTimes(1);
  });

  it('retains an unsent draft on rejection and prevents repeated submission while pending', async () => {
    const { wrapper } = await mountPage(GroupChannelView, { props: { id: 'group-1' } });
    const pending = deferred(); api.sendGroupChannelMessage.mockReturnValue(pending.promise);
    await wrapper.get('input').setValue('Keep this draft');
    await wrapper.get('form').trigger('submit'); await wrapper.get('form').trigger('submit');
    expect(api.sendGroupChannelMessage).toHaveBeenCalledTimes(1);
    pending.resolve(Promise.reject(failed(503))); await flushPromises();
    expect(wrapper.get('input').element.value).toBe('Keep this draft');
    expect(wrapper.get('[role="alert"]').text()).toContain('Your draft is unchanged');
    expect(button(wrapper, 'Send').element.disabled).toBe(false);
  });

  it('keeps a confirmed tombstone when the subsequent channel read fails', async () => {
    api.groupChannel.mockResolvedValue({ channel: channel([message()]) });
    const { wrapper } = await mountPage(GroupChannelView, { props: { id: 'group-1' } });
    api.deleteGroupChannelMessage.mockResolvedValue({ deleted: true }); api.groupChannel.mockRejectedValue(failed(503));
    await button(wrapper, 'Delete').trigger('click'); await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toContain('Your message was deleted.');
    expect(wrapper.text()).toContain('Message deleted');
    expect(wrapper.text()).not.toContain('Saved message');
    expect(api.deleteGroupChannelMessage).toHaveBeenCalledExactlyOnceWith('group-1', 'm1');
  });

  it('distinguishes a failed optional candidate read from an empty candidate list', async () => {
    api.groupChannelCandidates.mockRejectedValue(failed(503));
    const { wrapper } = await mountPage(GroupChannelView, { props: { id: 'group-1' } });
    await button(wrapper, 'Members').trigger('click');
    expect(wrapper.text()).toContain('Could not check who can be added');
    expect(wrapper.text()).not.toContain('Everyone the group has accepted is already here');
    api.groupChannelCandidates.mockResolvedValue({ candidates: [] });
    await button(wrapper, 'Retry member check').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Everyone the group has accepted is already here');
  });

  it('does not undo a confirmed member addition when refreshing candidates fails', async () => {
    const person = { id: 'friend', displayName: 'Friend' };
    api.groupChannelCandidates.mockResolvedValue({ candidates: [person] });
    const { wrapper } = await mountPage(GroupChannelView, { props: { id: 'group-1' } });
    await button(wrapper, 'Members').trigger('click');
    api.addToGroupChannel.mockResolvedValue({ added: 'friend', members: [member, person] });
    api.groupChannel.mockResolvedValue({ channel: { ...channel(), members: [member, person] } });
    api.groupChannelCandidates.mockRejectedValue(failed(503));
    await button(wrapper, 'Add').trigger('click'); await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toContain('Friend was added.');
    expect(wrapper.text()).not.toContain('Could not add Friend.');
    expect(api.addToGroupChannel).toHaveBeenCalledExactlyOnceWith('group-1', 'friend');
  });

  it('ignores an old room response when the router reuses the component', async () => {
    const old = deferred(); api.groupChannel.mockReturnValueOnce(old.promise);
    const { wrapper } = await mountPage(GroupChannelView, { props: { id: 'group-1' } });
    await wrapper.setProps({ id: 'group-2' }); await flushPromises();
    expect(wrapper.text()).toContain('group-2 group');
    old.resolve({ channel: channel([message({ body: 'Private old room' })]) }); await flushPromises();
    expect(wrapper.text()).toContain('group-2 group');
    expect(wrapper.text()).not.toContain('Private old room');
  });

  it('clears the prior account and rejects its late read and send results', async () => {
    const { wrapper } = await mountPage(GroupChannelView, { props: { id: 'group-1' } });
    const pending = deferred(); api.sendGroupChannelMessage.mockReturnValue(pending.promise);
    await wrapper.get('input').setValue('Old account draft'); await wrapper.get('form').trigger('submit');
    api.groupChannel.mockRejectedValue(failed(404));
    currentUser.value = { id: 'different' }; await nextTick(); await flushPromises();
    pending.resolve({ message: message({ body: 'Old account private result' }) }); await flushPromises();
    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Old account private result');
    expect(wrapper.text()).toContain('This channel is not open to you');
  });

  it('clears revoked membership on a group invalidation and does not refetch on own read events', async () => {
    const { wrapper } = await mountPage(GroupChannelView, { props: { id: 'group-1' } });
    api.groupChannel.mockClear();
    await event('group-read', { partyId: 'group-1', readerId: 'host' });
    expect(api.groupChannel).not.toHaveBeenCalled();
    api.groupChannel.mockRejectedValue(failed(404));
    await event('group-members', { partyId: 'group-1' }); await flushPromises();
    expect(wrapper.find('form').exists()).toBe(false);
    expect(wrapper.find('.stream').exists()).toBe(false);
    expect(wrapper.text()).toContain('This channel is not open to you');
  });

  it('resynchronizes missed messages on ready and deduplicates repeated invalidations', async () => {
    const { wrapper } = await mountPage(GroupChannelView, { props: { id: 'group-1' } });
    api.groupChannel.mockImplementation(async () => ({ channel: channel([message()]) }));
    await event('ready'); await flushPromises();
    await event('group-message', { partyId: 'group-1', messageId: 'm1' }); await flushPromises();
    expect(wrapper.findAll('.msg')).toHaveLength(1);
    expect(wrapper.text()).toContain('Saved message');
    expect(refreshUnread).toHaveBeenCalled();
  });

  it('keeps a quiet refresh failure local and recovers on visibility without clearing a draft', async () => {
    const { wrapper } = await mountPage(GroupChannelView, { props: { id: 'group-1' } });
    await wrapper.get('input').setValue('Still typing');
    api.groupChannel.mockRejectedValue(failed(503));
    await event('ready'); await flushPromises();
    expect(wrapper.find('form').exists()).toBe(true);
    expect(wrapper.get('input').element.value).toBe('Still typing');
    api.groupChannel.mockResolvedValue({ channel: channel([message()]) });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    api.groupChannel.mockClear(); await event('ready'); await flushPromises();
    expect(api.groupChannel).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange')); await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.get('input').element.value).toBe('Still typing');
    expect(wrapper.text()).toContain('Saved message');
  });

  it('unsubscribes on unmount and suppresses late completion side effects', async () => {
    const pending = deferred(); api.groupChannel.mockReturnValueOnce(pending.promise);
    const { wrapper } = await mountPage(GroupChannelView, { props: { id: 'group-1' } });
    const unsubscribe = onChatEvent.mock.results[0].value;
    wrapper.unmount();
    pending.resolve({ channel: channel([message()]) }); await flushPromises();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(api.groupChannelCandidates).not.toHaveBeenCalled();
    expect(refreshUnread).not.toHaveBeenCalled();
  });
});
