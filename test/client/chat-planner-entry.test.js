import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import KakiChatView from '../../client/src/views/KakiChatView.vue';
import GroupChannelView from '../../client/src/views/GroupChannelView.vue';
import { api } from '../../client/src/api.js';
import { currentUser } from '../../client/src/auth.js';
import { invalidateMeetupSummaries } from '../../client/src/composables/useMeetupSummaries.js';

async function mountPage(view, { props }) {
  // The signed-out companion room uses its real named sign-in destination.
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/login', name: 'login', component: { template: '<div />' } },
    { path: '/:pathMatch(.*)*', component: { template: '<div />' } },
  ] });
  await router.push('/'); await router.isReady();
  const wrapper = mount(view, { props, attachTo: document.body, global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

vi.mock('../../client/src/api.js', async original => ({ ...await original(), api: {
  kakiConversation: vi.fn(), kakiChatBackgrounds: vi.fn(), markKakiRead: vi.fn(),
  groupChannel: vi.fn(), groupChannelCandidates: vi.fn(),
  createMeetup: vi.fn(),
  meetups: vi.fn(), meetupContext: vi.fn(),
} }));
vi.mock('../../client/src/auth.js', async () => {
  const { ref } = await import('vue');
  return { currentUser: ref({ id: 'viewer', displayName: 'Ari' }) };
});
vi.mock('../../client/src/chatLive.js', async () => {
  const { ref } = await import('vue');
  return { connectionState: ref('live'), onChatEvent: vi.fn(() => () => {}), refreshUnread: vi.fn() };
});

beforeEach(() => {
  vi.resetAllMocks();
  currentUser.value = { id: 'viewer', displayName: 'Ari' };
  invalidateMeetupSummaries();
  api.meetups.mockResolvedValue({ meetups: [] });
  api.meetupContext.mockResolvedValue({ context: { capabilities: { canCreate: true }, meetups: [] } });
  api.kakiConversation.mockResolvedValue({ conversation: { id: 'pair-1', me: 'viewer', other: { id: 'friend', displayName: 'Sam' }, concert: { artist: 'Test artist' }, background: 'default' }, messages: [], page: { nextCursor: null } });
  api.kakiChatBackgrounds.mockResolvedValue({ backgrounds: ['default'] });
  api.markKakiRead.mockResolvedValue({});
  api.groupChannel.mockResolvedValue({ channel: { id: 'group-1', isHost: true, concert: { artist: 'Test artist', venue: 'Stadium' }, members: [{ id: 'viewer', displayName: 'Ari' }], messages: [], page: { nextCursor: null } } });
  api.groupChannelCandidates.mockResolvedValue({ candidates: [] });
});

const rooms = [
  { name: 'pair', view: KakiChatView, id: 'pair-1', key: 'kakiConversationId', label: 'Meetup planner for this pair', text: 'Meet up, just the two of you', method: 'kakiConversation', denied: 403 },
  { name: 'group', view: GroupChannelView, id: 'group-1', key: 'partyId', label: 'Meetup planner for this group', text: 'Bring the group together', method: 'groupChannel', denied: 404 },
];

describe('planner entry in its chat context', () => {
  it.each(rooms.filter(room => room.name === 'group'))('opens authorized $name creation from its scoped status card', async ({ view, id, key, label }) => {
    const { wrapper, router } = await mountPage(view, { props: { id } });
    const entry = wrapper.get(`[aria-label="${label}"]`);
    expect(entry.text()).toContain('No meetup yet');
    const action = entry.get('a.btn');
    expect(action.text()).toBe('Create meetup plan');
    expect(action.attributes('href')).toBe(`/meetups?${key}=${id}`);
    expect(api.meetups).toHaveBeenCalledTimes(1);
    expect(api.meetupContext).toHaveBeenCalledExactlyOnceWith({ [key]: id });
    expect(wrapper.find('[aria-label="Chat options"]').exists()).toBe(false);
    await action.trigger('click'); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/meetups');
    expect(router.currentRoute.value.query).toEqual({ [key]: id });
    expect(api.createMeetup).not.toHaveBeenCalled();
  });

  it.each(rooms.filter(room => room.name === 'group'))('opens the persisted $name plan directly instead of offering another creation', async ({ view, id, key, label }) => {
    api.meetups.mockResolvedValue({ meetups: [{ id: 'confirmed-plan', title: 'Our saved plan', scope: { [key]: id }, status: 'confirmed',
      isHistorical: false, participantCount: 2, selectedStart: Date.parse('2030-01-01T08:00:00Z'),
      selectedPlace: { id: 'place', label: 'Stadium MRT Exit A' }, capabilities: { canApprove: false } }] });
    const { wrapper, router } = await mountPage(view, { props: { id } });
    const entry = wrapper.get(`[aria-label="${label}"]`);
    expect(entry.text()).toContain('Confirmed');
    expect(entry.text()).toContain('Stadium MRT Exit A');
    const action = entry.get('a.btn');
    expect(action.text()).toBe('View meetup details');
    expect(action.attributes('href')).toBe('/meetups/confirmed-plan?from=conversation#meetup-review');
    expect(api.meetupContext).not.toHaveBeenCalled();
    await action.trigger('click'); await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/meetups/confirmed-plan?from=conversation#meetup-review');
    expect(api.createMeetup).not.toHaveBeenCalled();
  });

  it('keeps the actual group room usable without offering unauthorized member creation', async () => {
    const data = await api.groupChannel();
    api.groupChannel.mockResolvedValue({ channel: { ...data.channel, isHost: false } });
    api.meetupContext.mockResolvedValue({ context: { capabilities: { canCreate: false }, meetups: [] } });
    const { wrapper } = await mountPage(GroupChannelView, { props: { id: 'group-1' } });
    const entry = wrapper.get('[aria-label="Meetup planner for this group"]');
    expect(entry.text()).toContain('Planning has not started');
    expect(entry.find('a').exists()).toBe(false);
    expect(wrapper.get('input[aria-label="Message the group"]').exists()).toBe(true);
    expect(api.createMeetup).not.toHaveBeenCalled();
  });

  it.each(rooms)('hides the $name planning entry when the server denies room access', async ({ view, id, method, denied, label }) => {
    api[method].mockRejectedValue(Object.assign(new Error('unavailable'), { status: denied }));
    const { wrapper } = await mountPage(view, { props: { id } });
    expect(wrapper.find(`[aria-label="${label}"]`).exists()).toBe(false);
    expect(wrapper.findAll('button').some(control => control.text() === 'Plan meetup')).toBe(false);
    expect(api.meetups).not.toHaveBeenCalled();
  });

  it.each(rooms)('does not load $name planning data after a signed-out room request is rejected', async ({ view, id, method, label }) => {
    currentUser.value = null;
    api[method].mockRejectedValue(Object.assign(new Error('authentication_required'), { status: 401 }));
    const { wrapper } = await mountPage(view, { props: { id } });
    expect(wrapper.find(`[aria-label="${label}"]`).exists()).toBe(false);
    expect(api.meetups).not.toHaveBeenCalled(); expect(api.meetupContext).not.toHaveBeenCalled();
  });
});
