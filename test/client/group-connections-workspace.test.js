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
  concerts: vi.fn(), hostedGroups: vi.fn(), hostedGroupJoinRequests: vi.fn(), groupJoinRequests: vi.fn(),
  currentGroupMemberships: vi.fn(), myProposals: vi.fn(), createParty: vi.fn(), configureGroup: vi.fn(), withdrawGroupJoin: vi.fn(),
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
  api.hostedGroupJoinRequests.mockResolvedValue({ requests: [] });
  api.groupJoinRequests.mockResolvedValue({ requests: [] });
  api.currentGroupMemberships.mockResolvedValue({ groups: [] });
  api.myProposals.mockResolvedValue({ proposals: [] });
  api.createParty.mockResolvedValue({ party: { id: 'new-group' } });
  api.configureGroup.mockResolvedValue({});
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
    expect(button(wrapper, 'Create group').element.disabled).toBe(false);
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
    expect(button(wrapper, 'Create group').element.disabled).toBe(true);
    await wrapper.get('form').trigger('submit');
    expect(api.createParty).not.toHaveBeenCalled();
    await field(wrapper, 'Concert').setValue('future');
    expect(wrapper.find('#creation-concert-notice').exists()).toBe(false);
    expect(button(wrapper, 'Create group').element.disabled).toBe(false);
  });

  it('keeps an unknown route ID unselected and explains recovery', async () => {
    const { wrapper } = await mountPage(GroupConnectionsView, { path: '/groups/connect?view=create&concertId=missing' });
    expect(wrapper.text()).toContain('This concert is unavailable for a new group');
    expect(field(wrapper, 'Concert').element.value).toBe('');
    expect(button(wrapper, 'Create group').element.disabled).toBe(true);
  });

  it('shows a usable empty state and disables submission when no upcoming concert exists', async () => {
    api.concerts.mockResolvedValue({ concerts: [concert('past', '2026-11-03')] });
    const { wrapper } = await mountPage(GroupConnectionsView, { path: '/groups/connect?view=create' });
    expect(wrapper.text()).toContain('No upcoming concerts are available for a new group');
    expect(field(wrapper, 'Concert').element.disabled).toBe(true);
    expect(button(wrapper, 'Create group').element.disabled).toBe(true);
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
    expect(button(wrapper, 'Create group').element.disabled).toBe(true);
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
    expect(wrapper.text()).toContain('Your group was created, but its settings still need to be saved');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.findAll('button').some(item => item.text() === 'Create group')).toBe(false);
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

  it('hides groups whose concert has passed and offers group creation from the heading', async () => {
    api.hostedGroups.mockResolvedValue({ groups: [{ ...group('historic', 'Last concert friends'), eventDate: '2000-10-01' }] });
    const { wrapper, router } = await mountPage(GroupConnectionsView, { path: '/groups/connect' });
    expect(wrapper.text()).not.toContain('Last concert friends');
    expect(wrapper.text()).toContain('No groups owned');
    expect(wrapper.text()).not.toContain('Your active groups');
    const createLink = wrapper.get('.page-heading a[href="/groups/connect?view=create"]');
    expect(createLink.text()).toBe('+ Create group');
    expect(wrapper.find('nav[aria-label="Group workflows"] a[href="/groups/connect?view=create"]').exists()).toBe(false);
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

describe('requests sent from Find a group', () => {
  it('confirms a just-sent request and cancels it from My groups', async () => {
    const request = { id: 'request-1', userId: 'host', status: 'pending', concertId: 'concert-1', partyId: 'g1', groupName: 'Supper crew',
      hostName: 'Sam', artist: 'Test artist', seatReserved: true, createdAt: '2026-11-04T10:00:00Z', expiresAt: '2026-11-06T10:00:00Z' };
    api.groupJoinRequests.mockResolvedValue({ requests: [request] });
    api.withdrawGroupJoin.mockImplementation(async () => { api.groupJoinRequests.mockResolvedValue({ requests: [] }); return {}; });
    const { wrapper } = await mountPage(GroupConnectionsView, { path: '/groups/connect?sent=1' });
    expect(wrapper.get('.group-success').text()).toContain('Request sent.');
    const section = wrapper.get('[aria-labelledby="my-requests-heading"]');
    expect(section.text()).toContain('Supper crew');
    expect(section.text()).toContain('expires');
    await button(section, 'Cancel request').trigger('click'); await flushPromises();
    expect(api.withdrawGroupJoin).toHaveBeenCalledExactlyOnceWith('request-1');
    expect(wrapper.get('.group-success').text()).toContain('Request cancelled.');
    expect(wrapper.find('[aria-labelledby="my-requests-heading"]').exists()).toBe(false);
  });
});
