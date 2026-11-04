import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import GroupConnectionsView from '../../client/src/views/GroupConnectionsView.vue';
import AvatarPicker from '../../client/src/components/AvatarPicker.vue';
import GroupPreferencesGate from '../../client/src/components/GroupPreferencesGate.vue';
import { api } from '../../client/src/api.js';
import { currentUser } from '../../client/src/auth.js';
import { button, field, group, mountPage } from './helpers.js';

const plans = ref([]);
vi.mock('../../client/src/composables/useMeetupSummaries.js', () => ({ useMeetupSummaries: () => ({ plans }) }));
vi.mock('../../client/src/api.js', async original => ({ ...await original(), api: {
  concerts: vi.fn(), hostedGroups: vi.fn(), groupConnections: vi.fn(), hostedGroupJoinRequests: vi.fn(),
  groupJoinRequests: vi.fn(),
  currentGroupMemberships: vi.fn(), myProposals: vi.fn(), groupMembership: vi.fn(), connectionCandidates: vi.fn(),
  createParty: vi.fn(), configureGroup: vi.fn(), setGroupImage: vi.fn(),
} }));
vi.mock('../../client/src/auth.js', async () => {
  const { ref } = await import('vue');
  return { currentUser: ref({ id: 'host', displayName: 'Host' }) };
});
vi.mock('../../client/src/components/GroupPreferencesGate.vue', () => ({ default: { template: '<div><slot name="before"/><slot/></div>' } }));

const upcomingConcert = id => ({ id, artist: id, event_date: '2026-11-05', venue: 'Stadium' });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const endpointDefaults = {
  concerts: { concerts: [upcomingConcert('concert-1')] }, hostedGroups: { groups: [] },
  groupConnections: { connections: [] }, hostedGroupJoinRequests: { requests: [] },
  groupJoinRequests: { requests: [] },
  currentGroupMemberships: { groups: [] }, myProposals: { proposals: [] },
};

beforeEach(() => {
  vi.resetAllMocks(); plans.value = []; currentUser.value = { id: 'host', displayName: 'Host' };
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
  for (const [endpoint, value] of Object.entries(endpointDefaults)) api[endpoint].mockResolvedValue(value);
  api.groupMembership.mockResolvedValue({ group: { settings: { published: true, connect_open: true } } });
  api.connectionCandidates.mockResolvedValue({ groups: [], total: 0 });
  api.createParty.mockResolvedValue({ party: { id: 'new-group' } });
  api.configureGroup.mockResolvedValue({}); api.setGroupImage.mockResolvedValue({});
});

