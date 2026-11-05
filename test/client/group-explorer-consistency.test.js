import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { DOMWrapper, flushPromises } from '@vue/test-utils';
import GroupExplorerView from '../../client/src/views/GroupExplorerView.vue';
import { api } from '../../client/src/api.js';
import { currentUser } from '../../client/src/auth.js';
import { button, field, group, mountPage } from './helpers.js';

vi.mock('../../client/src/composables/useMeetupSummaries.js', () => ({ useMeetupSummaries: () => ({ plans: ref([]) }) }));
vi.mock('../../client/src/components/GroupPreferencesGate.vue', () => ({ default: { template: '<div><slot name="before"/><slot/></div>' } }));
vi.mock('../../client/src/auth.js', async () => { const { ref } = await import('vue'); return { currentUser: ref({ id: 'viewer' }), sessionReady: ref(true) }; });
vi.mock('../../client/src/api.js', async original => ({ ...await original(), api: {
  concerts: vi.fn(), discoverGroups: vi.fn(), groupPreferences: vi.fn(), seekerRequest: vi.fn(),
  groupJoinRequests: vi.fn(), groupMatching: vi.fn(), currentGroupMemberships: vi.fn(), myProposals: vi.fn(),
  requestGroupJoin: vi.fn(), withdrawGroupJoin: vi.fn(), createRequest: vi.fn(), findMyGroup: vi.fn(),
  preferGroup: vi.fn(), removeGroupPreference: vi.fn(),
  setJoiningMode: vi.fn(), acceptProposal: vi.fn(), declineProposal: vi.fn(), proposalExplanation: vi.fn(), leaveGroupMatching: vi.fn(), findGroupMatch: vi.fn(),
} }));
const pending = { id: 'request-1', userId: 'viewer', concertId: 'concert-1', partyId: 'group-1', status: 'pending', seatReserved: true, hostName: 'Host', expiresAt: '2030-01-01T10:00:00Z' };
const mountExplorer = options => mountPage(GroupExplorerView, { ...options, stubs: { Teleport: true, ...options?.stubs } });
const dialog = wrapper => wrapper.find('[role="dialog"]').exists()
  ? wrapper.get('[role="dialog"]') : new DOMWrapper(document.querySelector('[role="dialog"]'));
/** The page refreshes its status when the tab comes back into view. */
async function returnToTab() {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}
const queued = { preferencesComplete: true, optedIn: true, state: 'queued', latestAttempt: null };
const matchingOffer = overrides => ({ id: 'offer-1', partyId: 'group-1', concertId: 'concert-1', role: 'seeker',
  status: 'proposed', seekerApproved: false, hostApproved: false, canHostRespond: true,
  queueStatus: 'held', seatReserved: true, eventDate: '2030-01-01', expiresAt: '2030-01-01T10:00:00Z', ...overrides });
const attempt = (id, status = 'waiting', extra = {}) => ({ id, status, attemptedAt: 1800000000000, completedAt: 1800000000100, completed: true, receivedProposal: status === 'proposed', proposalId: null, ranMatching: true, ...extra });
const storageKey = (user = 'viewer', concert = 'concert-1') => `encore:matching-attempt:${encodeURIComponent(user)}:${encodeURIComponent(concert)}`;
function savedMethod(mode, matching = mode === 'algorithm' ? queued : { preferencesComplete: true, optedIn: false, state: 'idle', latestAttempt: null }) {
  api.seekerRequest.mockResolvedValue({ request: { status: 'open', joining_mode: mode } });
  api.groupMatching.mockResolvedValue({ matching });
}
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear(); localStorage.clear(); currentUser.value = { id: 'viewer' };
  api.concerts.mockResolvedValue({ concerts: [{ id: 'concert-1', artist: 'Future artist', event_date: '2030-01-01' }] });
  api.discoverGroups.mockResolvedValue({ groups: [group('group-1', 'Supper crew')], total: 1 });
  api.groupPreferences.mockResolvedValue({ preferences: [] });
  api.seekerRequest.mockResolvedValue({ request: { status: 'open', joining_mode: 'direct' } });
  api.groupJoinRequests.mockResolvedValue({ requests: [] });
  api.groupMatching.mockResolvedValue({ matching: { preferencesComplete: true, optedIn: false, state: 'idle' } });
  api.currentGroupMemberships.mockResolvedValue({ groups: [] }); api.myProposals.mockResolvedValue({ proposals: [] });
  api.requestGroupJoin.mockResolvedValue({ request: pending });
});

