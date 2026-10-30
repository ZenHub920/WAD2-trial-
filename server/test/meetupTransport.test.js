import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../src/db/connection.js';
import { createRepositories } from '../src/db/repositories.js';
import { createMeetupIntegrations } from '../src/services/meetupIntegrations.js';
import { makeUser, makeParty } from './helpers.js';

const startsAt = '2030-01-01T10:00:00+08:00', endsAt = '2030-01-01T11:00:00+08:00';
const epoch = Date.parse(startsAt);
const station = (id, line = 'CCL') => ({ id, name: `Station ${id}`, codes: [id], lines: [line], distanceKm: 0.2 });
const stop = code => ({ code, name: `Stop ${code}`, distanceKm: 0.3 });
const venue = { label: 'Singapore Indoor Stadium', latitude: 1.3008, longitude: 103.874 };
const missing = reason => ({ status: 'unavailable', reason });

function fixture(t, { select = true, overrides = {} } = {}) {
  const db = createTestDb(), repos = createRepositories(db);
  t.after(() => db.close());
  for (const user of ['host', 'friend', 'outsider']) repos.users.create(makeUser(user));
  repos.concerts.create({ id: 'c1', artist: 'Act', venue: venue.label, city: 'Singapore', event_date: '2030-01-01' });
  repos.parties.create(makeParty('p1', makeUser('host'), { capacity: 2 }));
  repos.membership.configure('host', 'p1', { expectedFriends: 1 });
  repos.membership.acceptInvite('friend', repos.membership.invite('host', 'p1').token);
  const { id } = repos.meetups.create('host', { partyId: 'p1', title: 'Meetup', startsAt, endsAt });
  repos.meetups.availability('host', id, [{ startsAt, endsAt, latitude: 1.31, longitude: 103.8, label: 'private-host-origin' }]);
  const place = repos.meetups.place('host', id, { label: 'Public meeting entrance', latitude: 1.301, longitude: 103.81 }).id;
  if (select) repos.meetups.propose('host', id, { placeId: place, startsAt, version: repos.meetups.access('host', id).version });
  const calls = { search: [], nearby: [], alerts: 0, crowding: [], buses: [] };
  const travel = {
    search: async query => { calls.search.push(query); return { status: 'available', locations: [venue] }; },
    nearbyStops: async point => {
      calls.nearby.push(point);
      return { status: 'available', rail: { status: 'available' }, bus: { status: 'available' }, stations: [station('CC6')], busStops: [stop('80199')] };
    },
    trainAlerts: async () => { calls.alerts++; return { status: 'available', serviceStatus: 'normal', affectedSegments: [], messages: [] }; },
    crowding: async line => { calls.crowding.push(line); return { status: 'available', stations: [{ station: 'CC6', level: 'm', observedAt: startsAt }] }; },
    busArrivals: async code => { calls.buses.push(code); return { status: 'available', services: [{ service: '11', arrivals: [{ estimatedArrival: startsAt }], crowdLevels: [{ position: 1, load: 'LSD' }] }] }; },
    ...overrides,
  };
  const service = createMeetupIntegrations({ db, repos, env: {}, now: () => epoch, travel });
  return { db, repos, id, place, calls, travel, service };
}

test('pre-meetup transport uses the selected public place, never member origins or the concert venue', async t => {
  const { repos, id, calls, service } = fixture(t);
  const version = repos.meetups.access('host', id).version;
  const result = await service.transport('host', id, { phase: 'pre' });
  assert.deepEqual(result.anchor, { label: 'Public meeting entrance', latitude: 1.301, longitude: 103.81, source: 'meeting_place' });
  assert.deepEqual(calls.nearby, [result.anchor]);
  assert.deepEqual(calls.search, []);
  assert.equal(result.checkedAt, new Date(epoch).toISOString());
  assert.equal(repos.meetups.access('host', id).version, version);
  assert.doesNotMatch(JSON.stringify(result), /private-host-origin|estimatedArrival|arrivals/);
});

