import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import MeetupTransportPanel from '../../client/src/components/MeetupTransportPanel.vue';
import { api } from '../../client/src/api.js';
import { button } from './helpers.js';

vi.mock('../../client/src/api.js', async original => ({ ...await original(), api: { meetupTransport: vi.fn() } }));

const CHECKED = '2030-01-01T10:00:00Z';
const inMinutes = minutes => new Date(Date.parse(CHECKED) + minutes * 60000).toISOString();
const response = (phase = 'pre', overrides = {}) => ({
  phase, anchor: { label: phase === 'pre' ? 'City Hall foyer' : 'Singapore Indoor Stadium', latitude: 1.3028, longitude: 103.8743 },
  venueName: 'Singapore Indoor Stadium', checkedAt: CHECKED,
  nearby: { status: 'available', stationsStatus: 'available', busStopsStatus: 'available',
    stations: [{ id: 'CC6', name: 'Stadium MRT Station', codes: ['CC6'], lines: ['CCL'], distanceKm: 0.25 }],
    busStops: [{ code: '80199', name: 'Indoor Stadium', distanceKm: 0.18 }],
  },
  trains: { status: 'available', serviceStatus: 'normal', messages: [], affectedSegments: [] },
  crowding: { status: 'available', stations: [{ station: 'CC6', level: 'h', observedAt: '2030-01-01T09:50:00Z' }, { station: 'NS1', level: 'l', observedAt: '2030-01-01T09:50:00Z' }] },
  buses: { status: 'available', stops: [{ code: '80199', status: 'available', services: [
    { service: '16', arrivals: [{ estimatedArrival: inMinutes(9), load: 'SDA' }] },
    { service: '11', arrivals: [{ estimatedArrival: inMinutes(3), load: 'SEA' }, { estimatedArrival: inMinutes(14), load: 'LSD' }] },
  ] }] },
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
afterEach(() => { vi.useRealTimers(); });

describe('nearby meetup and concert transport', () => {
  it('opens on the meeting place and checks it straight away, with no separate check button', async () => {
    const wrapper = render(); await flushPromises();
    expect(api.meetupTransport).toHaveBeenCalledExactlyOnceWith('meetup-1', { phase: 'pre' });
    expect(wrapper.attributes('data-transport-source')).toBe('meeting');
    expect(button(wrapper, 'Meeting place').attributes('aria-pressed')).toBe('true');
    expect(wrapper.text()).toContain('Near City Hall foyer');
    expect(wrapper.findAll('button').some(item => item.text() === 'Check nearby transport')).toBe(false);
  });

  it('checks the concert venue when there is no meeting place yet', async () => {
    const wrapper = render({ hasMeetingPlace: false }); await flushPromises();
    expect(api.meetupTransport).toHaveBeenCalledExactlyOnceWith('meetup-1', { phase: 'post' });
    expect(wrapper.findAll('button').some(item => item.text() === 'Meeting place')).toBe(false);
    expect(wrapper.text()).toContain('Near Singapore Indoor Stadium');
  });

  it('switches between the venue and the meeting place, checking each choice once', async () => {
    const wrapper = render(); await flushPromises();
    await button(wrapper, 'Concert venue').trigger('click'); await flushPromises();
    expect(api.meetupTransport).toHaveBeenLastCalledWith('meetup-1', { phase: 'post' });
    expect(wrapper.text()).toContain('Near Singapore Indoor Stadium');
    expect(wrapper.text()).not.toContain('Near City Hall foyer');
    await button(wrapper, 'Meeting place').trigger('click'); await flushPromises();
    expect(api.meetupTransport).toHaveBeenCalledTimes(3);
    expect(wrapper.text()).toContain('Near City Hall foyer');
  });

  it('shows stations, crowding and one row per bus with arrival minutes coloured by how full it is', async () => {
    const wrapper = render(); await flushPromises();
    expect(wrapper.text()).toContain('Stadium MRT Station');
    expect(wrapper.text()).toContain('250 m away');
    expect(wrapper.text()).toContain('High crowding');
    expect(wrapper.text()).not.toContain('Low crowding');
    expect(wrapper.text()).toContain('Stop 80199');
    expect(wrapper.text()).toContain('No disruption reported on these nearby lines.');
    const rows = wrapper.findAll('.bus-row');
    // Soonest bus first.
    expect(rows.map(row => row.get('.bus-row__number').text())).toEqual(['11', '16']);
    const times = rows[0].findAll('.bus-row__time');
    expect(times.map(time => time.text())).toEqual(['3 min', '14 min']);
    expect(times[0].classes()).toContain('bus-row__time--seats');
    expect(times[1].classes()).toContain('bus-row__time--limited');
    expect(rows[1].get('.bus-row__time').classes()).toContain('bus-row__time--standing');
    expect(wrapper.get('.bus-legend').text()).toContain('Seats');
    const about = wrapper.get('.nearby-transport__about');
    expect(about.get('summary').text()).toBe('About this transport data');
    expect(about.attributes('open')).toBeUndefined();
    expect(about.text()).toContain('Missing reports don’t mean it’s empty.');
  });

  it('shows five buses per stop until Show all is pressed', async () => {
    const services = Array.from({ length: 7 }, (_, index) => ({ service: String(100 + index), arrivals: [{ estimatedArrival: inMinutes(index + 1), load: 'SEA' }] }));
    api.meetupTransport.mockResolvedValue({ transport: response('pre', { buses: { status: 'available', stops: [{ code: '80199', status: 'available', services }] } }) });
    const wrapper = render(); await flushPromises();
    expect(wrapper.findAll('.bus-row')).toHaveLength(5);
    await button(wrapper, 'Show all 7 buses').trigger('click');
    expect(wrapper.findAll('.bus-row')).toHaveLength(7);
    await button(wrapper, 'Show fewer buses').trigger('click');
    expect(wrapper.findAll('.bus-row')).toHaveLength(5);
  });

  it('falls back to how full a bus is when no arrival time is reported', async () => {
    api.meetupTransport.mockResolvedValue({ transport: response('pre', { buses: { status: 'available', stops: [{ code: '80199', status: 'available', services: [
      { service: '11', crowdLevels: [{ position: 1, load: 'SEA' }, { position: 2, load: 'LSD' }] },
    ] }] } }) });
    const wrapper = render(); await flushPromises();
    expect(wrapper.findAll('.bus-row__time').map(time => time.text())).toEqual(['Seats', 'Crowded']);
  });

  it('refreshes only from the refresh icon, never on a timer', async () => {
    vi.useFakeTimers();
    const wrapper = render(); await flushPromises();
    await vi.advanceTimersByTimeAsync(180000);
    expect(api.meetupTransport).toHaveBeenCalledTimes(1);
    await wrapper.get('button[aria-label="Refresh transport"]').trigger('click'); await flushPromises();
    expect(api.meetupTransport).toHaveBeenCalledTimes(2);
    expect(api.meetupTransport).toHaveBeenLastCalledWith('meetup-1', { phase: 'pre' });
    wrapper.unmount(); await vi.advanceTimersByTimeAsync(120000);
    expect(api.meetupTransport).toHaveBeenCalledTimes(2);
  });

  it('waits while hidden and checks once the tab becomes active', async () => {
    const wrapper = render({ active: false }); await flushPromises();
    expect(api.meetupTransport).not.toHaveBeenCalled();
    await wrapper.setProps({ active: true }); await flushPromises();
    expect(api.meetupTransport).toHaveBeenCalledExactlyOnceWith('meetup-1', { phase: 'pre' });
  });

  it('explains when the venue cannot be found on the map', async () => {
    api.meetupTransport.mockResolvedValue({ transport: response('post', { anchor: null, reason: 'venue_location_required' }) });
    const wrapper = render({ hasMeetingPlace: false }); await flushPromises();
    expect(wrapper.text()).toContain('We couldn’t find Singapore Indoor Stadium on the map');
    expect(wrapper.findAll('.nearby-transport__stop')).toHaveLength(0);
  });

  it('shows missing provider configuration without inventing nearby data', async () => {
    api.meetupTransport.mockResolvedValue({ transport: response('pre', {
      nearby: { status: 'unavailable', reason: 'onemap_not_configured', stations: [], busStops: [] },
      trains: { status: 'unavailable', reason: 'lta_not_configured' },
    }) });
    const wrapper = render(); await flushPromises();
    expect(wrapper.text()).toContain('OneMap is not configured.');
    expect(wrapper.findAll('.nearby-transport__stop')).toHaveLength(0);
    expect(wrapper.text()).not.toContain('No disruption reported');
    expect(wrapper.text()).not.toContain('High crowding');
  });

  it('preserves honest unavailable states for trains, stations and buses', async () => {
    api.meetupTransport.mockResolvedValue({ transport: response('pre', {
      trains: { status: 'unavailable' }, crowding: { status: 'unavailable' }, buses: { status: 'unavailable' },
    }) });
    const wrapper = render(); await flushPromises();
    expect(wrapper.text()).toContain('Train advisories are unavailable');
    expect(wrapper.text()).not.toContain('No disruption reported');
    expect(wrapper.text()).toContain('Station crowd information is unavailable');
    expect(wrapper.text()).toContain('Bus crowd information is unavailable');
  });

  it('re-checks the meeting place on a plan revision and moves to the venue when the place is removed', async () => {
    const wrapper = render(); await flushPromises();
    await wrapper.setProps({ planVersion: 2 }); await flushPromises();
    expect(api.meetupTransport).toHaveBeenCalledTimes(2);
    await wrapper.setProps({ planVersion: 3, hasMeetingPlace: false }); await flushPromises();
    expect(wrapper.attributes('data-transport-source')).toBe('venue');
    expect(api.meetupTransport).toHaveBeenLastCalledWith('meetup-1', { phase: 'post' });
    expect(wrapper.text()).not.toContain('Near City Hall foyer');
  });

  it('ignores a late result after switching place or changing boards', async () => {
    let finish;
    api.meetupTransport.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const wrapper = render();
    await button(wrapper, 'Concert venue').trigger('click');
    finish({ transport: response('pre') }); await flushPromises();
    expect(wrapper.text()).not.toContain('Near City Hall foyer');
    expect(wrapper.text()).toContain('Near Singapore Indoor Stadium');
    let finishOther;
    api.meetupTransport.mockReturnValueOnce(new Promise(resolve => { finishOther = resolve; }));
    await button(wrapper, 'Meeting place').trigger('click');
    await wrapper.setProps({ meetupId: 'meetup-2' });
    finishOther({ transport: response('pre') }); await flushPromises();
    expect(wrapper.text()).not.toContain('Near City Hall foyer');
    expect(wrapper.attributes('data-transport-source')).toBe('venue');
  });

  it('clears old results when access is revoked and shows an error instead of old travel data', async () => {
    const wrapper = render(); await flushPromises();
    api.meetupTransport.mockRejectedValueOnce(Object.assign(new Error('not_found'), { status: 404 }));
    await button(wrapper, 'Concert venue').trigger('click'); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Reopen the planner');
    expect(wrapper.text()).not.toContain('Near City Hall foyer');
    expect(wrapper.text()).not.toContain('Near Singapore Indoor Stadium');
  });
});
