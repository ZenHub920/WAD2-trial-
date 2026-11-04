import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import GroupMembershipView from '../../client/src/views/GroupMembershipView.vue';
import { api } from '../../client/src/api.js';
import { button, mountPage } from './helpers.js';
import { currentUser } from '../../client/src/auth.js';
import { ref } from 'vue';

const plans = ref([]);
vi.mock('../../client/src/composables/useMeetupSummaries.js', () => ({ useMeetupSummaries: () => ({ plans }) }));

vi.mock('../../client/src/chatLive.js', () => ({ onChatEvent: () => () => {} }));

vi.mock('../../client/src/api.js', async original => ({ ...await original(), api: {
  groupMembership: vi.fn(), renameGroup: vi.fn(), configureGroup: vi.fn(), publishGroup: vi.fn(), friendInvite: vi.fn(),
} }));
vi.mock('../../client/src/auth.js', async () => {
  const { ref } = await import('vue');
  return { currentUser: ref({ id: 'host', displayName: 'Host' }) };
});
vi.mock('../../client/src/components/GroupPreferencesGate.vue', () => ({ default: { template: '<div><slot name="before"/><slot/></div>' } }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
  currentUser.value = { id: 'host', displayName: 'Host' }; plans.value = [];
  api.groupMembership.mockResolvedValue({ group: {
    partyId: 'group-1', hostId: 'host', concertId: 'concert-1', artist: 'Test artist',
    eventDate: '2030-01-01', eventTime: '20:00:00', eventTimezone: 'Asia/Singapore', status: 'open',
    name: 'Front Row Crew', imageUrl: null, strangerPlaces: 1, remainingCapacity: 1,
    settings: { published: true, expected_friends: 0, stranger_slots: 1, connect_open: false },
    members: [{ id: 'host', name: 'Host', source: 'host', answered: true }],
    profile: { coverage: { answered: 1, total: 1, complete: true }, representativeWants: [] },
  } });
});

