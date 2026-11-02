import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import KakiChatView from '../src/views/KakiChatView.vue';
import GroupChannelView from '../src/views/GroupChannelView.vue';
import ConnectionChannelView from '../src/views/ConnectionChannelView.vue';
import { api } from '../src/api.js';
import { button, mountPage } from './helpers.js';

vi.mock('../src/api.js', async original => ({ ...await original(), api: {
  kakiConversation: vi.fn(), kakiChatBackgrounds: vi.fn(), markKakiRead: vi.fn(),
  groupChannel: vi.fn(), groupChannelCandidates: vi.fn(),
  connectionChannel: vi.fn(), readConnectionChannel: vi.fn(), createMeetup: vi.fn(),
} }));
vi.mock('../src/auth.js', async () => {
  const { ref } = await import('vue');
  return { currentUser: ref({ id: 'viewer', displayName: 'Ari' }) };
});
vi.mock('../src/chatLive.js', async () => {
  const { ref } = await import('vue');
  return { connectionState: ref('live'), onChatEvent: vi.fn(() => () => {}), refreshUnread: vi.fn() };
});

beforeEach(() => {
  vi.resetAllMocks();
  api.kakiConversation.mockResolvedValue({ conversation: { id: 'pair-1', me: 'viewer', other: { id: 'friend', displayName: 'Sam' }, concert: { artist: 'Test artist' }, background: 'default' }, messages: [], page: { nextCursor: null } });
  api.kakiChatBackgrounds.mockResolvedValue({ backgrounds: ['default'] });
  api.markKakiRead.mockResolvedValue({});
  api.groupChannel.mockResolvedValue({ channel: { id: 'group-1', isHost: false, concert: { artist: 'Test artist', venue: 'Stadium' }, members: [{ id: 'viewer', displayName: 'Ari' }], messages: [], page: { nextCursor: null } } });
  api.groupChannelCandidates.mockResolvedValue({ candidates: [] });
  api.connectionChannel.mockResolvedValue({ channel: { id: 'connection-1', name: 'Alpha + Beta', concert: { artist: 'Test artist' }, partyA: { id: 'a', name: 'Alpha' }, partyB: { id: 'b', name: 'Beta' }, members: [{ id: 'viewer', displayName: 'Ari', partyId: 'a' }], messages: [], page: { nextCursor: null }, background: 'default' } });
  api.readConnectionChannel.mockResolvedValue({});
});

const rooms = [
  { name: 'pair', view: KakiChatView, id: 'pair-1', key: 'kakiConversationId', label: 'Meetup planner for this pair', text: 'Meet up, just the two of you', method: 'kakiConversation', denied: 403 },
  { name: 'group', view: GroupChannelView, id: 'group-1', key: 'partyId', label: 'Meetup planner for this group', text: 'Bring the group together', method: 'groupChannel', denied: 404 },
  { name: 'connected groups', view: ConnectionChannelView, id: 'connection-1', key: 'connectionId', label: 'Meetup planner for both connected groups', text: 'One meetup for both groups', method: 'connectionChannel', denied: 404 },
];

describe('planner entry in its chat context', () => {
  it.each(rooms)('opens the $name planner from one visible utility button with the correct scope', async ({ view, id, key, label, text }) => {
    const { wrapper, router } = await mountPage(view, { props: { id } });
    const entry = wrapper.get(`[aria-label="${label}"]`);
    expect(entry.text()).toContain(text);
    expect(entry.find('button').text()).toBe('Plan meetup');
    expect(wrapper.findAll('button').filter(control => control.text() === 'Plan meetup')).toHaveLength(1);
    expect(wrapper.find('[aria-label="Chat options"]').exists()).toBe(false);
    await button(wrapper, 'Plan meetup').trigger('click'); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/meetups');
    expect(router.currentRoute.value.query).toEqual({ [key]: id });
    expect(api.createMeetup).not.toHaveBeenCalled();
  });

  it.each(rooms)('hides the $name planning entry when the server denies room access', async ({ view, id, method, denied, label }) => {
    api[method].mockRejectedValue(Object.assign(new Error('unavailable'), { status: denied }));
    const { wrapper } = await mountPage(view, { props: { id } });
    expect(wrapper.find(`[aria-label="${label}"]`).exists()).toBe(false);
    expect(wrapper.findAll('button').some(control => control.text() === 'Plan meetup')).toBe(false);
  });
});
