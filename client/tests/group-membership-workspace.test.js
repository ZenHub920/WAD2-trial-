import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import GroupMembershipView from '../src/views/GroupMembershipView.vue';
import { api } from '../src/api.js';
import { button, mountPage } from './helpers.js';

vi.mock('../src/chatLive.js', () => ({ onChatEvent: () => () => {} }));

vi.mock('../src/api.js', async original => ({ ...await original(), api: {
  groupMembership: vi.fn(), renameGroup: vi.fn(), configureGroup: vi.fn(),
} }));
vi.mock('../src/auth.js', async () => {
  const { ref } = await import('vue');
  return { currentUser: ref({ id: 'host', displayName: 'Host' }) };
});
vi.mock('../src/components/GroupPreferencesGate.vue', () => ({ default: { template: '<div><slot name="before"/><slot/></div>' } }));

beforeEach(() => {
  vi.resetAllMocks();
  api.groupMembership.mockResolvedValue({ group: {
    partyId: 'group-1', hostId: 'host', concertId: 'concert-1', artist: 'Test artist',
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
});
