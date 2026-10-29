import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import MeetupView from '../src/views/MeetupView.vue';
import MeetupLocationSearch from '../src/components/MeetupLocationSearch.vue';
import { api } from '../src/api.js';
import { button, field, mountPage } from './helpers.js';
const live = vi.hoisted(() => ({ handler: null }));
vi.mock('../src/chatLive.js', async () => {
  const { ref } = await import('vue');
  return { connectionState: ref('live'), onChatEvent: handler => { live.handler = handler; return () => { live.handler = null; }; } };
});
vi.mock('../src/api.js', async original => ({ ...await original(), api: {
  meetup: vi.fn(), meetupAvailability: vi.fn(), meetupLocations: vi.fn(), meetupTravelSuggestions: vi.fn(),
} }));
vi.mock('../src/auth.js', async () => {
  const { ref } = await import('vue');
  return { currentUser: ref({ id: 'user-1' }) };
});
const start = Date.parse('2030-01-01T04:00:00Z');
const board = () => ({
  id: 'meetup-1', title: 'Concert meetup', status: 'planning', participantCount: 2,
  creator_id: 'user-1', version: 1, starts_at: start, ends_at: start + 3600000,
  requiredApprovers: [], approvals: [], comments: [], places: [], suggestions: [],
  availability: [{ starts_at: start, ends_at: start + 1800000, travel_mode: 'transit', latitude: 1.3, longitude: 103.85, label: 'City Hall' }],
  grid: [{ startsAt: start, availableCount: 1 }],
});
beforeEach(() => {
  vi.resetAllMocks(); api.meetup.mockImplementation(async () => ({ meetup: board() }));
  api.meetupAvailability.mockResolvedValue({});
});
describe('meeting planner with real OneMap search child', () => {
  it.each(['drive', 'transit'])('saves selected availability using %s', async mode => {
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    const travel = wrapper.findAll('select').find(select => select.findAll('option').some(option => option.text() === 'Car'));
    expect(travel.findAll('option').map(option => option.text())).toEqual(['Public transport', 'Car']);
    await travel.setValue(mode);
    await button(wrapper, 'Apply travel method to selected times').trigger('click');
    await button(wrapper, 'Save selected availability').trigger('click');
    await flushPromises();
    expect(api.meetupAvailability).toHaveBeenCalledWith('meetup-1', [{
      startsAt: new Date(start).toISOString(), endsAt: new Date(start + 1800000).toISOString(),
      travelMode: mode, latitude: 1.3, longitude: 103.85, label: 'City Hall',
    }], 1);
    expect(wrapper.text()).toContain('Meetup updated.');
  });
  it('saves the real search child selection as the starting location', async () => {
    api.meetupLocations.mockResolvedValue({ result: { status: 'available', locations: [{ label: 'City Hall MRT', address: '150 North Bridge Road', latitude: 1.293, longitude: 103.852 }] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    const search = wrapper.findAllComponents(MeetupLocationSearch).find(child => child.props('label') === 'Find your approximate starting place');
    await search.get('input').setValue('City Hall');
    await button(search, 'Search OneMap').trigger('click');
    await flushPromises();
    await search.findAll('button').find(candidate => candidate.text().includes('City Hall MRT')).trigger('click');
    await button(wrapper, 'Apply this location to selected times').trigger('click');
    await button(wrapper, 'Save selected availability').trigger('click');
    await flushPromises();
    expect(api.meetupLocations).toHaveBeenCalledWith('meetup-1', 'City Hall');
    expect(api.meetupAvailability).toHaveBeenCalledWith('meetup-1', [expect.objectContaining({ label: 'City Hall MRT', latitude: 1.293, longitude: 103.852 })], 1);
  });
  it('keeps manual entry available when OneMap fails', async () => {
    api.meetupLocations.mockResolvedValue({ result: { status: 'unavailable', locations: [] } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    const search = wrapper.findAllComponents(MeetupLocationSearch).find(child => child.props('label') === 'Find your approximate starting place');
    await search.get('input').setValue('City Hall');
    await button(search, 'Search OneMap').trigger('click');
    await flushPromises();
    expect(search.text()).toContain('You can still enter a place and its coordinates below.');
    expect(button(wrapper, 'Save selected availability').element.disabled).toBe(false);
    expect(field(wrapper, 'Place name').exists()).toBe(true);
  });
  it('labels estimated journeys when fresh route times are unavailable', async () => {
    api.meetupTravelSuggestions.mockResolvedValue({ recommendations: {
      message: 'Fresh route times unavailable; using distance estimates.', options: [{
        placeId: 'place-1', label: 'City Hall MRT', startsAt: start, availableCount: 2,
        participantCount: 2, totalDistanceKm: 4, locationRespondents: 2,
        basis: 'straight_line_distance', totalTravelMinutes: null, travelModes: { transit: 1, drive: 1 },
      }],
    } });
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    await button(wrapper, 'Compare travel options').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('1 by public transport · 1 by car.');
    expect(wrapper.text()).toContain('Straight-line distance estimate.');
    expect(wrapper.text()).toContain('Fresh route times are unavailable for this option.');
  });
  it('refreshes saved group counts live while keeping unsaved locations and discussion', async () => {
    vi.useFakeTimers();
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    const ownLocation = field(wrapper, 'Location label');
    await ownLocation.setValue('My unsaved station');
    await button(wrapper, 'Apply this location to selected times').trigger('click');
    await wrapper.get('textarea').setValue('A discussion draft');
    api.meetup.mockResolvedValue({ meetup: { ...board(), version: 2, participantCount: 3, grid: [{ startsAt: start, availableCount: 2 }] } });
    live.handler('meetup-updated', { meetupId: 'meetup-1', version: 2 });
    await vi.advanceTimersByTimeAsync(160); await flushPromises();
    expect(wrapper.get('[data-availability-start]').text()).toContain('2/3');
    expect(wrapper.get('[data-availability-start]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('textarea').element.value).toBe('A discussion draft');
    expect(wrapper.text()).toContain('Your unsaved availability is kept');
    await button(wrapper, 'Save selected availability').trigger('click'); await flushPromises();
    expect(api.meetupAvailability).toHaveBeenCalledWith('meetup-1', [expect.objectContaining({ label: 'My unsaved station' })], 2);
  });
  it('refreshes same-version comments and approvals, ignores other boards and stops after unmount', async () => {
    vi.useFakeTimers();
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    const calls = api.meetup.mock.calls.length;
    live.handler('meetup-updated', { meetupId: 'other-board', version: 10 });
    await vi.advanceTimersByTimeAsync(160); expect(api.meetup).toHaveBeenCalledTimes(calls);
    api.meetup.mockResolvedValue({ meetup: { ...board(), comments: [{ id: 'comment-1', name: 'Sam', body: 'Fresh live discussion' }] } });
    live.handler('meetup-updated', { meetupId: 'meetup-1', version: 1 });
    await vi.advanceTimersByTimeAsync(160); await flushPromises();
    expect(wrapper.text()).toContain('Fresh live discussion');
    wrapper.unmount();
    const after = api.meetup.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30000); expect(api.meetup).toHaveBeenCalledTimes(after);
    expect(live.handler).toBe(null);
  });
  it('keeps the heatmap draft on a stale save and reloads the current version for review', async () => {
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    await wrapper.get('[data-availability-start]').trigger('click');
    api.meetupAvailability.mockRejectedValue(new Error('stale_meetup_version'));
    api.meetup.mockResolvedValue({ meetup: { ...board(), version: 3 } });
    await button(wrapper, 'Save selected availability').trigger('click'); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('This plan has changed');
    expect(wrapper.get('[data-availability-start]').attributes('aria-pressed')).toBe('false');
    expect(wrapper.text()).toContain('Unsaved changes');
  });
  it('clears private drafts when changing boards and ignores the previous board’s late routes', async () => {
    let finish;
    api.meetupTravelSuggestions.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { wrapper } = await mountPage(MeetupView, { props: { id: 'meetup-1' } });
    await field(wrapper, 'Location label').setValue('Previous private origin');
    await field(wrapper, 'Place name').setValue('Previous proposed place');
    await wrapper.get('textarea').setValue('Previous discussion draft');
    await button(wrapper, 'Compare travel options').trigger('click');
    api.meetup.mockResolvedValue({ meetup: { ...board(), id: 'meetup-2', title: 'Other plan' } });
    await wrapper.setProps({ id: 'meetup-2' }); await flushPromises();
    expect(field(wrapper, 'Location label').element.value).toBe('');
    expect(field(wrapper, 'Place name').element.value).toBe('');
    expect(wrapper.get('textarea').element.value).toBe('');
    finish({ recommendations: { message: 'Obsolete previous route', options: [] } }); await flushPromises();
    expect(wrapper.text()).not.toContain('Obsolete previous route');
  });
});
