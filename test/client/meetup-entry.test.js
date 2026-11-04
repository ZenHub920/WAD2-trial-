import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { defineComponent } from 'vue';
import MeetupEntryCard from '../../client/src/components/MeetupEntryCard.vue';
import MeetupOverview from '../../client/src/components/MeetupOverview.vue';
import { api } from '../../client/src/api.js';
import { currentUser } from '../../client/src/auth.js';
import { invalidateMeetupSummaries } from '../../client/src/composables/useMeetupSummaries.js';
import { mountPage } from './helpers.js';
const live = vi.hoisted(() => ({ handlers: new Set() }));
vi.mock('../../client/src/chatLive.js', () => ({ onChatEvent: fn => { live.handlers.add(fn); return () => live.handlers.delete(fn); } }));
vi.mock('../../client/src/api.js', () => ({ api: { meetups: vi.fn(), meetupContext: vi.fn() } }));
vi.mock('../../client/src/auth.js', async () => { const { ref } = await import('vue'); return { currentUser: ref({ id: 'host' }) }; });

const scope = { partyId: 'group-1' };
const plan = (status = 'planning', extra = {}) => ({
  id: 'plan-1', title: 'Meet before the concert', status, scope,
  concert: { artist: 'Test artist', event_date: '2030-01-01' }, scopeLabel: 'Front row group',
  participantCount: 4, availabilityParticipantCount: 2, hasAvailability: false, isHistorical: false,
  approvalCount: 0, requiredApprovalCount: 2, capabilities: { canApprove: status === 'proposed' }, ...extra,
});

beforeEach(() => {
  vi.clearAllMocks(); currentUser.value = { id: 'host' }; invalidateMeetupSummaries();
  api.meetups.mockResolvedValue({ meetups: [] });
  api.meetupContext.mockResolvedValue({ context: { capabilities: { canCreate: true }, meetups: [] } });
});

