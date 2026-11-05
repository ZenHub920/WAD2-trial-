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
  hostedGroupJoinRequests: vi.fn(), myProposals: vi.fn(), respondGroupJoin: vi.fn(), acceptProposal: vi.fn(), declineProposal: vi.fn(),
} }));
vi.mock('../../client/src/auth.js', async () => {
  const { ref } = await import('vue');
  return { currentUser: ref({ id: 'host', displayName: 'Host' }) };
});
vi.mock('../../client/src/components/GroupPreferencesGate.vue', () => ({ default: { template: '<div><slot name="before"/><slot/></div>' } }));

beforeEach(() => {
  vi.resetAllMocks();
  api.hostedGroupJoinRequests.mockResolvedValue({ requests: [] }); api.myProposals.mockResolvedValue({ proposals: [] });
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
  currentUser.value = { id: 'host', displayName: 'Host' }; plans.value = [];
  api.groupMembership.mockResolvedValue({ group: {
    partyId: 'group-1', hostId: 'host', concertId: 'concert-1', artist: 'Test artist',
    eventDate: '2030-01-01', eventTime: '20:00:00', eventTimezone: 'Asia/Singapore', status: 'open',
    name: 'Front Row Crew', imageUrl: null, strangerPlaces: 1, remainingCapacity: 1,
    settings: { published: true, expected_friends: 0, stranger_slots: 1 },
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
    ['Create single-use friend link', 'friendInvite', 'Invitation link created.'],
  ])('announces %s once without an extra literal success checkmark', async (label, method, message) => {
    api[method].mockResolvedValue(method === 'friendInvite' ? { invitation: { path: '/groups/join/synthetic-invite' } } : {});
    const { wrapper } = await mountPage(GroupMembershipView, { props: { id: 'group-1' } });
    await button(wrapper, label).trigger('click'); await flushPromises();
    expect(wrapper.findAll('.group-success')).toHaveLength(1);
    expect(wrapper.get('.group-success').text()).toBe(message);
    expect(wrapper.get('.group-success').text()).not.toContain('✓');
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
    expect(wrapper.text()).toContain('Save your group settings below to finish setting it up.');
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

  it('keeps an ongoing same-day group listed after start while requiring an existing meetup', async () => {
    const data = await api.groupMembership();
    api.groupMembership.mockResolvedValue({ group: { ...data.group, eventDate: '2026-11-04', eventTime: '08:00:00' } });
    const { wrapper } = await mountPage(GroupMembershipView, { path: '/groups/group-1/members', props: { id: 'group-1' } });
    expect(wrapper.text()).toContain('People looking for a group can find and ask to join it.');
    expect(wrapper.findAll('button').some(item => item.text() === 'Plan meetup')).toBe(false);
    plans.value = [{ id: 'existing-plan', scope: { partyId: 'group-1' }, status: 'confirmed', endsAt: Date.now() - 1000 }]; await flushPromises();
    expect(button(wrapper, 'View meetup history').exists()).toBe(true);
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

describe('first-time host setup', () => {
  it('lists the group straight away and shows reserved friend places without a publish step', async () => {
    const { group } = await api.groupMembership();
    api.groupMembership.mockResolvedValue({ group: { ...group, settings: { ...group.settings, expected_friends: 2 } } });
    const { wrapper } = await mountPage(GroupMembershipView, { props: { id: 'group-1' } });
    expect(wrapper.find('#group-setup-heading').exists()).toBe(false);
    expect(wrapper.findAll('button').some(item => item.text() === 'Publish group')).toBe(false);
    expect(wrapper.get('.group-state').text()).toBe('Listed');
    expect(wrapper.text()).toContain('0 of 2 invited friends have joined. Their places stay reserved.');
  });

  it('keeps host setup and publication controls away from an ordinary member while retaining conversation and planning', async () => {
    currentUser.value = { id: 'member', displayName: 'Member' };
    const { wrapper } = await mountPage(GroupMembershipView, { props: { id: 'group-1' } });
        expect(wrapper.find('details.member-settings').exists()).toBe(false);
    expect(wrapper.findAll('button').some(item => item.text() === 'Save publication settings')).toBe(false);
    expect(wrapper.get('a[href="/groups/group-1/channel"]').text()).toBe('Messages');
    expect(button(wrapper, 'Plan meetup').exists()).toBe(true);
  });
});

describe('pending join requests under Members', () => {
  it('shows each person waiting with their picture and profile link, in queue order, and lets the host accept or decline', async () => {
    api.hostedGroupJoinRequests.mockResolvedValue({ requests: [
      { id: 'join-1', partyId: 'group-1', status: 'pending', queueOrder: 1, canHostRespond: true, queueStatus: 'held', applicationNote: 'Hi!',
        seeker: { id: 'sam', displayName: 'Sam', avatarUrl: '/api/avatars/sam.png' } },
      { id: 'join-other', partyId: 'other-group', status: 'pending', seeker: { id: 'x', displayName: 'Elsewhere' } },
    ] });
    api.myProposals.mockResolvedValue({ proposals: [
      { id: 'offer-1', role: 'host', partyId: 'group-1', status: 'proposed', queueOrder: 2, canHostRespond: false, queueStatus: 'waiting',
        seekerUserId: 'kim', seekerName: 'Kim', seekerAvatarUrl: null, hostApproved: false },
    ] });
    api.respondGroupJoin.mockResolvedValue({});
    const { wrapper } = await mountPage(GroupMembershipView, { props: { id: 'group-1' } });
    const section = wrapper.get('#join-requests');
    expect(section.text()).toContain('Pending join requests (2)');
    expect(section.text()).not.toContain('Elsewhere');
    const rows = section.findAll('li');
    expect(rows[0].text()).toContain('Sam'); expect(rows[1].text()).toContain('Kim');
    expect(rows[0].get('a').attributes('href')).toBe('/people/sam');
    expect(rows[0].find('img').attributes('src')).toBe('/api/avatars/sam.png');
    expect(button(rows[1], 'Accept').element.disabled).toBe(true);
    api.hostedGroupJoinRequests.mockResolvedValue({ requests: [] });
    await button(rows[0], 'Accept').trigger('click'); await flushPromises();
    expect(api.respondGroupJoin).toHaveBeenCalledExactlyOnceWith('join-1', 'accept');
    expect(wrapper.get('#join-requests').text()).toContain('Sam joined your group.');
  });
});

describe('member list', () => {
  it('shows each member with their picture, a profile link and the host tag', async () => {
    const data = await api.groupMembership();
    api.groupMembership.mockResolvedValue({ group: { ...data.group, members: [
      { id: 'host', name: 'Host', source: 'host', answered: true, avatarUrl: '/api/avatars/host.png' },
      { id: 'sam', name: 'Sam', source: 'friend', answered: false, avatarUrl: null },
    ] } });
    const { wrapper } = await mountPage(GroupMembershipView, { props: { id: 'group-1' } });
    const rows = wrapper.findAll('.member-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].attributes('href')).toBe('/people/host');
    expect(rows[0].find('img').attributes('src')).toBe('/api/avatars/host.png');
    expect(rows[0].text()).toContain('Host (you)');
    expect(rows[0].get('.member-row__role').text()).toBe('host');
    expect(rows[1].find('.member-row__role').exists()).toBe(false);
    expect(rows[1].text()).toContain('Invited friend · Preferences missing');
  });
});