describe('independent group workspace reads', () => {
  it('does not claim an empty pending queue when a refresh fails and only historical requests are known', async () => {
    api.hostedGroups.mockResolvedValue({ groups: [group('owned', 'Our crew')] });
    api.hostedGroupJoinRequests.mockResolvedValue({ requests: [{ id: 'past', hostId: 'host', partyId: 'owned',
      status: 'accepted', seekerName: 'Previous companion', artist: 'Test artist' }] });
    const { wrapper } = await mountPage(GroupConnectionsView, { path: '/groups/connect' });
    expect(wrapper.get('#join-requests').text()).toContain('No pending requests to join your groups.');
    api.hostedGroupJoinRequests.mockRejectedValue(new Error('queue unavailable'));
    wrapper.findComponent(GroupPreferencesGate).vm.$emit('saved'); await flushPromises();
    expect(wrapper.text()).toContain('Could not load applications.');
    expect(wrapper.get('#join-requests').text()).toContain('Some request details are unavailable');
    expect(wrapper.get('#join-requests').text()).not.toContain('No pending requests to join your groups.');
    expect(wrapper.text()).toContain('Past join requests (1)');
  });

  it('labels request queue totals as incomplete when one independent source fails', async () => {
    api.hostedGroups.mockResolvedValue({ groups: [group('owned', 'Our crew')] });
    api.hostedGroupJoinRequests.mockRejectedValue(new Error('applications offline'));
    api.myProposals.mockResolvedValue({ proposals: [{ id: 'offer', role: 'host', status: 'proposed', partyId: 'owned',
      hostName: 'Host', seekerName: 'Companion', artist: 'Test artist', hostApproved: true, queueStatus: 'held', seatReserved: true }] });
    const { wrapper } = await mountPage(GroupConnectionsView, { path: '/groups/connect' });
    expect(wrapper.get('#join-requests').text()).toContain('Some request details are unavailable');
    expect(wrapper.get('.queue-summary').text()).toContain('1 loaded requests');
    expect(wrapper.get('#join-requests').text()).not.toContain('1 in your queues');
    expect(wrapper.get('.owned-card').text()).toContain('Request status could not be fully checked.');
    expect(wrapper.findAll('a').some(link => link.text() === 'Review requests')).toBe(false);
  });

  it('keeps every owned group visible when one setup read fails and retries only that group', async () => {
    api.hostedGroups.mockResolvedValue({ groups: [
      { ...group('first', 'First crew'), settings: undefined },
      { ...group('second', 'Second crew'), settings: undefined },
    ] });
    api.groupMembership.mockImplementation(async id => {
      if (id === 'first') throw new Error('first setup offline');
      return { group: { settings: { published: true, connect_open: true } } };
    });
    const { wrapper, router } = await mountPage(GroupConnectionsView, { path: '/groups/connect' });
    const cards = wrapper.findAll('.owned-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].text()).toContain('Setup unavailable');
    expect(cards[0].text()).not.toContain('Draft');
    expect(cards[1].text()).toContain('Published');
    expect(wrapper.find('a[href="/groups/first/channel"]').exists()).toBe(true);
    await router.push('/groups/connect?view=connections&groupId=first'); await flushPromises();
    expect(wrapper.get('.selected-group .group-state').text()).toBe('Setup unavailable');
    expect(wrapper.get('.selected-group').text()).not.toContain('Draft');
    api.groupMembership.mockResolvedValue({ group: { settings: { published: true, connect_open: false } } });
    await button(wrapper, 'Retry First crew setup').trigger('click'); await flushPromises();
    expect(api.groupMembership.mock.calls.map(([id]) => id)).toEqual(['first', 'second', 'first']);
    expect(api.hostedGroups).toHaveBeenCalledTimes(1);
    expect(wrapper.get('.selected-group .group-state').text()).toBe('Published');
    await router.push('/groups/connect'); await flushPromises();
    expect(wrapper.findAll('.owned-card')[0].text()).toContain('Published');
    expect(wrapper.text()).not.toContain('Setup unavailable');
  });

  it('retains an authorized received invitation when the independent owned-group read fails', async () => {
    const partyA = group('other', 'Other crew'), partyB = group('own', 'Our crew');
    api.hostedGroups.mockRejectedValue(new Error('owned list offline'));
    api.groupConnections.mockResolvedValue({ connections: [{ id: 'received', partyA, partyB,
      initiatorPartyId: 'other', incoming: true, status: 'pending', canAccept: true, canDecline: true }] });
    const { wrapper } = await mountPage(GroupConnectionsView, { path: '/groups/connect?view=connections&groupId=own&connectionId=received' });
    expect(wrapper.get('.invite--received').text()).toContain('Other crew');
    expect(button(wrapper, 'Accept').element.disabled).toBe(false);
    expect(api.connectionCandidates).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain('notification’s item is no longer available');
    expect(document.activeElement.id).toBe('group-connection-received');
  });

  it('does not claim a notification item is gone until its own read succeeds', async () => {
    api.hostedGroupJoinRequests.mockRejectedValueOnce(new Error('queue offline'));
    const { wrapper } = await mountPage(GroupConnectionsView, { path: '/groups/connect?groupId=own&requestId=old-request' });
    expect(wrapper.text()).toContain('Could not load applications.');
    expect(wrapper.text()).not.toContain('notification’s item is no longer available');
    await button(wrapper, 'Retry applications').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('This notification’s item is no longer available here.');
  });

  it('keeps owned and joined conversations available when the concert catalogue fails', async () => {
    api.concerts.mockRejectedValue(new Error('catalogue offline'));
    api.hostedGroups.mockResolvedValue({ groups: [group('owned', 'Owned crew')] });
    api.currentGroupMemberships.mockResolvedValue({ groups: [{ ...group('joined', 'Joined crew'), source: 'friend' }] });
    const { wrapper } = await mountPage(GroupConnectionsView, { path: '/groups/connect' });
    expect(wrapper.text()).toContain('Owned crew'); expect(wrapper.text()).toContain('Joined crew');
    expect(wrapper.find('a[href="/groups/owned/channel"]').exists()).toBe(true);
    expect(wrapper.find('a[href="/groups/joined/channel"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Could not load concerts.');
    expect(wrapper.text()).not.toContain("'s group ·  places remaining");
  });

  it('shows existing groups before a slow catalogue request completes', async () => {
    const catalogue = deferred(); api.concerts.mockReturnValue(catalogue.promise);
    api.hostedGroups.mockResolvedValue({ groups: [group('owned', 'Available already')] });
    const { wrapper } = await mountPage(GroupConnectionsView, { path: '/groups/connect' });
    expect(wrapper.text()).toContain('Available already');
    expect(wrapper.find('a[href="/groups/owned/members"]').exists()).toBe(true);
    catalogue.resolve(endpointDefaults.concerts); await flushPromises();
  });

  it('keeps the creation catalogue usable when owned-group loading fails', async () => {
    api.hostedGroups.mockRejectedValue(new Error('groups offline'));
    const { wrapper } = await mountPage(GroupConnectionsView, { path: '/groups/connect?view=create' });
    expect(field(wrapper, 'Concert').element.value).toBe('concert-1');
    expect(button(wrapper, 'Create draft group').element.disabled).toBe(false);
    expect(wrapper.text()).toContain('Could not load owned groups.');
    expect(wrapper.text()).not.toContain('No upcoming groups you own');
  });

  it.each([
    ['concerts', 'concerts'], ['hostedGroups', 'owned groups'], ['currentGroupMemberships', 'joined groups'],
    ['groupConnections', 'invitations'], ['hostedGroupJoinRequests', 'applications'], ['myProposals', 'automatic offers'],
  ])('retries only the failed %s source', async (endpoint, label) => {
    api[endpoint].mockRejectedValueOnce(new Error('offline'));
    const { wrapper } = await mountPage(GroupConnectionsView, { path: '/groups/connect' });
    expect(wrapper.text()).toContain(`Could not load ${label}.`);
    await button(wrapper, `Retry ${label}`).trigger('click'); await flushPromises();
    expect(api[endpoint]).toHaveBeenCalledTimes(2);
    for (const other of Object.keys(endpointDefaults).filter(key => key !== endpoint)) expect(api[other]).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).not.toContain(`Could not load ${label}.`);
  });

  it('recovers the catalogue alone after both the catalogue and group data fail', async () => {
    for (const endpoint of Object.keys(endpointDefaults)) api[endpoint].mockRejectedValueOnce(new Error('offline'));
    const { wrapper } = await mountPage(GroupConnectionsView, { path: '/groups/connect?view=create' });
    expect(wrapper.text()).toContain('Could not load concerts.');
    expect(wrapper.text()).toContain('Could not load owned groups.');
    expect(button(wrapper, 'Create draft group').element.disabled).toBe(true);
    await button(wrapper, 'Retry concerts').trigger('click'); await flushPromises();
    expect(button(wrapper, 'Create draft group').element.disabled).toBe(false);
    expect(wrapper.text()).toContain('Could not load owned groups.');
    expect(api.hostedGroups).toHaveBeenCalledTimes(1);
  });

  it('discards a previous account response before requesting private membership details', async () => {
    const old = deferred();
    api.hostedGroups.mockReturnValueOnce(old.promise).mockResolvedValue({ groups: [group('new-group', 'New account crew')] });
    const { wrapper } = await mountPage(GroupConnectionsView, { path: '/groups/connect' });
    currentUser.value = { id: 'new-account', displayName: 'New account' }; await flushPromises();
    old.resolve({ groups: [{ ...group('old-group', 'Old account private crew'), settings: undefined }] }); await flushPromises();
    expect(wrapper.text()).toContain('New account crew');
    expect(wrapper.text()).not.toContain('Old account private crew');
    expect(api.groupMembership).not.toHaveBeenCalled();
  });

  it('uses the current route selection after a pending catalogue read completes', async () => {
    const catalogue = deferred(); api.concerts.mockReturnValue(catalogue.promise);
    const { wrapper, router } = await mountPage(GroupConnectionsView, { path: '/groups/connect?view=create&concertId=first' });
    await router.push('/groups/connect?view=create&concertId=second');
    catalogue.resolve({ concerts: [upcomingConcert('first'), upcomingConcert('second')] }); await flushPromises();
    expect(field(wrapper, 'Concert').element.value).toBe('second');
  });

  it('discards connection candidates from the group that the user has left', async () => {
    const old = deferred(); api.connectionCandidates.mockReturnValueOnce(old.promise).mockResolvedValue({ groups: [], total: 0 });
    api.hostedGroups.mockResolvedValue({ groups: [group('first', 'First crew'), group('second', 'Second crew')] });
    const { wrapper, router } = await mountPage(GroupConnectionsView, { path: '/groups/connect?view=connections&groupId=first' });
    expect(api.connectionCandidates).toHaveBeenCalledTimes(1);
    await router.push('/groups/connect?view=connections&groupId=second'); await flushPromises();
    old.resolve({ groups: [group('old-candidate', 'Stale candidate')], total: 1 }); await flushPromises();
    expect(wrapper.get('.selected-group').text()).toContain('Second crew');
    expect(wrapper.text()).not.toContain('Stale candidate');
  });
});

describe('honest historical group presentation', () => {
  it('separates past, current-day, future and cancelled groups without hiding old conversations', async () => {
    api.hostedGroups.mockResolvedValue({ groups: [
      group('future', 'Next concert crew'), { ...group('ongoing', 'Tonight crew'), eventDate: '2026-11-04', eventTime: '08:00:00' },
      { ...group('past', 'Old concert crew'), eventDate: '2026-11-03' }, { ...group('cancelled', 'Cancelled crew'), status: 'cancelled' },
    ] });
    const { wrapper } = await mountPage(GroupConnectionsView, { path: '/groups/connect' });
    expect(wrapper.findAll('.owned-card')).toHaveLength(2);
    expect(wrapper.get('#historical-groups').text()).toContain('Old concert crew');
    expect(wrapper.get('#historical-groups').text()).toContain('Past concert');
    expect(wrapper.get('#historical-groups').find('a[href="/groups/past/channel"]').exists()).toBe(true);
    expect(wrapper.get('#historical-groups').findAll('button')).toHaveLength(0);
    expect(wrapper.text()).toContain('Cancelled groups (1)');
    expect(wrapper.get('#owned-heading').element.parentElement.textContent).toContain('2 upcoming or ongoing');
  });

  it('uses the event timezone for ongoing joined groups and keeps historical meetup access', async () => {
    vi.setSystemTime(new Date('2026-11-04T01:00:00Z')); // Los Angeles is still on 3 November.
    api.currentGroupMemberships.mockResolvedValue({ groups: [
      { id: 'la', name: 'Los Angeles crew', artist: 'LA artist', eventDate: '2026-11-03', eventTimezone: 'America/Los_Angeles', source: 'friend' },
      { id: 'sg', name: 'Singapore history', artist: 'SG artist', eventDate: '2026-11-03', eventTimezone: 'Asia/Singapore', source: 'friend' },
    ] });
    plans.value = [{ id: 'old-plan', scope: { partyId: 'sg' }, status: 'confirmed', endsAt: Date.now() - 1000 }];
    const { wrapper, router } = await mountPage(GroupConnectionsView, { path: '/groups/connect' });
    expect(wrapper.get('.owned-card--joined').text()).toContain('Los Angeles crew');
    expect(wrapper.get('#historical-groups').text()).toContain('Singapore history');
    await button(wrapper, 'View meetup history').trigger('click'); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/meetups/old-plan');
    expect(router.currentRoute.value.query.from).toBe('groups');
  });

  it('keeps date-unavailable records visible without labelling them upcoming or cancelled', async () => {
    api.hostedGroups.mockResolvedValue({ groups: [{ ...group('undated', 'Undated crew'), eventDate: 'bad-date' }] });
    const { wrapper } = await mountPage(GroupConnectionsView, { path: '/groups/connect' });
    expect(wrapper.get('#historical-groups').text()).toContain('Date unavailable');
    expect(wrapper.text()).toContain('Past concerts & undated groups (1)');
    expect(wrapper.findAll('.owned-card')).toHaveLength(0);
    expect(wrapper.text()).not.toContain('Cancelled groups');
  });

  it('disables historical invitation acceptance while preserving decline and shared chat access', async () => {
    const partyA = { ...group('a', 'Old sender'), eventDate: '2026-11-03' };
    const partyB = { ...group('b', 'Old receiver'), eventDate: '2026-11-03' };
    api.groupConnections.mockResolvedValue({ connections: [
      { id: 'pending', partyA, partyB, initiatorPartyId: 'a', incoming: true, status: 'pending' },
      { id: 'connected', partyA, partyB, initiatorPartyId: 'a', incoming: false, status: 'accepted' },
    ] });
    const { wrapper } = await mountPage(GroupConnectionsView, { path: '/groups/connect' });
    expect(button(wrapper, 'Accept').element.disabled).toBe(true);
    expect(button(wrapper, 'Decline').element.disabled).toBe(false);
    expect(wrapper.text()).toContain('This concert is unavailable for new connections');
    expect(wrapper.find('a[href="/groups/connections/connected/channel"]').exists()).toBe(true);
    expect(wrapper.get('.connection__foot').findAll('button')).toHaveLength(0);
  });

  it('keeps ongoing groups available after performance start while showing only existing meetup access', async () => {
    const ongoing = id => ({ ...group(id, `${id} crew`), eventDate: '2026-11-04', eventTime: '08:00:00', eventTimezone: 'Asia/Singapore' });
    const owned = ongoing('owned'), joined = { ...ongoing('joined'), source: 'friend' };
    api.hostedGroups.mockResolvedValue({ groups: [owned] });
    api.currentGroupMemberships.mockResolvedValue({ groups: [joined] });
    api.groupConnections.mockResolvedValue({ connections: [{ id: 'shared', partyA: owned, partyB: ongoing('other'), initiatorPartyId: 'owned', status: 'accepted' }] });
    const { wrapper, router } = await mountPage(GroupConnectionsView, { path: '/groups/connect' });
    expect(wrapper.findAll('.owned-card')).toHaveLength(2);
    expect(wrapper.findAll('button').some(item => item.text() === 'Plan meetup')).toBe(false);
    const plan = (id, scope) => ({ id, scope, status: 'confirmed', endsAt: Date.now() - 1000 });
    plans.value = [plan('own-plan', { partyId: 'owned' }), plan('joined-plan', { partyId: 'joined' }), plan('shared-plan', { connectionId: 'shared' })]; await flushPromises();
    expect(wrapper.findAll('button').filter(item => item.text() === 'View meetup details')).toHaveLength(3);
    plans.value = []; await router.push('/groups/connect?view=connections&groupId=owned'); await flushPromises();
    expect(wrapper.findAll('button').some(item => item.text() === 'Plan meetup')).toBe(false);
    plans.value = [plan('own-plan', { partyId: 'owned' })]; await flushPromises();
    expect(wrapper.get('.selected-group').text()).toContain('View meetup details');
  });
});

describe('known and uncertain group creation recovery', () => {
  async function creationPage() {
    const page = await mountPage(GroupConnectionsView, { path: '/groups/connect?view=create' });
    await field(page.wrapper, 'Group name').setValue('My concert crew');
    return page;
  }
  async function submit(wrapper) { await wrapper.get('form').trigger('submit'); await flushPromises(); }

  it('shows an optional image failure while preserving the created draft and its management link', async () => {
    api.setGroupImage.mockRejectedValue(new Error('image unavailable'));
    const { wrapper, router } = await creationPage();
    wrapper.findComponent(AvatarPicker).vm.$emit('select', 'data:image/png;base64,example');
    await submit(wrapper);
    expect(api.createParty).toHaveBeenCalledTimes(1);
    expect(api.setGroupImage).toHaveBeenCalledWith('new-group', 'data:image/png;base64,example');
    expect(wrapper.text()).toContain('its picture could not be saved; add a picture in Manage group');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(router.currentRoute.value.path).toBe('/groups/connect');
    await button(wrapper, 'Open created group').trigger('click'); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/groups/new-group/members');
    expect(api.createParty).toHaveBeenCalledTimes(1);
  });

  it('keeps both setup warnings visible and does not repeat either mutation when reopening', async () => {
    api.configureGroup.mockRejectedValue(new Error('settings unavailable')); api.setGroupImage.mockRejectedValue(new Error('image unavailable'));
    const { wrapper, router } = await creationPage();
    wrapper.findComponent(AvatarPicker).vm.$emit('select', 'data:image/png;base64,example');
    await submit(wrapper);
    expect(wrapper.text()).toContain('its settings still need to be saved in Manage group');
    expect(wrapper.text()).toContain('its picture could not be saved');
    await button(wrapper, 'Open created group').trigger('click'); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/groups/new-group/members');
    expect(api.configureGroup).toHaveBeenCalledTimes(1); expect(api.setGroupImage).toHaveBeenCalledTimes(1);
  });

  it('retains partial setup warnings when opening the known group is blocked', async () => {
    api.setGroupImage.mockRejectedValue(new Error('image unavailable'));
    const { wrapper, router } = await creationPage();
    router.beforeEach(to => to.path.endsWith('/members') ? false : true);
    wrapper.findComponent(AvatarPicker).vm.$emit('select', 'data:image/png;base64,example'); await submit(wrapper);
    await button(wrapper, 'Open created group').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('its picture could not be saved');
    expect(wrapper.text()).toContain('The page could not open; try Open created group again.');
    expect(api.createParty).toHaveBeenCalledTimes(1); expect(api.setGroupImage).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 409])('reconciles a lost or conflicted creation response against the sole owned concert group (status=%s)', async status => {
    const { wrapper, router } = await creationPage();
    api.createParty.mockRejectedValue(Object.assign(new Error(status ? 'already_in_concert_group' : 'network interrupted'), { status }));
    api.hostedGroups.mockResolvedValue({ groups: [{ ...group('persisted', 'Persisted crew'), status: 'draft' }] });
    await submit(wrapper);
    expect(wrapper.text()).toContain('A group you own for this concert was found');
    expect(wrapper.text()).toContain('no second group was created');
    expect(api.configureGroup).not.toHaveBeenCalled(); expect(api.setGroupImage).not.toHaveBeenCalled();
    await button(wrapper, 'Open created group').trigger('click'); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/groups/persisted/members');
    expect(api.createParty).toHaveBeenCalledTimes(1);
  });

  it('blocks another POST until an uncertain creation can be reconciled after a read outage', async () => {
    const { wrapper } = await creationPage();
    api.createParty.mockRejectedValue(new TypeError('network interrupted')); api.hostedGroups.mockRejectedValue(new Error('read unavailable'));
    await submit(wrapper);
    expect(wrapper.text()).toContain('creation response was interrupted');
    expect(button(wrapper, 'Create draft group').element.disabled).toBe(true);
    await submit(wrapper);
    expect(api.createParty).toHaveBeenCalledTimes(1);
    api.hostedGroups.mockResolvedValue({ groups: [{ ...group('persisted', 'Persisted crew'), status: 'draft' }] });
    await button(wrapper, 'Check group creation').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('A group you own for this concert was found');
    expect(api.createParty).toHaveBeenCalledTimes(1);
  });

  it('keeps input and permits a deliberate retry when no created group is found', async () => {
    const { wrapper } = await creationPage();
    api.createParty.mockRejectedValueOnce(new TypeError('network interrupted'));
    await submit(wrapper);
    expect(wrapper.text()).toContain('No created group was found. Your answers are kept');
    expect(wrapper.find('.group-success').exists()).toBe(false);
    expect(field(wrapper, 'Group name').element.value).toBe('My concert crew');
    expect(button(wrapper, 'Create draft group').element.disabled).toBe(false);
    await submit(wrapper); expect(api.createParty).toHaveBeenCalledTimes(2);
  });

  it('explains an existing concert-group conflict when no owned group can be recovered', async () => {
    const { wrapper } = await creationPage();
    api.createParty.mockRejectedValue(Object.assign(new Error('already_in_concert_group'), { status: 409 }));
    await submit(wrapper);
    expect(wrapper.text()).toContain('already belong to another group for this concert');
    expect(wrapper.text()).toContain('Review Groups I joined in My groups');
    expect(wrapper.text()).not.toContain('No created group was found');
  });

  it('does not redirect away from a newer route after an earlier creation completes', async () => {
    const creation = deferred(); api.createParty.mockReturnValue(creation.promise);
    const { wrapper, router } = await creationPage();
    await wrapper.get('form').trigger('submit'); await router.push('/groups/connect');
    creation.resolve({ party: { id: 'created-after-navigation' } }); await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/groups/connect');
    expect(api.configureGroup).toHaveBeenCalledWith('created-after-navigation', { expectedFriends: 0 });
    expect(api.createParty).toHaveBeenCalledTimes(1);
  });

  it('does not continue another account setup or redirect when the user switches during creation', async () => {
    const creation = deferred(); api.createParty.mockReturnValue(creation.promise);
    const { wrapper, router } = await creationPage();
    await wrapper.get('form').trigger('submit');
    currentUser.value = { id: 'new-account', displayName: 'New account' }; await flushPromises();
    creation.resolve({ party: { id: 'old-account-group' } }); await flushPromises();
    expect(api.configureGroup).not.toHaveBeenCalled(); expect(api.setGroupImage).not.toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe('/groups/connect');
    expect(field(wrapper, 'Group name').element.value).toBe('');
    expect(wrapper.text()).not.toContain('Your group is ready to open');
  });

  it('does not submit two creation requests while the first is pending', async () => {
    const creation = deferred(); api.createParty.mockReturnValue(creation.promise);
    const { wrapper } = await creationPage();
    await wrapper.get('form').trigger('submit'); await wrapper.get('form').trigger('submit');
    expect(api.createParty).toHaveBeenCalledTimes(1);
    creation.resolve({ party: { id: 'only-group' } }); await flushPromises();
  });
});