describe('conversation meetup status cards', () => {
  it('keeps historical plans accessible but does not offer a new pre-concert board after the planning window closes', async () => {
    api.meetupContext.mockResolvedValue({ context: { concert: { event_date: '2000-01-01' }, policy: { canSchedule: false }, capabilities: { canCreate: true } } });
    const { wrapper } = await mountPage(MeetupEntryCard, { props: { scope } });
    expect(wrapper.text()).toContain('Pre-concert planning is closed');
    expect(wrapper.find('a').exists()).toBe(false);
    api.meetups.mockResolvedValue({ meetups: [plan('confirmed', { isHistorical: true })] });
    for (const handler of live.handlers) handler('meetup-updated', { meetupId: 'plan-1' });
    await flushPromises();
    expect(wrapper.get('a.btn').attributes('href')).toBe('/meetups/plan-1?from=conversation#meetup-review');
    expect(wrapper.get('a.btn').text()).toBe('View meetup details');
    expect(wrapper.text()).toContain('Past');
  });
  it('offers creation only after authorized context permits it, not for ordinary members', async () => {
    const host = await mountPage(MeetupEntryCard, { props: { scope } });
    expect(host.wrapper.get('a').text()).toBe('Create meetup plan');
    expect(host.wrapper.get('a').attributes('href')).toBe('/meetups?partyId=group-1');
    host.wrapper.unmount(); invalidateMeetupSummaries();
    currentUser.value = { id: 'member' };
    api.meetupContext.mockResolvedValue({ context: { capabilities: { canCreate: false }, meetups: [] } });
    const member = await mountPage(MeetupEntryCard, { props: { scope } });
    expect(member.wrapper.text()).toContain('Planning has not started');
    expect(member.wrapper.find('a').exists()).toBe(false);
  });

  it.each([
    ['planning', {}, 'Share availability', '2 of 4 participants shared availability.', '#meetup-availability'],
    ['planning', { hasAvailability: true }, 'View planning board', 'Planning in progress', '#meetup-places'],
    ['proposed', {}, 'Review and approve', '0 of 2 required approvals', '#meetup-review'],
    ['proposed', { capabilities: { canApprove: false }, hasApproved: true }, 'View proposed meetup', 'Your approval is saved', '#meetup-review'],
    ['confirmed', {}, 'View meetup details', 'Confirmed', '#meetup-review'],
    ['cancelled', { isHistorical: true }, 'View cancelled plan', 'not an active meetup', '#meetup-review'],
  ])('reflects persisted %s state and the caller’s actual next action', async (status, extra, action, text, hash) => {
    api.meetups.mockResolvedValue({ meetups: [plan(status, extra)] });
    const { wrapper } = await mountPage(MeetupEntryCard, { props: { scope } });
    expect(wrapper.text()).toContain(text);
    expect(wrapper.get('a').text()).toBe(action);
    expect(wrapper.get('a').attributes('href')).toBe(`/meetups/plan-1?from=conversation${hash}`);
    expect(api.meetupContext).not.toHaveBeenCalled();
  });

  it('shows the selected public place and explicit Singapore-local time', async () => {
    api.meetups.mockResolvedValue({ meetups: [plan('confirmed', { selectedPlace: { id: 'place', label: 'Stadium MRT Exit A' }, selectedStart: Date.parse('2030-01-01T08:00:00Z') })] });
    const { wrapper } = await mountPage(MeetupEntryCard, { props: { scope } });
    expect(wrapper.text()).toContain('Stadium MRT Exit A');
    expect(wrapper.text()).toMatch(/4:00\s*pm/i);
    expect(wrapper.text()).toContain('(Singapore)');
  });

  it('shares a single cached list and invalidation across multiple cards', async () => {
    api.meetups.mockResolvedValue({ meetups: [plan()] });
    const page = defineComponent({ components: { MeetupEntryCard }, template: '<div><MeetupEntryCard :scope="{partyId:\'group-1\'}"/><MeetupEntryCard :scope="{partyId:\'group-1\'}"/></div>' });
    const { wrapper } = await mountPage(page);
    expect(api.meetups).toHaveBeenCalledTimes(1);
    api.meetups.mockResolvedValue({ meetups: [plan('confirmed')] });
    for (const handler of live.handlers) handler('meetup-updated', { meetupId: 'plan-1' });
    await flushPromises();
    expect(api.meetups).toHaveBeenCalledTimes(2);
    expect(wrapper.findAll('a.btn').map(link => link.text())).toEqual(['View meetup details', 'View meetup details']);
  });

  it('discards a late context response after the conversation changes', async () => {
    let complete;
    api.meetupContext.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }))
      .mockResolvedValue({ context: { capabilities: { canCreate: false }, meetups: [] } });
    const { wrapper } = await mountPage(MeetupEntryCard, { props: { scope } });
    await wrapper.setProps({ scope: { connectionId: 'another-room' } }); await flushPromises();
    complete({ context: { capabilities: { canCreate: true }, meetups: [] } }); await flushPromises();
    expect(wrapper.find('a').exists()).toBe(false);
    expect(wrapper.text()).toContain('Planning has not started');
  });

  it('reconciles an invalidation received during an older read without applying its stale snapshot', async () => {
    let complete;
    api.meetups.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }))
      .mockResolvedValue({ meetups: [plan('confirmed')] });
    const { wrapper } = await mountPage(MeetupEntryCard, { props: { scope } });
    for (const handler of live.handlers) handler('meetup-updated', { meetupId: 'plan-1' });
    complete({ meetups: [plan()] }); await flushPromises();
    expect(api.meetups).toHaveBeenCalledTimes(2);
    expect(wrapper.get('a.btn').text()).toBe('View meetup details');
    expect(wrapper.text()).not.toContain('Planning in progress');
  });

  it('never exposes a previous account’s late summary response in a new session', async () => {
    let complete;
    api.meetups.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }))
      .mockResolvedValue({ meetups: [] });
    api.meetupContext.mockResolvedValue({ context: { capabilities: { canCreate: false }, meetups: [] } });
    const { wrapper } = await mountPage(MeetupEntryCard, { props: { scope } });
    currentUser.value = { id: 'new-member' }; await flushPromises();
    complete({ meetups: [plan('confirmed', { title: 'Former account private group plan' })] }); await flushPromises();
    expect(wrapper.text()).not.toContain('Former account private group plan');
    expect(wrapper.find('a').exists()).toBe(false);
  });

  it('hides cached creation authority when refreshing status fails after a membership change', async () => {
    const { wrapper } = await mountPage(MeetupEntryCard, { props: { scope } });
    expect(wrapper.get('a').text()).toBe('Create meetup plan');
    api.meetups.mockRejectedValue(new Error('membership_changed'));
    for (const handler of live.handlers) handler('group-members', { partyId: 'group-1' });
    await flushPromises();
    expect(wrapper.find('a').exists()).toBe(false);
    expect(wrapper.text()).toContain('Meetup status unavailable');
  });

  it.each(['groups', 'manage-group'])('carries the %s entry context through creation and plan options', async from => {
    const { wrapper } = await mountPage(MeetupEntryCard, { props: { scope, from } });
    expect(wrapper.get('a').attributes('href')).toBe(`/meetups?partyId=group-1&from=${from}`);
    api.meetups.mockResolvedValue({ meetups: [plan()] });
    for (const handler of live.handlers) handler('meetup-updated', { meetupId: 'plan-1' });
    await flushPromises();
    expect(wrapper.get('a.btn').attributes('href')).toBe(`/meetups/plan-1?from=${from}#meetup-availability`);
    expect(wrapper.get('a.meetup-entry__more').attributes('href')).toBe(`/meetups?partyId=group-1&from=${from}`);
  });
});

describe('My meetups overview', () => {
  it('groups attention, upcoming and history without marking cancelled plans active', async () => {
    const { wrapper } = await mountPage(MeetupOverview, { props: { plans: [
      plan('proposed'), plan('confirmed', { id: 'confirmed' }), plan('cancelled', { id: 'cancelled', isHistorical: true }),
    ] } });
    expect(wrapper.findAll('h2').map(heading => heading.text())).toEqual(['Needs your attention', 'Upcoming & in progress', 'Past & cancelled']);
    expect(wrapper.text()).toContain('Test artist'); expect(wrapper.text()).toContain('Front row group');
    expect(wrapper.findAll('a')[0].attributes('href')).toBe('/meetups/plan-1?from=overview#meetup-review');
  });

  it.each(['groups', 'manage-group'])('preserves the %s origin when choosing between several boards', async from => {
    const { wrapper } = await mountPage(MeetupOverview, { props: { scoped: true, from, plans: [plan(), plan('confirmed', { id: 'second-plan' })] } });
    expect(wrapper.findAll('a').every(link => link.attributes('href').includes(`from=${from}`))).toBe(true);
  });
});
