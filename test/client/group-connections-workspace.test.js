import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import GroupConnectionsView from '../../client/src/views/GroupConnectionsView.vue';
import { api } from '../../client/src/api.js';
import { currentUser } from '../../client/src/auth.js';
import { button, field, group, mountPage } from './helpers.js';

const plans = ref([]);
vi.mock('../../client/src/composables/useMeetupSummaries.js', () => ({ useMeetupSummaries: () => ({ plans }) }));
vi.mock('../../client/src/api.js', async original => ({ ...await original(), api: {
  concerts: vi.fn(), hostedGroups: vi.fn(), groupConnections: vi.fn(), hostedGroupJoinRequests: vi.fn(), groupJoinRequests: vi.fn(),
  currentGroupMemberships: vi.fn(), myProposals: vi.fn(), createParty: vi.fn(), configureGroup: vi.fn(),
  connectionCandidates: vi.fn(), inviteGroup: vi.fn(), respondToGroup: vi.fn(), cancelGroupInvite: vi.fn(),
} }));
vi.mock('../../client/src/auth.js', async () => {
  const { ref } = await import('vue');
  return { currentUser: ref({ id: 'host', displayName: 'Host' }) };
});
vi.mock('../../client/src/components/GroupPreferencesGate.vue', () => ({ default: { template: '<div><slot name="before"/><slot/></div>' } }));

const concert = (id, date = '2026-11-05', extra = {}) => ({ id, artist: id, event_date: date, venue: 'Stadium', ...extra });
beforeEach(() => {
  vi.resetAllMocks(); plans.value = []; currentUser.value = { id: 'host', displayName: 'Host' };
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-03T16:30:00Z')); // 4 November, Singapore.
  api.concerts.mockResolvedValue({ concerts: [concert('future')] });
  api.hostedGroups.mockResolvedValue({ groups: [] });
  api.groupConnections.mockResolvedValue({ connections: [] });
  api.hostedGroupJoinRequests.mockResolvedValue({ requests: [] });
  api.groupJoinRequests.mockResolvedValue({ requests: [] });
  api.currentGroupMemberships.mockResolvedValue({ groups: [] });
  api.myProposals.mockResolvedValue({ proposals: [] });
  api.createParty.mockResolvedValue({ party: { id: 'new-group' } });
  api.configureGroup.mockResolvedValue({});
  api.connectionCandidates.mockResolvedValue({ groups: [], total: 0 });
});

