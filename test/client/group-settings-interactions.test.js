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
} }));
let savedGroup;
beforeEach(() => {
  vi.resetAllMocks();
  savedGroup = {
    partyId: 'g', hostId: 'host', concertId: 'c', artist: 'Artist', name: 'Our group', eventDate: '2030-01-01', status: 'open',
    members: [{ id: 'host', name: 'Host', source: 'host', answered: true }],
    settings: { expected_friends: 0, stranger_slots: 1, published: true, connect_open: false },
    profile: { coverage: { answered: 1, total: 1, complete: true }, representativeWants: [] },
  };
  api.groupMembership.mockImplementation(async () => ({ group: structuredClone(savedGroup) }));
  api.renameGroup.mockImplementation(async (_id, name) => { savedGroup.name = name; });
  api.publishGroup.mockImplementation(async (_id, { connectOpen }) => { savedGroup.settings.connect_open = connectOpen; });
  api.cancelGroup.mockImplementation(async () => { savedGroup.status = 'cancelled'; });
});
const open = () => mountPage(GroupMembershipView, { path: '/groups/g/members', props: { id: 'g' } });

describe('group settings persistence and recovery', () => {
  it('identifies the publication draft and saves it only through the labelled publication action', async () => {
    const { wrapper } = await open();
    expect(button(wrapper, 'Save publication settings').element.disabled).toBe(true);
    await wrapper.get('input[type="checkbox"]').setValue(true);
    expect(wrapper.text()).not.toContain('No unsaved changes.');
    expect(wrapper.text()).toContain('Publication setting not saved');
    expect(button(wrapper, 'Save changes').element.disabled).toBe(true);
    await button(wrapper, 'Save publication settings').trigger('click'); await flushPromises();
    expect(api.publishGroup).toHaveBeenCalledExactlyOnceWith('g', { connectOpen: true });
    expect(wrapper.get('.group-success').text()).toBe('Publication settings saved.');
    expect(wrapper.text()).toContain('Publication settings are saved.');
    expect(button(wrapper, 'Save publication settings').element.disabled).toBe(true);
    expect(wrapper.findAll('button').some(item => item.text() === 'Discard')).toBe(false);
  });

  it('does not publish a draft group implicitly through saving its details', async () => {
    savedGroup.settings.published = false;
    const { wrapper } = await open();
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get('input[maxlength="60"]').setValue('Updated group');
    await button(wrapper, 'Save changes').trigger('click'); await flushPromises();
    expect(api.renameGroup).toHaveBeenCalledExactlyOnceWith('g', 'Updated group');
    expect(api.publishGroup).not.toHaveBeenCalled();
    expect(wrapper.get('input[type="checkbox"]').element.checked).toBe(true);
    expect(wrapper.text()).toContain('publication setting is still unsaved');
    expect(button(wrapper, 'Publish group').element.disabled).toBe(false);
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
      savedGroup.settings.expected_friends = input.expectedFriends; savedGroup.settings.published = false;
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
    expect(button(wrapper, 'Publish group').exists()).toBe(true);
  });

  it('keeps an unsaved publication checkbox across a saved-details refresh failure and read retry', async () => {
    const { wrapper } = await open();
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get('input[maxlength="60"]').setValue('Updated group');
    api.groupMembership.mockRejectedValueOnce(new Error('offline'));
    await button(wrapper, 'Save changes').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('change was saved');
    await button(wrapper, 'Retry refresh').trigger('click'); await flushPromises();
    expect(wrapper.get('input[type="checkbox"]').element.checked).toBe(true);
    expect(wrapper.text()).toContain('Publication setting not saved');
    expect(api.publishGroup).not.toHaveBeenCalled();
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

  it('protects publication drafts on navigation and page reload without prompting for an unchanged page', async () => {
    const { wrapper, router } = await open();
    const unchanged = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unchanged);
    expect(unchanged.defaultPrevented).toBe(false);
    await wrapper.get('input[type="checkbox"]').setValue(true);
    const reload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(reload);
    expect(reload.defaultPrevented).toBe(true);
    const leaving = router.push('/groups/connect'); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/groups/g/members');
    const keep = [...document.querySelectorAll('[role="dialog"] button')].find(el => el.textContent.trim() === 'Keep editing');
    keep.click(); await leaving; await flushPromises();
    expect(router.currentRoute.value.path).toBe('/groups/g/members');
    expect(wrapper.get('input[type="checkbox"]').element.checked).toBe(true);
    const discard = router.push('/groups/connect'); await flushPromises();
    [...document.querySelectorAll('[role="dialog"] button')].find(el => el.textContent.trim() === 'Discard changes and leave').click();
    await discard; expect(router.currentRoute.value.path).toBe('/groups/connect');
  });
});
