import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { flushPromises } from '@vue/test-utils';
import GroupExplorerView from '../../client/src/views/GroupExplorerView.vue';
import { api } from '../../client/src/api.js';
import { button, field, group, mountPage } from './helpers.js';

vi.mock('../../client/src/composables/useMeetupSummaries.js', () => ({ useMeetupSummaries: () => ({ plans: ref([]) }) }));
vi.mock('../../client/src/components/GroupPreferencesGate.vue', () => ({ default: { template: '<div><slot name="before"/><slot/></div>' } }));
vi.mock('../../client/src/auth.js', async () => { const { ref } = await import('vue'); return { currentUser: ref({ id: 'viewer' }), sessionReady: ref(true) }; });
vi.mock('../../client/src/api.js', async original => ({ ...await original(), api: {
  concerts: vi.fn(), discoverGroups: vi.fn(), groupPreferences: vi.fn(), seekerRequest: vi.fn(),
  groupJoinRequests: vi.fn(), groupMatching: vi.fn(), currentGroupMemberships: vi.fn(), myProposals: vi.fn(),
  requestGroupJoin: vi.fn(), withdrawGroupJoin: vi.fn(), createRequest: vi.fn(), findMyGroup: vi.fn(),
} }));
const pending = { id: 'request-1', userId: 'viewer', concertId: 'concert-1', partyId: 'group-1', status: 'pending', seatReserved: true, hostName: 'Host', expiresAt: '2030-01-01T10:00:00Z' };
beforeEach(() => {
  vi.resetAllMocks();
  api.concerts.mockResolvedValue({ concerts: [{ id: 'concert-1', artist: 'Future artist', event_date: '2030-01-01' }] });
  api.discoverGroups.mockResolvedValue({ groups: [group('group-1', 'Supper crew')], total: 1 });
  api.groupPreferences.mockResolvedValue({ preferences: [] });
  api.seekerRequest.mockResolvedValue({ request: { status: 'open', joining_mode: 'direct' } });
  api.groupJoinRequests.mockResolvedValue({ requests: [] });
  api.groupMatching.mockResolvedValue({ matching: { optedIn: false, state: 'idle' } });
  api.currentGroupMemberships.mockResolvedValue({ groups: [] }); api.myProposals.mockResolvedValue({ proposals: [] });
  api.requestGroupJoin.mockResolvedValue({ request: pending });
});

describe('group discovery historical and mutation feedback consistency', () => {
  it('closes both prospective pathways for a completed concert and retains pending request history', async () => {
    api.concerts.mockResolvedValue({ concerts: [{ id: 'concert-1', artist: 'Past artist', event_date: '2000-01-01' }] });
    api.groupJoinRequests.mockResolvedValue({ requests: [pending] });
    const { wrapper } = await mountPage(GroupExplorerView, { path: '/groups?concertId=concert-1' });
    expect(wrapper.text()).toContain('This concert has finished. New group matching is closed');
    expect(wrapper.text()).toContain('Your requests');
    expect(button(wrapper, 'Cancel request').exists()).toBe(true);
    await button(wrapper, 'See all').trigger('click');
    expect(button(wrapper, 'Request sent').element.disabled).toBe(true);
    await button(wrapper, 'Find my match').trigger('click');
    expect(wrapper.findAll('button').some(item => item.text() === 'Join the match list')).toBe(false);
    expect(wrapper.findAll('button').some(item => item.text() === 'Switch to matching')).toBe(false);
    expect(api.requestGroupJoin).not.toHaveBeenCalled(); expect(api.findMyGroup).not.toHaveBeenCalled();
  });

  it('distinguishes a saved application from a failed refresh and immediately enforces the single pending application limit', async () => {
    api.requestGroupJoin.mockResolvedValue({ request: { id: 'request-1', status: 'pending', seatReserved: true } });
    const { wrapper } = await mountPage(GroupExplorerView, { path: '/groups?concertId=concert-1' });
    await button(wrapper, 'See all').trigger('click');
    await button(wrapper, 'Ask to join').trigger('click');
    await field(wrapper, 'Say hi to the host').setValue('Looking forward to supper!');
    api.discoverGroups.mockRejectedValueOnce(new Error('refresh interrupted'));
    await button(wrapper, 'Send request').trigger('click'); await flushPromises();
    expect(api.requestGroupJoin).toHaveBeenCalledExactlyOnceWith('group-1', { note: 'Looking forward to supper!' });
    expect(wrapper.text()).toContain('Request sent. A spot is held');
    expect(wrapper.text()).toContain('Your change was saved. The latest group details could not be loaded');
    expect(wrapper.text()).not.toContain('Something went wrong');
    expect(button(wrapper, 'Request sent').element.disabled).toBe(true);
    expect(button(wrapper, 'Cancel request').exists()).toBe(true);
    expect(wrapper.find('textarea').exists()).toBe(false);
  });

  it('retains an unsuccessful application note and does not claim that a request was sent', async () => {
    api.requestGroupJoin.mockRejectedValue(new Error('offline'));
    const { wrapper } = await mountPage(GroupExplorerView, { path: '/groups?concertId=concert-1' });
    await button(wrapper, 'See all').trigger('click'); await button(wrapper, 'Ask to join').trigger('click');
    await field(wrapper, 'Say hi to the host').setValue('Keep my introduction');
    await button(wrapper, 'Send request').trigger('click'); await flushPromises();
    expect(field(wrapper, 'Say hi to the host').element.value).toBe('Keep my introduction');
    expect(wrapper.text()).not.toContain('Request sent.');
    expect(wrapper.get('[role="alert"]').text()).toContain('Something went wrong');
    expect(button(wrapper, 'Send request').element.disabled).toBe(false);
  });

  it('immediately retires a withdrawn request when the successful write is followed by a failed refresh', async () => {
    api.groupJoinRequests.mockResolvedValue({ requests: [pending] }); api.withdrawGroupJoin.mockResolvedValue({});
    const { wrapper } = await mountPage(GroupExplorerView, { path: '/groups?concertId=concert-1' });
    api.discoverGroups.mockRejectedValueOnce(new Error('read interrupted'));
    await button(wrapper, 'Cancel request').trigger('click'); await flushPromises();
    expect(api.withdrawGroupJoin).toHaveBeenCalledExactlyOnceWith('request-1');
    expect(wrapper.text()).toContain('Request cancelled.');
    expect(wrapper.text()).toContain('Your change was saved.');
    expect(wrapper.text()).toContain('You cancelled this');
    expect(wrapper.findAll('button').some(item => item.text() === 'Cancel request')).toBe(false);
  });
});
