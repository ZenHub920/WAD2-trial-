import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import MeetupTransportPanel from '../src/components/MeetupTransportPanel.vue';
import MeetupLocationSearch from '../src/components/MeetupLocationSearch.vue';
import { api } from '../src/api.js';
import { button } from './helpers.js';

vi.mock('../src/api.js', async original => ({ ...await original(), api: { meetupTransport: vi.fn(), meetupLocations: vi.fn() } }));
const response = (phase = 'pre', overrides = {}) => ({
  phase, anchor: { label: phase === 'pre' ? 'City Hall foyer' : 'Singapore Indoor Stadium', latitude: 1.3028, longitude: 103.8743 },
  venueName: 'Singapore Indoor Stadium', checkedAt: '2030-01-01T10:00:00Z',
  nearby: { status: 'available', stationsStatus: 'available', busStopsStatus: 'available',
    stations: [{ id: 'CC6', name: 'Stadium MRT Station', codes: ['CC6'], lines: ['CCL'], distanceKm: 0.25 }],
    busStops: [{ code: '80199', name: 'Indoor Stadium', distanceKm: 0.18 }],
  },
  trains: { status: 'available', serviceStatus: 'normal', messages: [], affectedSegments: [] },
  crowding: { status: 'available', stations: [{ station: 'CC6', level: 'h', observedAt: '2030-01-01T09:50:00Z' }, { station: 'NS1', level: 'l', observedAt: '2030-01-01T09:50:00Z' }] },
  buses: { status: 'available', stops: [{ code: '80199', status: 'available', services: [{ service: '11', estimatedArrival: 'must-not-show-arrival', crowdLevels: [{ position: 1, load: 'SEA' }, { position: 2, load: 'LSD' }] }] }] },
  ...overrides,
});
const render = (props = {}) => mount(MeetupTransportPanel, { props: {
  meetupId: 'meetup-1', hasMeetingPlace: true, planVersion: 1, concert: { venue: 'Singapore Indoor Stadium' }, ...props,
} });
beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  api.meetupTransport.mockImplementation(async (_, options) => ({ transport: response(options.phase) }));
});

