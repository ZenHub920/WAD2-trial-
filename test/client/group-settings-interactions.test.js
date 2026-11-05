import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import GroupMembershipView from '../../client/src/views/GroupMembershipView.vue';
import { api } from '../../client/src/api.js';
import { button, mountPage } from './helpers.js';

vi.mock('../../client/src/composables/useMeetupSummaries.js', () => ({ useMeetupSummaries: () => ({ plans: ref([]) }) }));
vi.mock('../../client/src/components/GroupPreferencesGate.vue', () => ({ default: { template: '<div><slot name="before"/><slot/></div>' } }));
vi.mock('../../client/src/auth.js', async () => { const { ref } = await import('vue'); return { currentUser: ref({ id: 'host' }) }; });
vi.mock('../../client/src/api.js', async original => ({ ...await original(), api: {
  groupMembership: vi.fn(), renameGroup: vi.fn(), configureGroup: vi.fn(), publishGroup: vi.fn(), cancelGroup: vi.fn(), friendInvite: vi.fn(),
  hostedGroupJoinRequests: vi.fn(), myProposals: vi.fn(), respondGroupJoin: vi.fn(), acceptProposal: vi.fn(), declineProposal: vi.fn(),
} }));
let savedGroup;
beforeEach(() => {
  vi.resetAllMocks();
  api.hostedGroupJoinRequests.mockResolvedValue({ requests: [] }); api.myProposals.mockResolvedValue({ proposals: [] });
  savedGroup = {
    partyId: 'g', hostId: 'host', concertId: 'c', artist: 'Artist', name: 'Our group', eventDate: '2030-01-01', status: 'open',
    members: [{ id: 'host', name: 'Host', source: 'host', answered: true }],
    settings: { expected_friends: 0, stranger_slots: 1, published: true },
    profile: { coverage: { answered: 1, total: 1, complete: true }, representativeWants: [] },
  };
  api.groupMembership.mockImplementation(async () => ({ group: structuredClone(savedGroup) }));
  api.renameGroup.mockImplementation(async (_id, name) => { savedGroup.name = name; });
  api.publishGroup.mockImplementation(async () => { savedGroup.settings.published = true; });
  api.cancelGroup.mockImplementation(async () => { savedGroup.status = 'cancelled'; });
});
const open = () => mountPage(GroupMembershipView, { path: '/groups/g/members', props: { id: 'g' } });

describe('group settings persistence and recovery', () => {
  it('shows the group as listed, with no publish step', async () => {
    const { wrapper } = await open();
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
    expect(wrapper.findAll('button').some(item => ['Publish group', 'Save publication settings'].includes(item.text()))).toBe(false);
    expect(wrapper.text()).toContain('People looking for a group can find and ask to join it.');
    expect(wrapper.text()).toContain('No unsaved changes.');
  });

  it('clears an earlier saved message when a new group detail is edited', async () => {
    const { wrapper } = await open();
    await wrapper.get('input[maxlength="60"]').setValue('Saved name');
    await button(wrapper, 'Save changes').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('All changes saved.');
    await wrapper.get('input[maxlength="60"]').setValue('Unsaved next name');
    expect(wrapper.text()).not.toContain('All changes saved.');
    expect(wrapper.text()).toContain('You have unsaved group details.');
  });

  it('preserves successful name changes and retries only the failed size change', async () => {
    api.configureGroup.mockRejectedValueOnce(new Error('expected_friends_below_current_members')).mockImplementation(async (_id, input) => {
      savedGroup.settings.expected_friends = input.expectedFriends;
    });
    const { wrapper } = await open();
    await wrapper.get('input[maxlength="60"]').setValue('Saved name');
    await wrapper.get('input[aria-labelledby="friends-label"]').setValue(2);
    await button(wrapper, 'Save changes').trigger('click'); await flushPromises();
    expect(wrapper.get('.group-success').text()).toBe('Saved name. Other changes are still unsaved.');
    expect(wrapper.get('[role="alert"]').text()).toContain('Remaining changes were not saved');
    expect(wrapper.get('input[aria-labelledby="friends-label"]').element.value).toBe('2');
    await button(wrapper, 'Save changes').trigger('click'); await flushPromises();
    expect(api.renameGroup).toHaveBeenCalledTimes(1);
    expect(api.configureGroup).toHaveBeenCalledTimes(2);
    expect(wrapper.findAll('button').some(item => item.text() === 'Publish group')).toBe(false);
  });

  it('confirms cancellation and keeps the group unchanged when dismissed', async () => {
    const { wrapper } = await open();
    await button(wrapper, 'Cancel group').trigger('click'); await flushPromises();
    expect(api.cancelGroup).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog.textContent).toContain('Pending requests');
    dialog.querySelector('button').click(); await flushPromises();
    expect(api.cancelGroup).not.toHaveBeenCalled();
    await button(wrapper, 'Cancel group').trigger('click'); await flushPromises();
    [...document.querySelectorAll('[role="dialog"] button')].find(el => el.textContent.trim() === 'Cancel group').click();
    await flushPromises();
    expect(api.cancelGroup).toHaveBeenCalledExactlyOnceWith('g');
    expect(wrapper.text()).toContain('Group cancelled.');
  });

  it('protects unsaved group details on navigation and page reload without prompting for an unchanged page', async () => {
    const { wrapper, router } = await open();
    const unchanged = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unchanged);
    expect(unchanged.defaultPrevented).toBe(false);
    await wrapper.get('input[maxlength="60"]').setValue('Draft name');
    const reload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(reload);
    expect(reload.defaultPrevented).toBe(true);
    const leaving = router.push('/groups/connect'); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/groups/g/members');
    const keep = [...document.querySelectorAll('[role="dialog"] button')].find(el => el.textContent.trim() === 'Keep editing');
    keep.click(); await leaving; await flushPromises();
    expect(router.currentRoute.value.path).toBe('/groups/g/members');
    expect(wrapper.get('input[maxlength="60"]').element.value).toBe('Draft name');
    const discard = router.push('/groups/connect'); await flushPromises();
    [...document.querySelectorAll('[role="dialog"] button')].find(el => el.textContent.trim() === 'Discard changes and leave').click();
    await discard; expect(router.currentRoute.value.path).toBe('/groups/connect');
  });
});