test('post-concert transport resolves only the unique exact venue match, even when it is not the first result', async t => {
  const { repos, id, calls, travel, service } = fixture(t);
  travel.search = async query => {
    calls.search.push(query);
    return { status: 'available', locations: [{ label: 'Different building', latitude: 1.4, longitude: 103.9 }, venue] };
  };
  const result = await service.transport('host', id, { phase: 'post' });
  assert.deepEqual(calls.search, [venue.label]);
  assert.deepEqual(result.anchor, { ...venue, source: 'concert_venue' });
  assert.deepEqual(calls.nearby, [result.anchor]);
  assert.equal(repos.meetups.detail('friend', id).concert.venue, venue.label);
  assert.doesNotMatch(JSON.stringify(result), /Different building|private-host-origin/);
});

test('ambiguous, nonmatching and unavailable venue lookups require confirmation without querying citywide feeds', async t => {
  for (const locations of [[venue, { ...venue, longitude: 103.875 }], [{ ...venue, label: 'Another stadium' }], []]) {
    const { id, calls, travel, service } = fixture(t);
    travel.search = async () => ({ status: locations.length ? 'available' : 'unavailable', locations });
    const result = await service.transport('host', id, { phase: 'post' });
    assert.equal(result.reason, 'venue_location_required'); assert.equal(result.anchor, null);
    assert.deepEqual(calls.nearby, []); assert.equal(calls.alerts, 0);
    assert.deepEqual(calls.crowding, []); assert.deepEqual(calls.buses, []);
  }
});

test('parking-only refresh does not request citywide advisories or crowd feeds', async t => {
  let parkingCalls = 0;
  const { id, calls, service } = fixture(t, { overrides: { parking: async point => {
    parkingCalls++; assert.equal(point.label, 'Public meeting entrance');
    return { status: 'available', carparks: [] };
  } } });
  const result = await service.transport('host', id, { parkingOnly: 'true' });
  assert.equal(result.parking.status, 'available'); assert.equal(result.trains, null);
  assert.equal(parkingCalls, 1); assert.equal(calls.alerts, 0);
  assert.deepEqual(calls.crowding, []); assert.deepEqual(calls.buses, []);
});

test('explicit public venue confirmation bypasses geocoding while invalid coordinates and phases make no provider calls', async t => {
  const { id, calls, service } = fixture(t);
  const result = await service.transport('host', id, { phase: 'post', latitude: String(venue.latitude), longitude: String(venue.longitude), label: 'Venue entrance' });
  assert.equal(result.anchor.source, 'confirmed_venue'); assert.equal(result.anchor.label, 'Venue entrance');
  assert.deepEqual(calls.search, []);
  const callsBefore = JSON.stringify(calls);
  for (const options of [
    { phase: 'post', latitude: 0, longitude: 0 },
    { phase: 'post', latitude: 'NaN', longitude: venue.longitude },
    { phase: 'post', latitude: venue.latitude },
    { phase: 'post', latitude: venue.latitude, longitude: venue.longitude, label: {} },
    { phase: 'anywhere' },
  ]) await assert.rejects(service.transport('host', id, options), /invalid_venue_location|invalid_transport_phase/);
  assert.equal(JSON.stringify(calls), callsBefore);
});

test('transport returns nearby station reports and matching alert-cluster messages only, with no bus arrival timestamps', async t => {
  const { id, travel, service } = fixture(t);
  travel.nearbyStops = async () => ({ status: 'available', rail: { status: 'available' }, bus: { status: 'available' },
    stations: [station('CC6'), { ...station('CE1', 'CEL'), codes: ['CE1', 'DT16'], lines: ['CEL', 'DTL'] }], busStops: [stop('80199')] });
  travel.crowding = async line => ({ status: 'available', stations: [
    { station: 'CC6', level: 'l' }, { station: 'DT16', level: 'h' }, { station: 'CE1', level: 'm' }, { station: 'NS99', level: 'h' },
  ] });
  travel.trainAlerts = async () => ({ status: 'available', serviceStatus: 'disrupted', messages: [{ content: 'Unrelated global message' }], affectedSegments: [
    { line: 'NSL', stations: 'NS1 NS2', messages: [{ content: 'Unrelated first cluster' }] },
    { line: 'CCL', stations: 'CC5 CC6', messages: [{ content: 'Nearby later cluster' }] },
    { line: 'DTL', stations: 'DT15 DT16', messages: [{ content: 'Nearby interchange alert' }] },
  ] });
  const result = await service.transport('host', id, { phase: 'pre' });
  assert.deepEqual(result.trains.messages.map(message => message.content), ['Nearby later cluster', 'Nearby interchange alert']);
  assert.equal(result.trains.affectedSegments.length, 2);
  assert.deepEqual(result.crowding.stations.map(s => [s.station, s.level]), [['CC6', 'l'], ['CE1', 'h']]);
  assert.equal(result.buses.stops[0].services[0].crowdLevels[0].load, 'LSD');
  assert.doesNotMatch(JSON.stringify(result), /NS99|Unrelated|estimatedArrival|arrivals|private-host-origin/);
});