describe('upcoming concert group creation', () => {
  it('lists date-only today and future concerts, excluding past dates and verified started performances', async () => {
    api.concerts.mockResolvedValue({ concerts: [
      concert('yesterday', '2026-11-03'), concert('today', '2026-11-04'), concert('future'),
      concert('started', '2026-11-04', { event_time: '00:00:00', event_timezone: 'Asia/Singapore' }),
      concert('later-today', '2026-11-04', { event_time: '20:00:00', event_timezone: 'Asia/Singapore' }),
    ] });
    const { wrapper } = await mountPage(GroupConnectionsView, { path: '/groups/connect?view=create' });
    const picker = field(wrapper, 'Concert');
    expect(picker.findAll('option').map(option => option.attributes('value'))).toEqual(['', 'today', 'future', 'later-today']);
    expect(picker.element.value).toBe('today');
    expect(button(wrapper, 'Create draft group').element.disabled).toBe(false);
  });

  it.each([
    [concert('past', '2026-11-03'), 'already finished'],
    [concert('past', '2026-11-04', { event_time: '00:00:00' }), 'already started'],
    [concert('past', 'not-a-date'), 'unavailable for a new group'],
  ])('rejects ineligible route preselection rather than silently choosing a different concert: %j', async (past, message) => {
    api.concerts.mockResolvedValue({ concerts: [past, concert('future')] });
    const { wrapper } = await mountPage(GroupConnectionsView, { path: '/groups/connect?view=create&concertId=past' });
    expect(wrapper.text()).toContain(message);
    expect(field(wrapper, 'Concert').element.value).toBe('');
    expect(button(wrapper, 'Create draft group').element.disabled).toBe(true);
    await wrapper.get('form').trigger('submit');
    expect(api.createParty).not.toHaveBeenCalled();
    await field(wrapper, 'Concert').setValue('future');
    expect(wrapper.find('#creation-concert-notice').exists()).toBe(false);
    expect(button(wrapper, 'Create draft group').element.disabled).toBe(false);
  });

  it('keeps an unknown route ID unselected and explains recovery', async () => {
    const { wrapper } = await mountPage(GroupConnectionsView, { path: '/groups/connect?view=create&concertId=missing' });
    expect(wrapper.text()).toContain('This concert is unavailable for a new group');
    expect(field(wrapper, 'Concert').element.value).toBe('');
    expect(button(wrapper, 'Create draft group').element.disabled).toBe(true);
  });

  it('shows a usable empty state and disables submission when no upcoming concert exists', async () => {
    api.concerts.mockResolvedValue({ concerts: [concert('past', '2026-11-03')] });
    const { wrapper } = await mountPage(GroupConnectionsView, { path: '/groups/connect?view=create' });
    expect(wrapper.text()).toContain('No upcoming concerts are available for a new group');
    expect(field(wrapper, 'Concert').element.disabled).toBe(true);
    expect(button(wrapper, 'Create draft group').element.disabled).toBe(true);
    await wrapper.get('form').trigger('submit'); expect(api.createParty).not.toHaveBeenCalled();
  });

  it('rechecks the cutoff at submission, even when a previously eligible page stays open overnight', async () => {
    api.concerts.mockResolvedValue({ concerts: [concert('today', '2026-11-04')] });
    const { wrapper } = await mountPage(GroupConnectionsView, { path: '/groups/connect?view=create' });
    await field(wrapper, 'Group name').setValue('My concert group');
    vi.setSystemTime(new Date('2026-11-04T16:00:00Z'));
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(api.createParty).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('This concert has already finished');
    expect(button(wrapper, 'Create draft group').element.disabled).toBe(true);
  });

  it('creates a future draft using existing form fields and does not add a preference prerequisite', async () => {
    const { wrapper, router } = await mountPage(GroupConnectionsView, { path: '/groups/connect?view=create&concertId=future' });
    await field(wrapper, 'Group name').setValue('My concert group');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(api.createParty).toHaveBeenCalledExactlyOnceWith('future', expect.objectContaining({ name: 'My concert group', capacity: 2 }));
    expect(api.configureGroup).toHaveBeenCalledExactlyOnceWith('new-group', { expectedFriends: 0 });
    expect(router.currentRoute.value.path).toBe('/groups/new-group/members');
  });

  it('opens the known created draft after configuration fails, allowing setup recovery instead of a second creation', async () => {
    api.configureGroup.mockRejectedValue(new Error('offline'));
    const { wrapper, router } = await mountPage(GroupConnectionsView, { path: '/groups/connect?view=create' });
    router.beforeEach(to => to.path.endsWith('/members') ? false : true);
    await field(wrapper, 'Group name').setValue('My concert group');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(wrapper.text()).toContain('Your draft group was created, but its settings still need to be saved');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.findAll('button').some(item => item.text() === 'Create draft group')).toBe(false);
    await button(wrapper, 'Open created group').trigger('click'); await flushPromises();
    expect(api.createParty).toHaveBeenCalledTimes(1);
    expect(api.configureGroup).toHaveBeenCalledTimes(1);
  });
});