describe('nearby meetup and concert transport', () => {
  it('keeps the post-concert panel and refresh choice when live board data replaces the same venue object', async () => {
    vi.useFakeTimers();
    const wrapper = render();
    await button(wrapper, 'After the concert').trigger('click');
    await button(wrapper, 'Check nearby transport').trigger('click'); await flushPromises();
    await wrapper.setProps({ concert: { venue: 'Singapore Indoor Stadium', artist: 'Updated concert metadata' } });
    expect(wrapper.attributes('data-transport-phase')).toBe('post');
    expect(wrapper.text()).toContain('Near Singapore Indoor Stadium');
    expect(wrapper.get('input[type="checkbox"]').element.checked).toBe(true);
    await vi.advanceTimersByTimeAsync(60000); await flushPromises();
    expect(api.meetupTransport).toHaveBeenCalledTimes(2);
    expect(api.meetupTransport).toHaveBeenLastCalledWith('meetup-1', { phase: 'post' });
  });
  it('waits for an explicit check and explains why a meeting place is required', async () => {
    const wrapper = render({ hasMeetingPlace: false });
    await flushPromises();
    expect(api.meetupTransport).not.toHaveBeenCalled();
    expect(button(wrapper, 'Check nearby transport').element.disabled).toBe(true);
    expect(wrapper.text()).toContain('Propose a meeting place above first');
    await button(wrapper, 'After the concert').trigger('click');
    expect(button(wrapper, 'Check nearby transport').element.disabled).toBe(false);
    expect(api.meetupTransport).not.toHaveBeenCalled();
  });

  it('renders only nearby station/stop cards, source observations and bus loads without arrival times', async () => {
    const wrapper = render();
    await button(wrapper, 'Check nearby transport').trigger('click'); await flushPromises();
    expect(api.meetupTransport).toHaveBeenCalledExactlyOnceWith('meetup-1', { phase: 'pre' });
    expect(wrapper.text()).toContain('City Hall foyer');
    expect(wrapper.text()).toContain('Stadium MRT Station');
    expect(wrapper.text()).toContain('250 m away');
    expect(wrapper.text()).toContain('High crowding');
    expect(wrapper.text()).not.toContain('Low crowding');
    expect(wrapper.text()).toContain('Stop 80199');
    expect(wrapper.text()).toContain('Seats available');
    expect(wrapper.text()).toContain('Limited standing space');
    expect(wrapper.text()).not.toContain('must-not-show-arrival');
    expect(wrapper.text()).toContain('No disruption reported on these nearby lines.');
    expect(wrapper.text()).toContain('Conditions now, not a prediction');
    expect(wrapper.text()).not.toContain('TrainLine');
  });

  it('keeps before/after results separate and switching alone causes no provider request', async () => {
    const wrapper = render();
    await button(wrapper, 'Check nearby transport').trigger('click'); await flushPromises();
    await button(wrapper, 'After the concert').trigger('click');
    expect(api.meetupTransport).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).not.toContain('Near City Hall foyer');
    await button(wrapper, 'Check nearby transport').trigger('click'); await flushPromises();
    expect(api.meetupTransport).toHaveBeenLastCalledWith('meetup-1', { phase: 'post' });
    expect(wrapper.text()).toContain('Near Singapore Indoor Stadium');
    await button(wrapper, 'Before the meetup').trigger('click');
    expect(wrapper.text()).toContain('Near City Hall foyer');
    expect(api.meetupTransport).toHaveBeenCalledTimes(2);
  });

  it('uses a real OneMap search selection to confirm the venue for post-concert checks', async () => {
    api.meetupTransport.mockResolvedValueOnce({ transport: response('post', { anchor: null, reason: 'venue_location_required' }) });
    api.meetupLocations.mockResolvedValue({ result: { status: 'available', locations: [{ label: 'Singapore Indoor Stadium', latitude: 1.3028, longitude: 103.8743, address: '2 Stadium Walk' }] } });
    const wrapper = render();
    await button(wrapper, 'After the concert').trigger('click');
    await button(wrapper, 'Check nearby transport').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Choose the exact concert venue above');
    const search = wrapper.getComponent(MeetupLocationSearch);
    await search.get('input').setValue('Indoor Stadium');
    await button(search, 'Search OneMap').trigger('click'); await flushPromises();
    await search.findAll('button').find(candidate => candidate.text().includes('2 Stadium Walk')).trigger('click');
    expect(api.meetupLocations).toHaveBeenCalledWith('meetup-1', 'Indoor Stadium');
    expect(api.meetupTransport).toHaveBeenCalledTimes(1);
    await button(wrapper, 'Check nearby transport').trigger('click'); await flushPromises();
    expect(api.meetupTransport).toHaveBeenLastCalledWith('meetup-1', { phase: 'post', label: 'Singapore Indoor Stadium', latitude: 1.3028, longitude: 103.8743 });
  });

  it('ignores a late result after switching journey or changing boards', async () => {
    let finish;
    api.meetupTransport.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const wrapper = render();
    await button(wrapper, 'Check nearby transport').trigger('click');
    await button(wrapper, 'After the concert').trigger('click');
    finish({ transport: response() }); await flushPromises();
    expect(wrapper.text()).not.toContain('Near City Hall foyer');
    let finishOther;
    api.meetupTransport.mockReturnValueOnce(new Promise(resolve => { finishOther = resolve; }));
    await button(wrapper, 'Check nearby transport').trigger('click');
    await wrapper.setProps({ meetupId: 'meetup-2' });
    finishOther({ transport: response('post') }); await flushPromises();
    expect(wrapper.text()).not.toContain('Near Singapore Indoor Stadium');
    expect(wrapper.attributes('data-transport-phase')).toBe('pre');
  });

  it('refreshes only an enabled visible panel, avoids overlapping requests and cleans up', async () => {
    vi.useFakeTimers();
    const wrapper = render();
    await button(wrapper, 'Check nearby transport').trigger('click'); await flushPromises();
    let finish;
    api.meetupTransport.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await vi.advanceTimersByTimeAsync(60000);
    expect(api.meetupTransport).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120000);
    expect(api.meetupTransport).toHaveBeenCalledTimes(2);
    finish({ transport: response() }); await flushPromises();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await vi.advanceTimersByTimeAsync(60000);
    expect(api.meetupTransport).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await wrapper.get('input[type="checkbox"]').setValue(false);
    await vi.advanceTimersByTimeAsync(60000);
    expect(api.meetupTransport).toHaveBeenCalledTimes(2);
    wrapper.unmount(); await vi.advanceTimersByTimeAsync(120000);
    expect(api.meetupTransport).toHaveBeenCalledTimes(2);
  });

  it('invalidates the old meeting anchor on a plan revision and preserves honest unavailable states', async () => {
    api.meetupTransport.mockResolvedValue({ transport: response('pre', {
      trains: { status: 'unavailable' }, crowding: { status: 'unavailable' }, buses: { status: 'unavailable' },
    }) });
    const wrapper = render();
    await button(wrapper, 'Check nearby transport').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Train advisories are unavailable');
    expect(wrapper.text()).not.toContain('No disruption reported');
    expect(wrapper.text()).toContain('Station crowd information is unavailable');
    expect(wrapper.text()).toContain('Bus crowd information is unavailable');
    expect(wrapper.get('input[type="checkbox"]').element.checked).toBe(false);
    await wrapper.setProps({ planVersion: 2, hasMeetingPlace: false });
    expect(wrapper.text()).not.toContain('Near City Hall foyer');
    expect(button(wrapper, 'Check nearby transport').element.disabled).toBe(true);
  });

  it('clears old results when access is revoked and shows an error instead of old travel data', async () => {
    const wrapper = render();
    await button(wrapper, 'Check nearby transport').trigger('click'); await flushPromises();
    api.meetupTransport.mockRejectedValueOnce(Object.assign(new Error('not_found'), { status: 404 }));
    await button(wrapper, 'Check nearby transport').trigger('click'); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Reopen the planner');
    expect(wrapper.text()).not.toContain('Near City Hall foyer');
  });
});