test('only four distinct nearby train lines and the three supplied nearby stops are queried', async t => {
  const { id, calls, travel, service } = fixture(t);
  travel.nearbyStops = async () => ({ status: 'available', rail: { status: 'available' }, bus: { status: 'available' }, stations: [
    { ...station('A'), lines: ['CCL', 'EWL'] }, { ...station('B'), lines: ['NSL', 'DTL'] }, { ...station('C'), lines: ['NEL', 'TEL'] },
  ], busStops: [stop('80199'), stop('80198'), stop('80197')] });
  await service.transport('host', id, { phase: 'pre' });
  assert.deepEqual(calls.crowding, ['CCL', 'EWL', 'NSL', 'DTL']);
  assert.deepEqual(calls.buses, ['80199', '80198', '80197']); assert.equal(calls.alerts, 1);
});

test('missing public anchors or nearby stops never trigger whole-network feed requests', async t => {
  const { id, calls, travel, service } = fixture(t, { select: false });
  assert.equal((await service.transport('host', id, { phase: 'pre' })).reason, 'choose_a_meeting_place_first');
  assert.deepEqual(calls.nearby, []);
  travel.nearbyStops = async point => { calls.nearby.push(point); return { status: 'available', stations: [], busStops: [] }; };
  const result = await service.transport('host', id, { phase: 'post', ...venue });
  assert.equal(result.trains.reason, 'no_nearby_stations'); assert.equal(result.crowding.status, 'unavailable');
  assert.deepEqual(result.buses.stops, []); assert.equal(calls.alerts, 0);
  assert.deepEqual(calls.crowding, []); assert.deepEqual(calls.buses, []);
});

test('partial transport outages retain available categories and explicitly mark missing crowd reports', async t => {
  const { id, travel, service } = fixture(t);
  travel.trainAlerts = async () => missing('provider_rate_limited');
  travel.crowding = async () => missing('provider_unavailable');
  travel.busArrivals = async () => ({ status: 'available', stale: true, services: [] });
  const result = await service.transport('host', id, { phase: 'pre' });
  assert.equal(result.trains.reason, 'provider_rate_limited');
  assert.equal(result.crowding.status, 'unavailable'); assert.equal(result.crowding.stations[0].level, null);
  assert.equal(result.buses.status, 'available'); assert.equal(result.buses.stops[0].stale, true);
});

test('outsiders are rejected before providers run and membership or version changes during awaits reject stale transport', async t => {
  const unauthorized = fixture(t);
  await assert.rejects(unauthorized.service.transport('outsider', unauthorized.id, { phase: 'post' }), /meetup_not_found/);
  assert.deepEqual(unauthorized.calls.search, []); assert.deepEqual(unauthorized.calls.nearby, []);

  const changedMembership = fixture(t);
  changedMembership.travel.nearbyStops = async () => {
    changedMembership.repos.membership.leave('friend', 'p1');
    return { status: 'available', stations: [], busStops: [] };
  };
  await assert.rejects(changedMembership.service.transport('host', changedMembership.id, { phase: 'pre' }), /stale_meetup_membership/);

  const changedPlan = fixture(t);
  changedPlan.travel.trainAlerts = async () => {
    changedPlan.repos.meetups.availability('friend', changedPlan.id, []);
    return { status: 'available', serviceStatus: 'normal', affectedSegments: [], messages: [] };
  };
  await assert.rejects(changedPlan.service.transport('host', changedPlan.id, { phase: 'pre' }), /stale_meetup_version/);
});