describe('group discovery historical and mutation feedback consistency', () => {
  it('only views another pathway when a pending request prevents changing the active method', async () => {
    api.groupJoinRequests.mockResolvedValue({ requests: [pending] });
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1' });
    await button(wrapper, 'View automatic matching').trigger('click'); await flushPromises();
    expect(wrapper.get('.joining-mode--selected h3').text()).toBe('Automatic matching');
    expect(wrapper.text()).toContain('To switch, first cancel your request');
    expect(api.setJoiningMode).not.toHaveBeenCalled(); expect(api.findMyGroup).not.toHaveBeenCalled();
    await button(wrapper, 'Browse groups').trigger('click'); await flushPromises();
    expect(wrapper.get('.joining-mode--selected h3').text()).toBe('Browse and choose');
  });
  it('views automatic matching without enrollment and joins only after deliberate confirmation', async () => {
    api.setJoiningMode.mockImplementation(async () => {
      api.seekerRequest.mockResolvedValue({ request: { status: 'open', joining_mode: 'algorithm' } });
      api.groupMatching.mockResolvedValue({ matching: { optedIn: true, state: 'queued' } });
      return { request: { status: 'open', joining_mode: 'algorithm' } };
    });
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1' });
    expect(api.setJoiningMode).not.toHaveBeenCalled();
    await button(wrapper, 'View automatic matching').trigger('click'); await flushPromises();
    expect(api.setJoiningMode).not.toHaveBeenCalled();
    await button(wrapper, 'Join automatic matching').trigger('click'); await flushPromises();
    expect(dialog(wrapper).attributes('aria-label')).toBe('Join automatic matching?');
    expect(api.setJoiningMode).not.toHaveBeenCalled();
    await button(dialog(wrapper), 'Join automatic matching').trigger('click'); await flushPromises();
    expect(api.setJoiningMode).toHaveBeenCalledExactlyOnceWith('concert-1', 'algorithm');
    expect(api.findMyGroup).not.toHaveBeenCalled();
    expect(wrapper.get('[aria-label="Automatic matching progress"]').text()).toContain('Ready to find a match');
    expect(button(wrapper, 'Leave the match list').exists()).toBe(true);
    expect(wrapper.findAll('button').some(item => item.text() === 'Join automatic matching')).toBe(false);
  });

  it('shows the confirmed enrollment when the switch succeeds but its following read fails', async () => {
    api.setJoiningMode.mockResolvedValue({ request: { status: 'open', joining_mode: 'algorithm' } });
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1' });
    await button(wrapper, 'View automatic matching').trigger('click'); await flushPromises();
    api.discoverGroups.mockRejectedValueOnce(new Error('refresh unavailable'));
    api.groupMatching.mockRejectedValueOnce(new Error('matching refresh unavailable'));
    api.seekerRequest.mockRejectedValueOnce(new Error('method refresh unavailable'));
    await button(wrapper, 'Join automatic matching').trigger('click'); await flushPromises();
    await button(dialog(wrapper), 'Join automatic matching').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Your change was saved.');
    expect(button(wrapper, 'Leave the match list').exists()).toBe(true);
    expect(wrapper.findAll('button').some(item => item.text() === 'Join automatic matching')).toBe(false);
    expect(api.setJoiningMode).toHaveBeenCalledTimes(1);
  });
  it('reuses an uncertain search attempt and applies its acknowledged offer even if the following read fails', async () => {
    const queued = { preferencesComplete: true, optedIn: true, state: 'queued' };
    const offer = { id: 'offer-1', partyId: 'group-1', concertId: 'concert-1', role: 'seeker', status: 'proposed', seekerApproved: false, hostApproved: false, queueStatus: 'held', seatReserved: true, eventDate: '2030-01-01', expiresAt: '2030-01-01T10:00:00Z' };
    api.seekerRequest.mockResolvedValue({ request: { status: 'open', joining_mode: 'algorithm' } });
    api.groupMatching.mockResolvedValue({ matching: queued });
    api.findGroupMatch.mockRejectedValueOnce(new TypeError('connection lost')).mockResolvedValueOnce({ matching: { ...queued, state: 'pending', proposal: offer }, search: { status: 'proposed' } });
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1' });
    await button(wrapper, 'Find a match').trigger('click'); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('safely check the same attempt');
    const firstAttempt = api.findGroupMatch.mock.calls[0][1];
    api.discoverGroups.mockRejectedValueOnce(new Error('read unavailable'));
    api.groupMatching.mockRejectedValueOnce(new Error('matching unavailable'));
    api.myProposals.mockRejectedValueOnce(new Error('offers unavailable'));
    await button(wrapper, 'Retry finding a match').trigger('click'); await flushPromises();
    expect(api.findGroupMatch.mock.calls[1][1]).toBe(firstAttempt);
    expect(wrapper.get('[aria-label="Automatic matching progress"] h2').text()).toBe('Review your group offer');
    expect(button(wrapper, 'Accept group offer').exists()).toBe(true);
    expect(wrapper.findAll('button').some(item => item.text() === 'Find a match')).toBe(false);
    expect(api.findMyGroup).not.toHaveBeenCalled();
  });
  it('locks a running search against double submission', async () => {
    const queued = { preferencesComplete: true, optedIn: true, state: 'queued' };
    let resolveSearch;
    api.seekerRequest.mockResolvedValue({ request: { status: 'open', joining_mode: 'algorithm' } });
    api.groupMatching.mockResolvedValue({ matching: queued });
    api.findGroupMatch.mockImplementation(() => new Promise(resolve => { resolveSearch = resolve; }));
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1' });
    await button(wrapper, 'Find a match').trigger('click');
    expect(button(wrapper, 'Recover previous search').element.disabled).toBe(true);
    await button(wrapper, 'Recover previous search').trigger('click');
    expect(api.findGroupMatch).toHaveBeenCalledTimes(1);
    resolveSearch({ matching: queued, search: { status: 'waiting' } }); await flushPromises();
    expect(button(wrapper, 'Find a match').element.disabled).toBe(false);
  });
  it('makes Browse and choose the active method as soon as it is chosen', async () => {
    const queued = { preferencesComplete: true, optedIn: true, state: 'queued' };
    api.seekerRequest.mockResolvedValue({ request: { status: 'open', joining_mode: 'algorithm' } });
    api.groupMatching.mockResolvedValue({ matching: queued });
    api.findGroupMatch.mockResolvedValue({ matching: queued, search: { status: 'waiting' } });
    api.setJoiningMode.mockResolvedValue({ request: { status: 'open', joining_mode: 'direct' } });
    const { wrapper, router } = await mountExplorer({ path: '/groups?concertId=concert-1&mode=algorithm' });
    await button(wrapper, 'Find a match').trigger('click'); await flushPromises();
    await button(wrapper, 'Browse and choose groups').trigger('click'); await flushPromises();
    expect(api.setJoiningMode).toHaveBeenCalledExactlyOnceWith('concert-1', 'direct');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.get('.joining-mode--selected h3').text()).toBe('Browse and choose');
    expect(router.currentRoute.value.query.mode).toBe('direct');
    expect(wrapper.text()).not.toContain('Switch to Browse and choose');
    expect(wrapper.text()).toContain('Browse and choose is now how you find a group.');
    expect(api.requestGroupJoin).not.toHaveBeenCalled();
  });
  it('keeps automatic enrollment when switching to Browse and choose fails', async () => {
    const queued = { preferencesComplete: true, optedIn: true, state: 'queued' };
    api.seekerRequest.mockResolvedValue({ request: { status: 'open', joining_mode: 'algorithm' } });
    api.groupMatching.mockResolvedValue({ matching: queued });
    api.findGroupMatch.mockResolvedValue({ matching: queued, search: { status: 'waiting' } });
    api.setJoiningMode.mockRejectedValue(new Error('offline'));
    const { wrapper, router } = await mountExplorer({ path: '/groups?concertId=concert-1&mode=algorithm' });
    await button(wrapper, 'Find a match').trigger('click'); await flushPromises();
    await button(wrapper, 'Browse and choose groups').trigger('click'); await flushPromises();
    expect(api.setJoiningMode).toHaveBeenCalledExactlyOnceWith('concert-1', 'direct');
    expect(wrapper.text()).toContain('Something went wrong');
    await button(wrapper, 'View automatic matching').trigger('click'); await flushPromises();
    expect(wrapper.get('[aria-label="Automatic matching progress"]').text()).toContain('match list');
    expect(button(wrapper, 'Leave the match list').exists()).toBe(true);
    expect(router.currentRoute.value.query.mode).toBe('algorithm');
    expect(api.requestGroupJoin).not.toHaveBeenCalled();
  });
  it('directs incomplete automatic preferences to Profile without exposing questionnaire answers', async () => {
    api.seekerRequest.mockResolvedValue({ request: { status: 'open', joining_mode: 'algorithm' } });
    api.groupMatching.mockResolvedValue({ matching: { preferencesComplete: false, optedIn: false, state: 'idle' } });
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1' });
    const progress = wrapper.get('[aria-label="Automatic matching progress"]');
    expect(progress.get('h2').text()).toBe('Set up your matching preferences');
    expect(progress.get('a[href="/profile"]').text()).toBe('Set up preferences in Profile');
    expect(progress.text()).toContain('Setup needed');
    expect(wrapper.findAll('button').some(item => item.text() === 'Join automatic matching')).toBe(false);
  });
  it('keeps the viewed pathway separate from actual enrollment after a rejected enrollment', async () => {
    api.setJoiningMode.mockRejectedValue(Object.assign(new Error('save_discovery_preferences_first'), { status: 409 }));
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1' });
    await button(wrapper, 'View automatic matching').trigger('click'); await flushPromises();
    await button(wrapper, 'Join automatic matching').trigger('click'); await flushPromises();
    await button(dialog(wrapper), 'Join automatic matching').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Save your private preferences in Profile');
    expect(wrapper.find('a[href="/profile"]').exists()).toBe(true);
    expect(wrapper.findAll('button').some(item => item.text() === 'Leave the match list')).toBe(false);
    expect(api.findMyGroup).not.toHaveBeenCalled();
  });
  it('updates approval progress from the authoritative response when the subsequent read fails', async () => {
    const offer = { id: 'offer-1', partyId: 'group-1', concertId: 'concert-1', role: 'seeker', status: 'proposed', seekerApproved: false, hostApproved: false, canHostRespond: true, queueStatus: 'held', seatReserved: true, eventDate: '2030-01-01', expiresAt: '2030-01-01T10:00:00Z' };
    api.seekerRequest.mockResolvedValue({ request: { status: 'open', joining_mode: 'algorithm' } });
    api.groupMatching.mockResolvedValue({ matching: { preferencesComplete: true, optedIn: true, state: 'pending', proposal: offer } });
    api.myProposals.mockResolvedValue({ proposals: [offer] });
    api.acceptProposal.mockResolvedValue({ proposal: { status: 'proposed', seekerApproved: true, hostApproved: false } });
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1' });
    expect(wrapper.get('[aria-label="Automatic matching progress"] h2').text()).toBe('Review your group offer');
    api.discoverGroups.mockRejectedValueOnce(new Error('read unavailable'));
    api.groupMatching.mockRejectedValueOnce(new Error('matching read unavailable'));
    api.myProposals.mockRejectedValueOnce(new Error('offers read unavailable'));
    await button(wrapper, 'Accept group offer').trigger('click'); await flushPromises();
    const progress = wrapper.get('[aria-label="Automatic matching progress"]');
    expect(progress.get('h2').text()).toBe('Waiting for the host’s approval');
    expect(progress.text()).toContain('You approved · Host reply needed');
    expect(progress.text()).not.toContain('Membership confirmed');
    expect(api.acceptProposal).toHaveBeenCalledTimes(1);
  });
  it('keeps a confirmed member focused on their group when discovery has no remaining results', async () => {
    api.seekerRequest.mockResolvedValue({ request: { status: 'matched', joining_mode: 'algorithm' } });
    api.groupMatching.mockResolvedValue({ matching: { preferencesComplete: true, optedIn: false, state: 'accepted' } });
    api.currentGroupMemberships.mockResolvedValue({ groups: [{ partyId: 'group-1', concertId: 'concert-1', name: 'Supper crew', artist: 'Future artist' }] });
    api.discoverGroups.mockResolvedValue({ groups: [], total: 0 });
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1' });
    expect(wrapper.get('.group-empty h3').text()).toBe('You already have a group');
    expect(wrapper.get('.group-empty a').attributes('href')).toBe('/groups/group-1/members');
    expect(wrapper.get('[aria-label="Automatic matching progress"] h2').text()).toBe('Group membership confirmed');
  });

  it('uses a fresh matching confirmation when the proposal inbox cannot refresh its old pending offer', async () => {
    const pendingOffer = matchingOffer();
    savedMethod('algorithm', { ...queued, state: 'pending', proposal: pendingOffer });
    api.myProposals.mockResolvedValue({ proposals: [pendingOffer] });
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1&mode=algorithm' });
    expect(button(wrapper, 'Accept group offer').exists()).toBe(true);
    api.groupMatching.mockResolvedValue({ matching: { ...queued, optedIn: false, state: 'accepted',
      proposal: matchingOffer({ status: 'confirmed', seekerApproved: true, hostApproved: true }) } });
    api.myProposals.mockRejectedValueOnce(new Error('proposal inbox unavailable'));
    api.currentGroupMemberships.mockRejectedValueOnce(new Error('membership details unavailable'));
    await returnToTab(); await flushPromises();
    expect(wrapper.get('[aria-label="Automatic matching progress"] h2').text()).toBe('Group membership confirmed');
    expect(wrapper.find('#automatic-offers').exists()).toBe(false);
    expect(wrapper.findAll('button').some(item => item.text() === 'Accept group offer')).toBe(false);
    expect(wrapper.get('a[href="/groups/group-1/members"]').text()).toBe('Open your group');
  });

  it('uses a fresh inbox confirmation when matching status cannot refresh its old pending offer', async () => {
    const pendingOffer = matchingOffer();
    savedMethod('algorithm', { ...queued, state: 'pending', proposal: pendingOffer });
    api.myProposals.mockResolvedValue({ proposals: [pendingOffer] });
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1&mode=algorithm' });
    api.myProposals.mockResolvedValue({ proposals: [matchingOffer({ status: 'confirmed', seekerApproved: true, hostApproved: true })] });
    api.groupMatching.mockRejectedValueOnce(new Error('matching status unavailable'));
    api.currentGroupMemberships.mockRejectedValueOnce(new Error('membership details unavailable'));
    await returnToTab(); await flushPromises();
    expect(wrapper.get('[aria-label="Automatic matching progress"] h2').text()).toBe('Group membership confirmed');
    expect(wrapper.find('#automatic-offers').exists()).toBe(false);
    expect(wrapper.findAll('button').some(item => item.text() === 'Accept group offer')).toBe(false);
    expect(wrapper.get('a[href="/groups/group-1/members"]').text()).toBe('Open your group');
  });

  it('does not resurrect a retained historical confirmation when current matching is empty after leaving and resuming', async () => {
    const confirmed = matchingOffer({ status: 'confirmed', seekerApproved: true, hostApproved: true });
    savedMethod('algorithm', { ...queued, optedIn: false, state: 'accepted', proposal: confirmed });
    api.myProposals.mockResolvedValue({ proposals: [confirmed] });
    api.currentGroupMemberships.mockResolvedValue({ groups: [{ partyId: 'group-1', concertId: 'concert-1', name: 'Previous crew' }] });
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1&mode=algorithm' });
    expect(wrapper.get('[aria-label="Automatic matching progress"] h2').text()).toBe('Group membership confirmed');
    savedMethod('algorithm', { ...queued, proposal: null });
    api.currentGroupMemberships.mockResolvedValue({ groups: [] });
    api.myProposals.mockRejectedValueOnce(new Error('old inbox retained'));
    await returnToTab(); await flushPromises();
    expect(wrapper.get('[aria-label="Automatic matching progress"] h2').text()).toBe('Ready to find a match');
    expect(wrapper.text()).not.toContain('Group membership confirmed');
    expect(wrapper.find('a[href="/groups/group-1/members"]').exists()).toBe(false);
    expect(button(wrapper, 'Find a match').exists()).toBe(true);
  });

  it('clears cached accepted matching when refreshed membership and offers confirm it is no longer current', async () => {
    const confirmed = matchingOffer({ status: 'confirmed', seekerApproved: true, hostApproved: true });
    savedMethod('algorithm', { ...queued, optedIn: false, state: 'accepted', proposal: confirmed });
    api.myProposals.mockResolvedValue({ proposals: [confirmed] });
    api.currentGroupMemberships.mockResolvedValue({ groups: [{ partyId: 'group-1', concertId: 'concert-1', name: 'Previous crew' }] });
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1&mode=algorithm' });
    expect(wrapper.get('[aria-label="Automatic matching progress"] h2').text()).toBe('Group membership confirmed');
    api.currentGroupMemberships.mockResolvedValue({ groups: [] });
    api.myProposals.mockResolvedValue({ proposals: [] });
    api.groupMatching.mockRejectedValueOnce(new Error('old matching status retained'));
    await returnToTab(); await flushPromises();
    expect(wrapper.get('[aria-label="Automatic matching progress"] h2').text()).toBe('Matching status is unavailable');
    expect(wrapper.text()).not.toContain('Your group membership is confirmed.');
    expect(wrapper.find('a[href="/groups/group-1/members"]').exists()).toBe(false);
    expect(wrapper.findAll('a').some(item => item.text() === 'Open My groups')).toBe(false);
    expect(wrapper.find('#automatic-offers').exists()).toBe(false);
  });

  it('keeps the last successful offer source authoritative while another refresh is still loading', async () => {
    const pendingOffer = matchingOffer(), confirmed = matchingOffer({ status: 'confirmed', seekerApproved: true, hostApproved: true });
    savedMethod('algorithm', { ...queued, state: 'pending', proposal: pendingOffer });
    api.myProposals.mockResolvedValue({ proposals: [pendingOffer] });
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1&mode=algorithm' });
    api.groupMatching.mockResolvedValue({ matching: { ...queued, optedIn: false, state: 'accepted', proposal: confirmed } });
    api.myProposals.mockRejectedValueOnce(new Error('proposal inbox unavailable'));
    await returnToTab(); await flushPromises();
    let finishMatching, failInbox;
    api.groupMatching.mockImplementationOnce(() => new Promise(resolve => { finishMatching = resolve; }));
    api.myProposals.mockImplementationOnce(() => new Promise((_resolve, reject) => { failInbox = reject; }));
    await returnToTab();
    expect(wrapper.find('#automatic-offers').exists()).toBe(false);
    expect(wrapper.findAll('button').some(item => item.text() === 'Accept group offer')).toBe(false);
    finishMatching({ matching: { ...queued, optedIn: false, state: 'accepted', proposal: confirmed } });
    failInbox(new Error('proposal inbox still unavailable')); await flushPromises();
    expect(wrapper.get('[aria-label="Automatic matching progress"] h2').text()).toBe('Group membership confirmed');
    expect(wrapper.find('#automatic-offers').exists()).toBe(false);
  });
  it('closes both prospective pathways for a completed concert and retains pending request history', async () => {
    api.concerts.mockResolvedValue({ concerts: [{ id: 'concert-1', artist: 'Past artist', event_date: '2000-01-01' }] });
    api.groupJoinRequests.mockResolvedValue({ requests: [pending] });
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1' });
    expect(wrapper.text()).toContain('This concert has finished. New group matching is closed');
    expect(wrapper.text()).not.toContain('Your requests');
    await button(wrapper, 'See all').trigger('click');
    expect(button(wrapper, 'Request sent').element.disabled).toBe(true);
    await button(wrapper, 'View automatic matching').trigger('click');
    expect(wrapper.findAll('button').some(item => item.text() === 'Join the match list')).toBe(false);
    expect(wrapper.findAll('button').some(item => item.text() === 'Join automatic matching')).toBe(false);
    expect(api.requestGroupJoin).not.toHaveBeenCalled(); expect(api.findMyGroup).not.toHaveBeenCalled();
  });

  it('distinguishes a saved application from a failed refresh, enforces the single pending application limit and opens My groups', async () => {
    api.requestGroupJoin.mockResolvedValue({ request: { id: 'request-1', status: 'pending', seatReserved: true } });
    const { wrapper, router } = await mountExplorer({ path: '/groups?concertId=concert-1' });
    await button(wrapper, 'See all').trigger('click');
    await button(wrapper, 'Ask to join').trigger('click');
    await field(wrapper, 'Say hi to the host').setValue('Looking forward to supper!');
    api.discoverGroups.mockRejectedValueOnce(new Error('refresh interrupted'));
    api.groupJoinRequests.mockRejectedValueOnce(new Error('saved request read interrupted'));
    await button(wrapper, 'Send request').trigger('click'); await flushPromises();
    expect(api.requestGroupJoin).toHaveBeenCalledExactlyOnceWith('group-1', { note: 'Looking forward to supper!' });
    expect(wrapper.text()).toContain('Request sent. A spot is held');
    expect(wrapper.text()).toContain('Your change was saved. The latest group details could not be loaded');
    expect(wrapper.text()).not.toContain('Something went wrong');
    expect(button(wrapper, 'Request sent').element.disabled).toBe(true);
    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(router.currentRoute.value.path).toBe('/groups/connect');
    expect(router.currentRoute.value.query.sent).toBe('1');
  });

  it('retains an unsuccessful application note and does not claim that a request was sent', async () => {
    api.requestGroupJoin.mockRejectedValue(new Error('offline'));
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1' });
    await button(wrapper, 'See all').trigger('click'); await button(wrapper, 'Ask to join').trigger('click');
    await field(wrapper, 'Say hi to the host').setValue('Keep my introduction');
    await button(wrapper, 'Send request').trigger('click'); await flushPromises();
    expect(field(wrapper, 'Say hi to the host').element.value).toBe('Keep my introduction');
    expect(wrapper.text()).not.toContain('Request sent.');
    expect(wrapper.get('[role="alert"]').text()).toContain('Something went wrong');
    expect(button(wrapper, 'Send request').element.disabled).toBe(false);
  });

  it('recovers a direct request whose POST committed but whose response was lost without resubmitting', async () => {
    api.requestGroupJoin.mockImplementationOnce(async () => {
      api.groupJoinRequests.mockResolvedValue({ requests: [{ ...pending, groupName: 'Supper crew', applicationNote: 'My saved introduction' }] });
      throw new TypeError('response lost after server commit');
    });
    const { wrapper, router } = await mountExplorer({ path: '/groups?concertId=concert-1' });
    await button(wrapper, 'See all').trigger('click'); await button(wrapper, 'Ask to join').trigger('click');
    await field(dialog(wrapper), 'Say hi to the host').setValue('My saved introduction');
    await button(dialog(wrapper), 'Send request').trigger('click'); await flushPromises();
    expect(api.requestGroupJoin).toHaveBeenCalledExactlyOnceWith('group-1', { note: 'My saved introduction' });
    expect(api.groupJoinRequests.mock.calls.length).toBeGreaterThan(1);
    expect(api.groupJoinRequests.mock.calls.at(-1)).toEqual([{ scope: 'own', concertId: 'concert-1' }]);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('My saved introduction');
    expect(router.currentRoute.value.path).toBe('/groups/connect');
    expect(button(wrapper, 'Request sent').element.disabled).toBe(true);
    expect(wrapper.text()).not.toContain('Something went wrong');
    expect(api.findGroupMatch).not.toHaveBeenCalled(); expect(api.setJoiningMode).not.toHaveBeenCalled();
  });

  it('uses server attempt history after refresh without starting another matching round', async () => {
    const receipt = attempt('80ed7d22-11c5-4a8a-b79b-6b5809666358');
    savedMethod('algorithm', { ...queued, latestAttempt: receipt });
    api.discoverGroups.mockResolvedValue({ groups: [], total: 0,
      discovery: { state: 'no_eligible_groups', eligibleCount: 0, filteredCount: 0 } });
    const first = await mountExplorer({ path: '/groups?concertId=concert-1&mode=algorithm' });
    expect(first.wrapper.get('[aria-label="Automatic matching progress"] h2').text()).toBe('No suitable group is available.');
    expect(first.wrapper.text()).toContain('Latest matching attempt');
    first.wrapper.unmount();
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1&mode=algorithm' });
    expect(wrapper.get('[aria-label="Automatic matching progress"] h2').text()).toBe('No suitable group is available.');
    expect(button(wrapper, 'Browse and choose groups').exists()).toBe(true);
    expect(api.findGroupMatch).not.toHaveBeenCalled(); expect(api.setJoiningMode).not.toHaveBeenCalled();
  });

  it('recovers an ambiguous search after remount using the same scoped UUID and no automatic POST', async () => {
    savedMethod('algorithm');
    api.findGroupMatch.mockRejectedValueOnce(new TypeError('response lost'));
    const first = await mountExplorer({ path: '/groups?concertId=concert-1&mode=algorithm' });
    await button(first.wrapper, 'Find a match').trigger('click'); await flushPromises();
    const id = api.findGroupMatch.mock.calls[0][1];
    expect(sessionStorage.getItem(storageKey())).toBe(id);
    first.wrapper.unmount();
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1&mode=algorithm' });
    expect(api.findGroupMatch).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[aria-label="Automatic matching progress"] h2').text()).toBe('Check your last search');
    api.findGroupMatch.mockImplementationOnce(async (_concert, key) => {
      const latestAttempt = attempt(key); savedMethod('algorithm', { ...queued, latestAttempt });
      return { matching: { ...queued, latestAttempt }, search: { status: 'waiting', replayed: true, attempt: latestAttempt } };
    });
    await button(wrapper, 'Recover previous search').trigger('click'); await flushPromises();
    expect(api.findGroupMatch.mock.calls[1]).toEqual(['concert-1', id]);
    expect(sessionStorage.getItem(storageKey())).toBe(null);
    expect(wrapper.get('[aria-label="Automatic matching progress"] h2').text()).toBe('No suitable group is available.');
  });

  it('reconciles an already committed search by GET while keeping another account and concert retry private', async () => {
    const id = '80ed7d22-11c5-4a8a-b79b-6b5809666358';
    sessionStorage.setItem(storageKey(), id);
    sessionStorage.setItem(storageKey('other-viewer'), 'a4417053-4897-4cc4-9f2d-92795dd5a27d');
    sessionStorage.setItem(storageKey('viewer', 'concert-2'), '5d7b2679-be7d-479f-90f4-62271df600e4');
    savedMethod('algorithm', { ...queued, latestAttempt: attempt(id) });
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1&mode=algorithm' });
    expect(sessionStorage.getItem(storageKey())).toBe(null);
    expect(sessionStorage.getItem(storageKey('other-viewer'))).toBe('a4417053-4897-4cc4-9f2d-92795dd5a27d');
    expect(sessionStorage.getItem(storageKey('viewer', 'concert-2'))).toBe('5d7b2679-be7d-479f-90f4-62271df600e4');
    expect(wrapper.get('[aria-label="Automatic matching progress"] h2').text()).toBe('No suitable group is available.');
    expect(api.findGroupMatch).not.toHaveBeenCalled();
  });

  it('retains an unresolved attempt when a recovery is rate limited and restores the same UUID after remount', async () => {
    savedMethod('algorithm');
    api.findGroupMatch.mockRejectedValueOnce(new TypeError('original response lost'))
      .mockRejectedValueOnce(Object.assign(new Error('rate_limit_exceeded'), { status: 429 }));
    const first = await mountExplorer({ path: '/groups?concertId=concert-1&mode=algorithm' });
    await button(first.wrapper, 'Find a match').trigger('click'); await flushPromises();
    const id = api.findGroupMatch.mock.calls[0][1];
    await button(first.wrapper, 'Retry finding a match').trigger('click'); await flushPromises();
    expect(api.findGroupMatch.mock.calls[1]).toEqual(['concert-1', id]);
    expect(sessionStorage.getItem(storageKey())).toBe(id);
    first.wrapper.unmount();
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1&mode=algorithm' });
    expect(api.findGroupMatch).toHaveBeenCalledTimes(2);
    expect(wrapper.get('[aria-label="Automatic matching progress"] h2').text()).toBe('Check your last search');
    api.findGroupMatch.mockImplementationOnce(async (_concert, key) => {
      const latestAttempt = attempt(key); savedMethod('algorithm', { ...queued, latestAttempt });
      return { matching: { ...queued, latestAttempt }, search: { status: 'waiting', replayed: true, attempt: latestAttempt } };
    });
    await button(wrapper, 'Recover previous search').trigger('click'); await flushPromises();
    expect(api.findGroupMatch.mock.calls[2]).toEqual(['concert-1', id]);
    expect(sessionStorage.getItem(storageKey())).toBe(null);
  });

  it('keeps a real offer visible when discovery and saved preferences independently fail', async () => {
    const offer = { id: 'offer-1', partyId: 'group-1', concertId: 'concert-1', role: 'seeker', status: 'proposed', seekerApproved: false, hostApproved: false, queueStatus: 'held', seatReserved: true, eventDate: '2030-01-01', expiresAt: '2030-01-01T10:00:00Z' };
    savedMethod('algorithm', { ...queued, state: 'pending', proposal: offer });
    api.discoverGroups.mockRejectedValue(new Error('discovery unavailable'));
    api.groupPreferences.mockRejectedValue(new Error('preferences unavailable'));
    api.myProposals.mockResolvedValue({ proposals: [offer] });
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1&mode=algorithm' });
    expect(wrapper.get('[aria-label="Automatic matching progress"] h2').text()).toBe('Review your group offer');
    expect(button(wrapper, 'Accept group offer').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('No groups for this show yet');
    expect(wrapper.text()).not.toContain('No suitable group is available.');
    expect(wrapper.text()).toContain('Available groups'); expect(wrapper.text()).toContain('Saved group priorities');
    expect(api.findGroupMatch).not.toHaveBeenCalled();
  });

  it('keeps confirmed membership visible when matching and group discovery fail', async () => {
    api.currentGroupMemberships.mockResolvedValue({ groups: [{ partyId: 'group-1', concertId: 'concert-1', name: 'Supper crew', artist: 'Future artist' }] });
    api.groupMatching.mockRejectedValue(new Error('matching unavailable')); api.discoverGroups.mockRejectedValue(new Error('discovery unavailable'));
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1' });
    expect(wrapper.get('#current-group-heading').text()).toBe('Supper crew');
    expect(wrapper.get('a[href="/groups/group-1/members"]').text()).toBe('See your group');
    expect(wrapper.get('a[href="/groups/group-1/channel"]').text()).toBe('Group messages');
    expect(api.findGroupMatch).not.toHaveBeenCalled();
  });

  it('retries a failed discovery section without reloading unrelated enrollment and offers', async () => {
    api.discoverGroups.mockRejectedValueOnce(new Error('discovery unavailable'));
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1' });
    expect(api.groupMatching).toHaveBeenCalledTimes(1); expect(api.myProposals).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[aria-label="Group discovery status"]').exists()).toBe(false);
    const retry = wrapper.findAll('button').find(item => /retry available groups/i.test(item.text()));
    expect(retry).toBeDefined();
    await retry.trigger('click'); await flushPromises();
    expect(api.discoverGroups).toHaveBeenCalledTimes(2);
    expect(api.groupMatching).toHaveBeenCalledTimes(1); expect(api.myProposals).toHaveBeenCalledTimes(1);
    await button(wrapper, 'See all').trigger('click');
    expect(wrapper.get('[data-group-id="group-1"] h3').text()).toBe('Supper crew');
  });

  it('does not show old-filter cards as new search results when the new discovery request fails', async () => {
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1' });
    await button(wrapper, 'See all').trigger('click');
    expect(wrapper.get('[data-group-id="group-1"] h3').text()).toBe('Supper crew');
    api.discoverGroups.mockRejectedValueOnce(new Error('new filter response unavailable'));
    vi.useFakeTimers();
    await wrapper.get('input[type="search"]').setValue('New crew');
    await vi.advanceTimersByTimeAsync(260); await flushPromises();
    expect(wrapper.find('[data-group-id="group-1"]').exists()).toBe(false);
    expect(wrapper.get('[data-read-error="groups"]').text()).toContain('Available groups unavailable');
    expect(wrapper.text()).not.toContain('No groups match your filters');
    api.discoverGroups.mockResolvedValueOnce({ groups: [group('group-2', 'New crew')], total: 1,
      discovery: { state: 'available', eligibleCount: 1, filteredCount: 1 } });
    await button(wrapper, 'Retry available groups').trigger('click'); await flushPromises();
    expect(api.discoverGroups.mock.calls.at(-1)[1].q).toBe('New crew');
    expect(wrapper.get('[data-group-id="group-2"] h3').text()).toBe('New crew');
    expect(wrapper.find('[data-group-id="group-1"]').exists()).toBe(false);
  });

  it('ignores an older concert discovery response after the selected concert changes', async () => {
    let resolveOld;
    api.concerts.mockResolvedValue({ concerts: [
      { id: 'concert-1', artist: 'First concert', event_date: '2030-01-01' },
      { id: 'concert-2', artist: 'Second concert', event_date: '2030-02-01' },
    ] });
    api.discoverGroups.mockImplementation(id => id === 'concert-1'
      ? new Promise(resolve => { resolveOld = resolve; })
      : Promise.resolve({ groups: [{ ...group('group-2', 'Second show crew'), concertId: 'concert-2' }], total: 1 }));
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1' });
    await field(wrapper, 'Which concert are you going to?').setValue('concert-2'); await flushPromises();
    await button(wrapper, 'See all').trigger('click');
    expect(wrapper.get('[data-group-id="group-2"] h3').text()).toBe('Second show crew');
    resolveOld({ groups: [group('stale-group', 'Old show crew')], total: 1 }); await flushPromises();
    expect(wrapper.find('[data-group-id="stale-group"]').exists()).toBe(false);
    expect(wrapper.get('[data-group-id="group-2"] h3').text()).toBe('Second show crew');
    expect(api.setJoiningMode).not.toHaveBeenCalled(); expect(api.findGroupMatch).not.toHaveBeenCalled();
  });

  it('does not resurrect a late application acknowledgement after navigating A to B and back to A', async () => {
    let finishOldRequest;
    api.concerts.mockResolvedValue({ concerts: [
      { id: 'concert-1', artist: 'First concert', event_date: '2030-01-01' },
      { id: 'concert-2', artist: 'Second concert', event_date: '2030-02-01' },
    ] });
    api.discoverGroups.mockImplementation(id => Promise.resolve({ groups: [{ ...group(`group-${id}`, `Crew ${id}`), concertId: id }], total: 1 }));
    api.requestGroupJoin.mockImplementationOnce(() => new Promise(resolve => { finishOldRequest = resolve; }));
    const { wrapper, router } = await mountExplorer({ path: '/groups?concertId=concert-1' });
    await button(wrapper, 'See all').trigger('click'); await button(wrapper, 'Ask to join').trigger('click');
    await field(dialog(wrapper), 'Say hi to the host').setValue('An old submitted draft');
    await button(dialog(wrapper), 'Send request').trigger('click');
    await router.push({ path: '/groups', query: { concertId: 'concert-2', mode: 'direct' } }); await flushPromises();
    await router.push({ path: '/groups', query: { concertId: 'concert-1', mode: 'direct' } }); await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    finishOldRequest({ request: { ...pending, id: 'old-ack', partyId: 'group-concert-1' } }); await flushPromises();
    expect(wrapper.text()).not.toContain('An old submitted draft');
    expect(wrapper.text()).not.toContain('Request sent. A spot is held');
    expect(wrapper.findAll('button').some(item => item.text() === 'Cancel request')).toBe(false);
    expect(button(wrapper, 'Ask to join').element.disabled).toBe(false);
    expect(api.requestGroupJoin).toHaveBeenCalledTimes(1);
  });

  it('opens route-selected pathways and browser history without changing active enrollment', async () => {
    savedMethod('algorithm');
    const { wrapper, router } = await mountExplorer({ path: '/groups?concertId=concert-1&mode=direct' });
    expect(wrapper.get('.joining-mode--selected h3').text()).toBe('Browse and choose');
    await router.push({ path: '/groups', query: { concertId: 'concert-1', mode: 'algorithm' } }); await flushPromises();
    expect(wrapper.get('.joining-mode--selected h3').text()).toBe('Automatic matching');
    router.back(); await flushPromises(); await flushPromises();
    expect(wrapper.get('.joining-mode--selected h3').text()).toBe('Browse and choose');
    router.forward(); await flushPromises(); await flushPromises();
    expect(wrapper.get('.joining-mode--selected h3').text()).toBe('Automatic matching');
    expect(api.setJoiningMode).not.toHaveBeenCalled(); expect(api.leaveGroupMatching).not.toHaveBeenCalled();
    expect(api.findMyGroup).not.toHaveBeenCalled(); expect(api.findGroupMatch).not.toHaveBeenCalled();
  });

  it.each(['groups_unavailable', 'no_eligible_groups'])('shows a plain no-groups line without treating the concert-wide count as a guaranteed match (%s)', async state => {
    api.concerts.mockResolvedValue({ concerts: [{ id: 'concert-1', artist: 'Future artist', event_date: '2030-01-01', open_parties: 1 }] });
    api.discoverGroups.mockResolvedValue({ groups: [], total: 0, discovery: { state, eligibleCount: 0, filteredCount: 0 } });
    const { wrapper, router } = await mountExplorer({ path: '/groups?concertId=concert-1&mode=direct' });
    expect(wrapper.get('select option[value="concert-1"]').text()).toContain('1 open group overall');
    expect(wrapper.find('[aria-label="About your group results"]').exists()).toBe(false);
    expect(wrapper.get('.no-groups').text()).toBe('No suitable groups found');
    expect(wrapper.text()).not.toContain('No groups for this show yet');
    expect(wrapper.find('[aria-label="Group discovery status"]').exists()).toBe(false);
    expect(api.setJoiningMode).not.toHaveBeenCalled(); expect(api.findGroupMatch).not.toHaveBeenCalled();
    expect(router.currentRoute.value.query.mode).toBe('direct');
  });

  it.each([undefined, 0])('distinguishes an unknown concert-wide count from a known zero (%s)', async count => {
    api.concerts.mockResolvedValue({ concerts: [{ id: 'concert-1', artist: 'Future artist', event_date: '2030-01-01', ...(count === undefined ? {} : { open_parties: count }) }] });
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1' });
    const option = wrapper.get('select option[value="concert-1"]').text();
    if (count === undefined) expect(option).not.toMatch(/open groups|no groups/);
    else expect(option).toContain('0 open groups overall');
    expect(wrapper.get('.results-heading .key-figure').text()).toBe('1');
    expect(wrapper.find('[aria-label="About your group results"]').exists()).toBe(false);
  });

  it.each(['withdrawn', 'matched'])('keeps a non-open search state distinct from a preference mismatch (%s)', async status => {
    api.seekerRequest.mockResolvedValue({ request: { status, joining_mode: 'direct' } });
    api.discoverGroups.mockResolvedValue({ groups: [], total: 0, discovery: { state: 'groups_unavailable', eligibleCount: 0, filteredCount: 0 } });
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1' });
    const empty = wrapper.get('[aria-label="Group discovery status"]');
    expect(empty.text()).not.toContain('No suitable groups found');
    if (status === 'withdrawn') {
      expect(empty.get('h3').text()).toBe('You paused your group search');
      expect(empty.get('a').attributes('href')).toBe('#resume-group-search');
    } else {
      expect(empty.get('h3').text()).toBe('Your search request is not open');
      expect(button(empty, 'Check my status').exists()).toBe(true);
    }
    expect(empty.find('a[href*="view=create"]').exists()).toBe(false);
    expect(api.setJoiningMode).not.toHaveBeenCalled(); expect(api.findGroupMatch).not.toHaveBeenCalled();
  });

  it('ignores another account’s late discovery response instead of reusing its personalised results', async () => {
    let finishPrevious;
    api.discoverGroups.mockImplementationOnce(() => new Promise(resolve => { finishPrevious = resolve; }))
      .mockResolvedValue({ groups: [group('other-account-group', 'New viewer crew')], total: 1 });
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1&mode=direct' });
    currentUser.value = { id: 'other-viewer' }; await flushPromises();
    await button(wrapper, 'See all').trigger('click');
    expect(wrapper.get('[data-group-id="other-account-group"] h3').text()).toBe('New viewer crew');
    finishPrevious({ groups: [group('previous-account-group', 'Previous viewer crew')], total: 1 }); await flushPromises();
    expect(wrapper.find('[data-group-id="previous-account-group"]').exists()).toBe(false);
    expect(wrapper.get('[data-group-id="other-account-group"] h3').text()).toBe('New viewer crew');
    expect(api.setJoiningMode).not.toHaveBeenCalled(); expect(api.findGroupMatch).not.toHaveBeenCalled();
  });

  it('does not label an unknown primary status as a preference mismatch when discovery is empty', async () => {
    api.groupMatching.mockRejectedValueOnce(new Error('matching status unavailable'));
    api.discoverGroups.mockResolvedValue({ groups: [], total: 0, discovery: { state: 'groups_unavailable', eligibleCount: 0, filteredCount: 0 } });
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1&mode=direct' });
    expect(wrapper.get('[aria-label="Group discovery status"] h3').text()).toBe('Your current group status could not be checked');
    expect(wrapper.text()).not.toContain('No suitable groups found');
    api.groupMatching.mockResolvedValueOnce({ matching: { preferencesComplete: true, optedIn: false, state: 'idle' } });
    await button(wrapper, 'Retry matching status').trigger('click'); await flushPromises();
    expect(wrapper.get('.no-groups').text()).toBe('No suitable groups found');
    expect(api.setJoiningMode).not.toHaveBeenCalled(); expect(api.findGroupMatch).not.toHaveBeenCalled();
  });

  it('guides an account without concert plans to setup instead of claiming a preference mismatch', async () => {
    api.seekerRequest.mockResolvedValue({ request: null });
    api.discoverGroups.mockResolvedValue({ groups: [], total: 0, discovery: { state: 'no_eligible_groups', eligibleCount: 0, filteredCount: 0 } });
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1' });
    const empty = wrapper.get('[aria-label="Group discovery status"]');
    expect(wrapper.find('#group-search-setup').exists()).toBe(true);
    expect(empty.get('h3').text()).toBe('Save your concert plans to continue');
    expect(empty.get('a').attributes('href')).toBe('#group-search-setup');
    expect(wrapper.text()).not.toContain('No suitable groups found');
    expect(api.createRequest).not.toHaveBeenCalled(); expect(api.setJoiningMode).not.toHaveBeenCalled();
  });

  it.each(['list', 'comparison'])('requires the same accessible review before a %s request', async layout => {
    // Exercise real Teleport for keyboard containment and focus restoration.
    const { wrapper } = await mountExplorer({ path: '/groups?concertId=concert-1', stubs: { Teleport: false } });
    if (layout === 'list') await button(wrapper, 'See all').trigger('click');
    else await button(wrapper, 'Start comparing').trigger('click');
    const opener = button(wrapper, layout === 'list' ? 'Ask to join' : 'Request to join');
    opener.element.focus(); await opener.trigger('click'); await flushPromises();
    const review = dialog(wrapper);
    expect(review.attributes('aria-modal')).toBe('true');
    expect(review.attributes('aria-label')).toBe('Ask to join Supper crew?');
    expect(document.activeElement).toBe(button(review, 'Not yet').element);
    expect(api.requestGroupJoin).not.toHaveBeenCalled();
    const note = field(review, 'Say hi to the host');
    const send = button(review, 'Send request');
    // The jsdom selector engine can order a mixed selector list differently
    // from native Tab order. Test the handler's boundary in this environment;
    // browser regressions separately exercise natural traversal of all controls.
    const controls = [...review.element.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')];
    expect(controls).toHaveLength(3);
    expect(controls).toEqual(expect.arrayContaining([note.element, send.element, button(review, 'Not yet').element]));
    const first = controls[0], last = controls.at(-1);
    last.focus();
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    last.dispatchEvent(forward);
    await flushPromises();
    expect(forward.defaultPrevented).toBe(true); expect(document.activeElement).toBe(first);
    const backward = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    first.dispatchEvent(backward);
    await flushPromises();
    expect(backward.defaultPrevented).toBe(true); expect(document.activeElement).toBe(last);
    await review.trigger('keydown', { key: 'Escape' }); await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBe(null);
    expect(document.activeElement).toBe(opener.element);
    if (layout === 'comparison') {
      expect(wrapper.text()).toContain('No request sent to Supper crew.');
      expect(wrapper.text()).not.toContain('Your request to Supper crew was not sent. Review the message above');
    }
    expect(api.requestGroupJoin).not.toHaveBeenCalled();
  });
});
