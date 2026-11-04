/**
 * The Messages page shows companion, ticket and group chats in one list,
 * newest first, each tagged with its kind. API calls are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import KakiChatListView from '../../client/src/views/KakiChatListView.vue';
import { api } from '../../client/src/api.js';
import { mountPage } from './helpers.js';

vi.mock('../../client/src/chatLive.js', () => ({ onChatEvent: () => () => {}, refreshUnread: vi.fn() }));
vi.mock('../../client/src/auth.js', async () => {
  const { ref } = await import('vue');
  return { currentUser: ref({ id: 'me' }), sessionReady: ref(true) };
});
vi.mock('../../client/src/api.js', async (original) => ({ ...await original(), api: {
  kakiConversations: vi.fn(), kakiMatches: vi.fn(), conversations: vi.fn(),
  groupChannels: vi.fn(), connectionChannels: vi.fn(), blockedUsers: vi.fn(),
} }));

const companion = {
  id: 'k1', other: { id: 'u2', displayName: 'Sam', avatarUrl: null }, concert: { id: 'c1', artist: 'LANY' },
  unread: 2, createdAt: '2030-01-01T08:00:00Z', lastMessage: { body: 'See you there!', createdAt: '2030-01-03T10:00:00Z' },
};
const ticket = {
  id: 't1', other: { id: 'u3', displayName: 'Lee', avatarUrl: null }, role: 'buyer',
  listing: { title: 'Cat 1', priceCents: 12000 }, createdAt: '2030-01-01T08:00:00Z',
  lastMessage: { body: 'Is it still available?', createdAt: '2030-01-02T10:00:00Z' },
};
const channel = {
  partyId: 'p1', name: 'Supper crew', concert: { artist: 'LANY' }, memberCount: 3, unread: 0,
  lastMessage: { body: 'Dinner at 6?', createdAt: '2030-01-04 10:00:00' },
};

beforeEach(() => {
  vi.resetAllMocks();
  api.kakiConversations.mockResolvedValue({ conversations: [companion] });
  api.kakiMatches.mockResolvedValue({ matches: [] });
  api.conversations.mockResolvedValue({ conversations: [ticket] });
  api.groupChannels.mockResolvedValue({ channels: [channel] });
  api.connectionChannels.mockResolvedValue({ channels: [] });
  api.blockedUsers.mockResolvedValue({ blocked: [] });
});

describe('Messages inbox', () => {
  it('lists every kind of chat together, newest first, with its kind and link', async () => {
    const { wrapper } = await mountPage(KakiChatListView, { path: '/messages' });
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false);
    const rows = wrapper.findAll('.threads .thread');
    expect(rows.map((row) => row.get('.thread__name').text())).toEqual(['Supper crew', 'Sam', 'Lee']);
    expect(rows.map((row) => row.get('.thread__kind').text())).toEqual(['Group', 'Companion', 'Ticket']);
    expect(rows[0].attributes('href')).toBe('/groups/p1/channel');
    expect(rows[1].attributes('href')).toBe('/kaki/chat/k1');
    expect(rows[1].classes()).toContain('thread--unread');
  });

  it('still shows the chats that loaded when one source fails', async () => {
    api.conversations.mockRejectedValue(Object.assign(new Error('offline'), { status: 500 }));
    const { wrapper } = await mountPage(KakiChatListView, { path: '/messages' });
    expect(wrapper.text()).toContain('Could not load ticket messages.');
    expect(wrapper.findAll('.threads .thread')).toHaveLength(2);
  });
});