describe('group settings disclosure and validation', () => {
  it('reveals invalid settings, then clears only the resolved local validation message', async () => {
    const { wrapper } = await mountPage(GroupMembershipView, { props: { id: 'group-1' } });
    const details = wrapper.get('details.member-settings');
    expect(details.element.open).toBe(false);
    details.element.open = true;
    await wrapper.get('input[maxlength="60"]').setValue('');
    details.element.open = false;
    await button(wrapper, 'Save changes').trigger('click');
    expect(details.element.open).toBe(true);
    expect(wrapper.get('[role="alert"]').text()).toBe('Fill in the highlighted fields before saving.');
    expect(api.renameGroup).not.toHaveBeenCalled();
    expect(api.configureGroup).not.toHaveBeenCalled();
    await wrapper.get('input[maxlength="60"]').setValue('Front Row Crew');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(button(wrapper, 'Save changes').element.disabled).toBe(true);
    expect(wrapper.text()).toContain('No unsaved changes.');
    expect(details.element.open).toBe(true);
  });

  it('preserves an API error when local fields become valid again', async () => {
    api.renameGroup.mockRejectedValue(new Error('offline'));
    const { wrapper } = await mountPage(GroupMembershipView, { props: { id: 'group-1' } });
    wrapper.get('details.member-settings').element.open = true;
    await wrapper.get('input[maxlength="60"]').setValue('Changed group');
    await button(wrapper, 'Save changes').trigger('click'); await flushPromises();
    expect(api.renameGroup).toHaveBeenCalledWith('group-1', 'Changed group');
    const message = wrapper.get('[role="alert"]').text();
    expect(message).toContain('Could not save this change.');
    await wrapper.get('input[maxlength="60"]').setValue('');
    await wrapper.get('input[maxlength="60"]').setValue('Changed group');
    expect(wrapper.get('[role="alert"]').text()).toBe(message);
  });

  it.each([false, true])('opens the matching board with a management return origin (existing=%s)', async existing => {
    if (existing) plans.value = [{ id: 'plan-1', scope: { partyId: 'group-1' }, status: 'planning', hasAvailability: false }];
    const { wrapper, router } = await mountPage(GroupMembershipView, { path: '/groups/group-1/members', props: { id: 'group-1' } });
    await button(wrapper, existing ? 'Share availability' : 'Plan meetup').trigger('click'); await flushPromises();
    expect(router.currentRoute.value.query.from).toBe('manage-group');
    expect(router.currentRoute.value.path).toBe(existing ? '/meetups/plan-1' : '/meetups');
  });

  it.each([
    ['Save publication settings', 'publishGroup', 'Publication settings saved.'],
    ['Create single-use friend link', 'friendInvite', 'Invitation link created.'],
  ])('announces %s once without an extra literal success checkmark', async (label, method, message) => {
    api[method].mockResolvedValue(method === 'friendInvite' ? { invitation: { path: '/groups/join/synthetic-invite' } } : {});
    const { wrapper } = await mountPage(GroupMembershipView, { props: { id: 'group-1' } });
    if (method === 'publishGroup') await wrapper.get('input[type="checkbox"]').setValue(true);
    await button(wrapper, label).trigger('click'); await flushPromises();
    expect(wrapper.findAll('.group-success')).toHaveLength(1);
    expect(wrapper.get('.group-success').text()).toBe(message);
    expect(wrapper.get('.group-success').text()).not.toContain('✓');
  });

  it('keeps a persisted publish successful if its following refresh fails, and retries only the read', async () => {
    api.publishGroup.mockResolvedValue({});
    const { wrapper } = await mountPage(GroupMembershipView, { props: { id: 'group-1' } });
    await wrapper.get('input[type="checkbox"]').setValue(true);
    api.groupMembership.mockRejectedValueOnce(new Error('offline'));
    await button(wrapper, 'Save publication settings').trigger('click'); await flushPromises();
    expect(wrapper.get('.group-success').text()).toBe('Publication settings saved.');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('The change was saved, but the latest group details could not be loaded');
    await button(wrapper, 'Retry refresh').trigger('click'); await flushPromises();
    expect(api.publishGroup).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).not.toContain('latest group details could not be loaded');
  });

  it('retains saved name input when refresh fails rather than replacing it with the old server snapshot', async () => {
    const { wrapper } = await mountPage(GroupMembershipView, { props: { id: 'group-1' } });
    await wrapper.get('input[maxlength="60"]').setValue('Saved new name');
    api.renameGroup.mockResolvedValue({}); api.groupMembership.mockRejectedValueOnce(new Error('offline'));
    await button(wrapper, 'Save changes').trigger('click'); await flushPromises();
    expect(wrapper.get('input[maxlength="60"]').element.value).toBe('Saved new name');
    expect(wrapper.get('.group-success').text()).toBe('All changes saved.');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    const data = await api.groupMembership();
    api.groupMembership.mockResolvedValue({ group: { ...data.group, name: 'Saved new name' } });
    await button(wrapper, 'Retry refresh').trigger('click'); await flushPromises();
    expect(api.renameGroup).toHaveBeenCalledTimes(1);
    expect(button(wrapper, 'Save changes').element.disabled).toBe(true);
  });

  it('allows an existing unconfigured draft to finish setup without inventing a name or size change', async () => {
    const data = await api.groupMembership();
    api.groupMembership.mockResolvedValue({ group: { ...data.group, settings: null } });
    const { wrapper } = await mountPage(GroupMembershipView, { props: { id: 'group-1' } });
    expect(wrapper.text()).toContain('Your draft group exists. Save its settings below to finish setup');
    expect(button(wrapper, 'Save changes').element.disabled).toBe(false);
    await button(wrapper, 'Save changes').trigger('click'); await flushPromises();
    expect(api.configureGroup).toHaveBeenCalledExactlyOnceWith('group-1', { expectedFriends: 0, strangerPlaces: 1 });
    expect(api.renameGroup).not.toHaveBeenCalled();
  });

  it('keeps historical settings, friend invitations and conversations without advertising new coordination', async () => {
    const data = await api.groupMembership();
    api.groupMembership.mockResolvedValue({ group: { ...data.group, eventDate: '2026-11-03' } });
    const { wrapper } = await mountPage(GroupMembershipView, { path: '/groups/group-1/members', props: { id: 'group-1' } });
    expect(wrapper.text()).toContain('This concert day has ended');
    expect(wrapper.get('.group-state').text()).toBe('Past concert');
    expect(wrapper.text()).not.toContain('Your group is visible to people looking for a group');
    expect(wrapper.findAll('button').some(item => ['Publish group', 'Plan meetup'].includes(item.text()))).toBe(false);
    expect(wrapper.findAll('a').some(item => item.text() === 'Connect with other groups')).toBe(false);
    expect(wrapper.get('a[href="/groups/group-1/channel"]').text()).toBe('Messages');
    expect(button(wrapper, 'Create single-use friend link').element.disabled).toBe(false);
    expect(wrapper.find('details.member-settings').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('companion places remaining');
  });

  it('opens existing historical plans with the management return origin', async () => {
    const data = await api.groupMembership();
    api.groupMembership.mockResolvedValue({ group: { ...data.group, eventDate: '2026-11-03' } });
    plans.value = [{ id: 'historic-plan', scope: { partyId: 'group-1' }, status: 'confirmed', endsAt: Date.now() - 1000 }];
    const { wrapper, router } = await mountPage(GroupMembershipView, { path: '/groups/group-1/members', props: { id: 'group-1' } });
    await button(wrapper, 'View meetup history').trigger('click'); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/meetups/historic-plan');
    expect(router.currentRoute.value.query.from).toBe('manage-group');
  });

  it('allows ongoing same-day publishing and connections after start while requiring an existing meetup', async () => {
    const data = await api.groupMembership();
    api.groupMembership.mockResolvedValue({ group: { ...data.group, eventDate: '2026-11-04', eventTime: '08:00:00' } });
    const { wrapper } = await mountPage(GroupMembershipView, { path: '/groups/group-1/members', props: { id: 'group-1' } });
    expect(button(wrapper, 'Save publication settings').element.disabled).toBe(true);
    await wrapper.get('input[type="checkbox"]').setValue(true);
    expect(button(wrapper, 'Save publication settings').element.disabled).toBe(false);
    expect(wrapper.findAll('a').some(item => item.text() === 'Connect with other groups')).toBe(true);
    expect(wrapper.findAll('button').some(item => item.text() === 'Plan meetup')).toBe(false);
    plans.value = [{ id: 'existing-plan', scope: { partyId: 'group-1' }, status: 'confirmed', endsAt: Date.now() - 1000 }]; await flushPromises();
    expect(button(wrapper, 'View meetup history').exists()).toBe(true);
  });

  it('explains a server-side concert cutoff without clearing host settings', async () => {
    api.publishGroup.mockRejectedValue(Object.assign(new Error('concert_finished'), { status: 409 }));
    const { wrapper } = await mountPage(GroupMembershipView, { props: { id: 'group-1' } });
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await button(wrapper, 'Save publication settings').trigger('click'); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('This concert day has ended');
    expect(wrapper.get('input[maxlength="60"]').element.value).toBe('Front Row Crew');
    expect(wrapper.find('.group-success').exists()).toBe(false);
  });

  it('does not present an undated group as available for new publishing or planning', async () => {
    const data = await api.groupMembership();
    api.groupMembership.mockResolvedValue({ group: { ...data.group, eventDate: null } });
    const { wrapper } = await mountPage(GroupMembershipView, { props: { id: 'group-1' } });
    expect(wrapper.text()).toContain('A valid concert date is needed');
    expect(wrapper.findAll('button').some(item => ['Publish group', 'Plan meetup'].includes(item.text()))).toBe(false);
    expect(button(wrapper, 'Create single-use friend link').element.disabled).toBe(false);
  });
});