describe('My groups context and persisted feedback', () => {
  it.each([false, true])('returns to My groups when sharing availability (existing=%s)', async existing => {
    api.hostedGroups.mockResolvedValue({ groups: [group('group-1', 'Front row crew')] });
    if (existing) plans.value = [{ id: 'plan-1', scope: { partyId: 'group-1' }, status: 'planning', hasAvailability: false }];
    const { wrapper, router } = await mountPage(GroupConnectionsView, { path: '/groups/connect' });
    await button(wrapper, existing ? 'Share availability' : 'Plan meetup').trigger('click'); await flushPromises();
    expect(router.currentRoute.value.query.from).toBe('groups');
    expect(router.currentRoute.value.path).toBe(existing ? '/meetups/plan-1' : '/meetups');
  });

  it('preserves historical groups while labelling the section without an inaccurate upcoming claim', async () => {
    api.hostedGroups.mockResolvedValue({ groups: [{ ...group('historic', 'Last concert friends'), eventDate: '2026-10-01' }] });
    const { wrapper, router } = await mountPage(GroupConnectionsView, { path: '/groups/connect' });
    expect(wrapper.text()).toContain('Last concert friends');
    expect(wrapper.text()).toContain('2026-10-01');
    expect(wrapper.text()).not.toContain('Your active groups');
    const createLink = wrapper.get('nav[aria-label="Group workflows"] a[href="/groups/connect?view=create"]');
    expect(createLink.text()).toBe('Create group');
    await createLink.trigger('click'); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/groups/connect');
    expect(router.currentRoute.value.query.view).toBe('create');
  });

  it('does not report a confirmed creation as failed when the following group-list refresh fails', async () => {
    const { wrapper } = await mountPage(GroupConnectionsView, { path: '/groups/connect?view=create' });
    api.hostedGroups.mockRejectedValueOnce(new Error('offline'));
    await field(wrapper, 'Group name').setValue('My concert group');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(wrapper.get('.group-success').text()).toBe('Group updated.');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('The update was saved, but the latest group details could not be loaded');
    await button(wrapper, 'Retry refresh').trigger('click'); await flushPromises();
    expect(api.createParty).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).not.toContain('latest group details could not be loaded');
  });
});

const own = () => group('own', 'Our concert crew');
const other = () => group('other', 'Balcony friends');
const invitation = (overrides = {}) => ({ id: 'connection-1', status: 'pending', incoming: false,
  initiatorPartyId: 'own', partyA: own(), partyB: other(), ...overrides });
const connectionsPath = '/groups/connect?view=connections&groupId=own&concertId=concert-1';
function setupConnections(records = []) {
  api.hostedGroups.mockResolvedValue({ groups: [own()] });
  api.connectionCandidates.mockResolvedValue({ groups: [other()], total: 1 });
  api.groupConnections.mockResolvedValue({ connections: records });
}
const dialogAction = async label => {
  const action = [...document.querySelectorAll('[role="dialog"] button')].find(element => element.textContent.trim() === label);
  expect(action).toBeTruthy(); action.click(); await flushPromises();
};