describe('first-time host setup readiness', () => {
  it('shows saved readiness and separates publication from connection opt-in', async () => {
    const { wrapper } = await mountPage(GroupMembershipView, { props: { id: 'group-1' } });
    const setup = wrapper.get('[aria-labelledby="group-setup-heading"]');
    expect(setup.text()).toContain('Published · connections off');
    expect(setup.text()).toContain('0 of 0 expected friends joined');
    expect(setup.text()).toContain('1 of 1 members saved preferences');
    expect(setup.get('a').attributes('href')).toBe('#group-publication');
    expect(wrapper.findAll('a').some(item => item.text() === 'Discover groups to connect')).toBe(false);
  });

  it('offers the next publishing step only when the saved friend count and all member answers satisfy backend requirements', async () => {
    const { group } = await api.groupMembership();
    api.groupMembership.mockResolvedValue({ group: { ...group,
      settings: { ...group.settings, published: false, expected_friends: 1 },
      members: [...group.members, { id: 'friend', source: 'friend', name: 'Friend', answered: true }],
    } });
    const { wrapper } = await mountPage(GroupMembershipView, { props: { id: 'group-1' } });
    expect(wrapper.get('#group-setup-heading').text()).toBe('Ready to publish');
    expect(wrapper.text()).toContain('1 of 1 expected friends joined');
    expect(wrapper.text()).toContain('2 of 2 members saved preferences');
    expect(button(wrapper, 'Publish group').element.disabled).toBe(false);
    expect(wrapper.get('a[href="#group-publication"]').text()).toBe('Go to publishing');
  });

  it('explains missing friends and opens the existing single-use invitation tools without generating a link automatically', async () => {
    const { group } = await api.groupMembership();
    api.groupMembership.mockResolvedValue({ group: { ...group, settings: { ...group.settings, published: false, expected_friends: 2 } } });
    const { wrapper } = await mountPage(GroupMembershipView, { props: { id: 'group-1' } });
    expect(wrapper.get('#group-setup-heading').text()).toBe('Finish your group setup');
    expect(wrapper.text()).toContain('0 of 2 expected friends joined');
    expect(button(wrapper, 'Publish group').element.disabled).toBe(true);
    expect(wrapper.get('#publication-blocked-reason').text()).toContain('Wait for every expected friend to join');
    await button(wrapper, 'Invite your friends').trigger('click'); await flushPromises();
    expect(wrapper.get('details.member-invite-tools').element.open).toBe(true);
    expect(document.activeElement).toBe(button(wrapper, 'Create single-use friend link').element);
    expect(api.friendInvite).not.toHaveBeenCalled();
    expect(api.publishGroup).not.toHaveBeenCalled();
  });

  it('counts every current member rather than just friends and directs the host to their own private preferences', async () => {
    const { group } = await api.groupMembership();
    api.groupMembership.mockResolvedValue({ group: { ...group, settings: { ...group.settings, published: false },
      members: [{ ...group.members[0], answered: false }, { id: 'seeker', name: 'Seeker', source: 'proposal', answered: true }],
    } });
    const { wrapper } = await mountPage(GroupMembershipView, { props: { id: 'group-1' } });
    const setup = wrapper.get('[aria-labelledby="group-setup-heading"]');
    expect(setup.text()).toContain('1 of 2 members saved preferences');
    expect(setup.get('a[href="/profile#preferences"]').text()).toBe('Save your private preferences');
    expect(button(wrapper, 'Publish group').element.disabled).toBe(true);
    expect(wrapper.get('#publication-blocked-reason').text()).toContain('Every member, including the host');
  });

  it('directs missing member answers to the roster and published connection-enabled groups to discovery', async () => {
    const { group } = await api.groupMembership();
    api.groupMembership.mockResolvedValue({ group: { ...group, settings: { ...group.settings, connect_open: true },
      members: [...group.members, { id: 'member', name: 'Member', source: 'direct', answered: false }],
    } });
    const { wrapper } = await mountPage(GroupMembershipView, { props: { id: 'group-1' } });
    const setup = wrapper.get('[aria-labelledby="group-setup-heading"]');
    expect(setup.get('a[href="#group-members"]').text()).toBe('See who still needs to answer');
    expect(setup.get('a.btn').attributes('href')).toBe('/groups/connect?view=connections&groupId=group-1&concertId=concert-1');
    expect(wrapper.get('#group-setup-heading').text()).toBe('Published · connections on');
  });

  it('keeps host setup and publication controls away from an ordinary member while retaining conversation and planning', async () => {
    currentUser.value = { id: 'member', displayName: 'Member' };
    const { wrapper } = await mountPage(GroupMembershipView, { props: { id: 'group-1' } });
    expect(wrapper.find('[aria-labelledby="group-setup-heading"]').exists()).toBe(false);
    expect(wrapper.find('details.member-settings').exists()).toBe(false);
    expect(wrapper.findAll('button').some(item => item.text() === 'Save publication settings')).toBe(false);
    expect(wrapper.findAll('a').some(item => item.text() === 'Connect with other groups')).toBe(false);
    expect(wrapper.get('a[href="/groups/group-1/channel"]').text()).toBe('Messages');
    expect(button(wrapper, 'Plan meetup').exists()).toBe(true);
  });
});