describe('first-time group connection feedback and next steps', () => {
  it('labels an unavailable sent invitation accurately while preserving allowed withdrawal', async () => {
    setupConnections([invitation({ canWithdraw: true,
      unavailableReason: 'This invitation is no longer available. The connection requirements have changed.' })]);
    const { wrapper } = await mountPage(GroupConnectionsView, { path: connectionsPath });
    expect(wrapper.get('.invite .connection-state').text()).toBe('This invitation is no longer available.');
    expect(button(wrapper, 'Withdraw pending invitation').element.disabled).toBe(false);
  });

  it('retains acceptance feedback but removes coordination access when the fresh server state revokes it', async () => {
    const received = invitation({ incoming: true, initiatorPartyId: 'other', canAccept: true, canDecline: true });
    setupConnections([received]);
    const accepted = { ...received, status: 'accepted', canAccept: false, canCoordinate: true };
    api.respondToGroup.mockResolvedValue({ connection: accepted });
    const { wrapper } = await mountPage(GroupConnectionsView, { path: connectionsPath });
    api.groupConnections.mockResolvedValue({ connections: [{ ...accepted, canCoordinate: false,
      unavailableReason: 'Shared coordination is currently unavailable. The current participation or safety settings prevent access.' }] });
    await button(wrapper, 'Accept').trigger('click'); await flushPromises();
    expect(wrapper.get('.group-success').text()).toContain('Connected with Balcony friends');
    expect(wrapper.get('[aria-label="Connection next step"]').text()).toContain('Shared coordination is currently unavailable.');
    expect(wrapper.find('a[href="/groups/connections/connection-1/channel"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Your shared chat is ready.');
    expect(wrapper.text()).not.toContain('Your groups can now talk');
  });

  it('distinguishes source-group recommendation limits, filter emptiness and discovery failures', async () => {
    setupConnections([invitation()]); api.connectionCandidates.mockResolvedValue({ groups: [], total: 0 });
    const { wrapper } = await mountPage(GroupConnectionsView, { path: connectionsPath });
    expect(wrapper.text()).toContain('No suitable groups are available to connect with right now.');
    expect(wrapper.text()).toContain('both groups’ preferences');
    expect(wrapper.text()).toContain('Your existing invitations and connections remain available above.');
    expect(wrapper.text()).toContain('Results are for Our concert crew at Test artist.');
    await wrapper.get('input[type="search"]').setValue('rare keyword');
    await new Promise(resolve => setTimeout(resolve, 280)); await flushPromises();
    expect(wrapper.text()).toContain('No groups match your filters');
    await button(wrapper, 'Clear connection filters').trigger('click');
    await new Promise(resolve => setTimeout(resolve, 280)); await flushPromises();
    expect(wrapper.get('input[type="search"]').element.value).toBe('');
    api.connectionCandidates.mockRejectedValue(new Error('discovery offline'));
    await button(wrapper, 'Check groups again').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Could not load groups to connect with.');
    expect(wrapper.text()).not.toContain('No suitable groups are available');
    expect(wrapper.get('.invite').text()).toContain('Invitation sent');
  });

  it('disables an invalid invitation using server capabilities while keeping its allowed decline', async () => {
    setupConnections([invitation({ incoming: true, initiatorPartyId: 'other', canAccept: false, canDecline: true,
      canWithdraw: false, canCoordinate: false,
      unavailableReason: 'This invitation is no longer available. The connection requirements have changed.' })]);
    const { wrapper } = await mountPage(GroupConnectionsView, { path: connectionsPath });
    expect(button(wrapper, 'Accept').element.disabled).toBe(true);
    expect(button(wrapper, 'Decline').element.disabled).toBe(false);
    expect(wrapper.get('.invite--received').text()).toContain('The connection requirements have changed.');
    expect(wrapper.get('#group-connections').element.compareDocumentPosition(wrapper.get('.group-grid').element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await button(wrapper, 'Accept').trigger('click');
    expect(api.respondToGroup).not.toHaveBeenCalled();
  });

  it('keeps accepted groups connected while hiding unavailable shared coordination actions', async () => {
    setupConnections([invitation({ status: 'accepted', canCoordinate: false,
      unavailableReason: 'Shared coordination is currently unavailable. The current participation or safety settings prevent access.' })]);
    plans.value = [{ id: 'shared-plan', scope: { connectionId: 'connection-1' }, status: 'planning' }];
    const { wrapper } = await mountPage(GroupConnectionsView, { path: connectionsPath });
    expect(wrapper.get('.connection').text()).toContain('Groups connected');
    expect(wrapper.get('.connection').text()).toContain('Shared coordination is currently unavailable.');
    expect(wrapper.find('a[href="/groups/connections/connection-1/channel"]').exists()).toBe(false);
    expect(wrapper.get('.connection__foot').findAll('button')).toHaveLength(0);
    expect(wrapper.text()).not.toMatch(/blocked_pair|blocked by|blocked you/i);
  });

  it('never revives an old group action acknowledgment after A → B → A navigation', async () => {
    setupConnections(); let finish;
    api.hostedGroups.mockResolvedValue({ groups: [own(), { ...group('second', 'Second crew'), concertId: 'concert-2' }] });
    api.inviteGroup.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { wrapper, router } = await mountPage(GroupConnectionsView, { path: connectionsPath });
    await button(wrapper, 'Invite group to connect').trigger('click');
    await router.push('/groups/connect?view=connections&groupId=second&concertId=concert-2'); await flushPromises();
    await router.push(connectionsPath); await flushPromises();
    api.groupConnections.mockResolvedValue({ connections: [invitation()] });
    finish({ connection: invitation() }); await flushPromises();
    expect(wrapper.find('[aria-label="Connection next step"]').exists()).toBe(false);
    expect(wrapper.find('.group-success').exists()).toBe(false);
    expect(wrapper.get('.invite').text()).toContain('Invitation sent — waiting for the other host');
    expect(api.inviteGroup).toHaveBeenCalledTimes(1);
  });

  it('keeps compatibility-reason search matches and server pagination totals', async () => {
    setupConnections();
    const reasonMatch = { ...other(), reasons: [{ label: 'Both love a loud singalong' }] };
    api.connectionCandidates.mockResolvedValue({ groups: [reasonMatch], total: 21 });
    const { wrapper } = await mountPage(GroupConnectionsView, { path: connectionsPath });
    await wrapper.get('input[type="search"]').setValue('singalong');
    await new Promise(resolve => setTimeout(resolve, 280)); await flushPromises();
    expect(api.connectionCandidates).toHaveBeenLastCalledWith('concert-1', 'own', expect.objectContaining({ q: 'singalong', offset: 0 }));
    expect(wrapper.get('.group-card').text()).toContain('Balcony friends');
    expect(wrapper.text()).toContain('21 results');
    expect(button(wrapper, 'Next 20').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('No groups match right now');
  });

  it('explains an invitation before sending and persists the specific card state after refresh', async () => {
    setupConnections();
    api.inviteGroup.mockImplementation(async () => {
      const connection = invitation(); api.groupConnections.mockResolvedValue({ connections: [connection] });
      return { connection };
    });
    const { wrapper, router } = await mountPage(GroupConnectionsView, { path: connectionsPath });
    expect(wrapper.get('[aria-label="How group connections work"]').text()).toContain('Their host replies');
    expect(wrapper.text()).toContain('A shared chat opens only after they accept.');
    await button(wrapper, 'Invite group to connect').trigger('click'); await flushPromises();
    expect(api.inviteGroup).toHaveBeenCalledExactlyOnceWith('own', 'other');
    expect(wrapper.get('.group-success').text()).toContain('Invitation sent to Balcony friends');
    expect(wrapper.get('.group-card').text()).toContain('Invitation sent — waiting for the other host');
    expect(wrapper.get('.group-card [role="status"]').text()).toContain('Invitation sent to Balcony friends');
    expect(wrapper.findAll('button').some(item => item.text() === 'Invite group to connect')).toBe(false);
    expect(wrapper.get('[aria-label="Connection next step"]').text()).toContain('Waiting for the other host');
    expect(router.currentRoute.value.fullPath).toBe(connectionsPath);
    wrapper.unmount();
    const refreshed = await mountPage(GroupConnectionsView, { path: connectionsPath });
    expect(refreshed.wrapper.get('.group-card').text()).toContain('Invitation sent — waiting for the other host');
    expect(refreshed.wrapper.find('[aria-label="Connection next step"]').exists()).toBe(false);
  });

  it('prioritizes received invitations and keeps the accepted shared-chat link after a failed refresh', async () => {
    const received = invitation({ incoming: true, initiatorPartyId: 'other' }); setupConnections([received]);
    api.respondToGroup.mockResolvedValue({ connection: { ...received, status: 'accepted' } });
    const { wrapper, router } = await mountPage(GroupConnectionsView, { path: connectionsPath });
    expect(wrapper.get('[aria-label="How group connections work"] a').attributes('href')).toBe('#group-connections');
    expect(wrapper.get('.group-card').text()).toContain('Invitation received — your reply is needed');
    expect(wrapper.get('.invite--received').text()).toContain('Invitation received — your reply is needed');
    expect(wrapper.get('.invite--received').text()).toContain('Your members stay in their existing group');
    api.groupConnections.mockRejectedValueOnce(new Error('offline'));
    await wrapper.get('button[aria-label="Accept the invitation from Balcony friends host"]').trigger('click'); await flushPromises();
    expect(api.respondToGroup).toHaveBeenCalledExactlyOnceWith('connection-1', 'accept');
    expect(wrapper.get('.group-success').text()).toContain('Connected with Balcony friends');
    expect(wrapper.text()).toContain('The update was saved, but the latest group details could not be loaded');
    const next = wrapper.get('[aria-label="Connection next step"]');
    expect(next.text()).toContain('Both hosts approve a shared meetup plan');
    const link = next.get('a'); expect(link.text()).toBe('Open shared chat');
    await link.trigger('click'); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/groups/connections/connection-1/channel');
  });

  it('requires deliberate decline and preserves the authoritative decision in history', async () => {
    const received = invitation({ incoming: true, initiatorPartyId: 'other' }); setupConnections([received]);
    api.respondToGroup.mockImplementation(async () => {
      const connection = { ...received, status: 'declined' }; api.groupConnections.mockResolvedValue({ connections: [connection] });
      return { connection };
    });
    const { wrapper } = await mountPage(GroupConnectionsView, { path: connectionsPath });
    await wrapper.get('button[aria-label="Decline the invitation from Balcony friends host"]').trigger('click');
    expect(api.respondToGroup).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]').textContent).toContain('invitation history');
    await dialogAction('Decline');
    expect(api.respondToGroup).toHaveBeenCalledExactlyOnceWith('connection-1', 'decline');
    expect(wrapper.get('.group-success').text()).toContain('Invitation from Balcony friends declined');
    expect(wrapper.text()).toContain('Declined invitations (1)');
    expect(wrapper.get('.group-card').text()).toContain('Invitation declined');
    expect(wrapper.findAll('a').some(item => item.text() === 'Open shared chat')).toBe(false);
  });

  it('withdraws only a pending sent invitation and permits a later invitation after the deleted row is refreshed', async () => {
    setupConnections([invitation()]);
    api.cancelGroupInvite.mockImplementation(async () => {
      api.groupConnections.mockResolvedValue({ connections: [] }); return { connection: { id: 'connection-1', status: 'cancelled' } };
    });
    const { wrapper } = await mountPage(GroupConnectionsView, { path: connectionsPath });
    expect(wrapper.findAll('button').some(item => item.text() === 'Accept')).toBe(false);
    await button(wrapper, 'Withdraw pending invitation').trigger('click');
    expect(api.cancelGroupInvite).not.toHaveBeenCalled(); await dialogAction('Cancel invitation');
    expect(api.cancelGroupInvite).toHaveBeenCalledExactlyOnceWith('connection-1');
    expect(wrapper.get('.group-success').text()).toContain('Invitation to Balcony friends withdrawn');
    expect(wrapper.get('[aria-label="Connection next step"]').text()).toContain('Invitation withdrawn');
    expect(button(wrapper, 'Invite group to connect').element.disabled).toBe(false);
  });

  it('keeps invitation failure distinct from success and exposes the backend prerequisite', async () => {
    setupConnections(); api.inviteGroup.mockRejectedValue(Object.assign(new Error('group_not_open_to_connections'), { status: 409 }));
    const { wrapper } = await mountPage(GroupConnectionsView, { path: connectionsPath });
    await button(wrapper, 'Invite group to connect').trigger('click'); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Both groups must be published and open');
    expect(wrapper.find('.group-success').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Connection next step"]').exists()).toBe(false);
    expect(button(wrapper, 'Invite group to connect').element.disabled).toBe(false);
  });

  it('does not expose discovery or host invitation actions for a group the user does not own', async () => {
    api.currentGroupMemberships.mockResolvedValue({ groups: [own()] });
    const { wrapper } = await mountPage(GroupConnectionsView, { path: connectionsPath });
    expect(wrapper.text()).toContain('not owned by you');
    expect(api.connectionCandidates).not.toHaveBeenCalled();
    expect(api.inviteGroup).not.toHaveBeenCalled();
    expect(wrapper.findAll('button').some(item => item.text() === 'Invite group to connect')).toBe(false);
  });

  it('directs an unpublished host to setup instead of presenting an invitation that cannot succeed', async () => {
    api.hostedGroups.mockResolvedValue({ groups: [{ ...own(), settings: { published: false, connect_open: true } }] });
    const { wrapper } = await mountPage(GroupConnectionsView, { path: connectionsPath });
    expect(wrapper.text()).toContain('Publish this group and enable');
    expect(wrapper.get('.selected-group a').attributes('href')).toBe('/groups/own/members');
    expect(api.connectionCandidates).not.toHaveBeenCalled();
    expect(wrapper.findAll('button').some(item => item.text() === 'Invite group to connect')).toBe(false);
  });

  it('ignores an old account’s late invitation result', async () => {
    setupConnections(); let resolve;
    api.inviteGroup.mockImplementation(() => new Promise(done => { resolve = done; }));
    const { wrapper } = await mountPage(GroupConnectionsView, { path: connectionsPath });
    await button(wrapper, 'Invite group to connect').trigger('click');
    api.hostedGroups.mockResolvedValue({ groups: [] }); currentUser.value = { id: 'new-user' }; await flushPromises();
    resolve({ connection: invitation() }); await flushPromises();
    expect(wrapper.find('.group-success').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Connection next step"]').exists()).toBe(false);
    expect(wrapper.find('.group-card').exists()).toBe(false);
  });
});
