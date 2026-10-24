import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createTestDb } from '../src/db/connection.js';
import { createRepositories } from '../src/db/repositories.js';
import { migrateMeetups } from '../src/db/meetupRepository.js';
import { createMeetupIntegrations } from '../src/services/meetupIntegrations.js';
import { registerMeetupIntegrationRoutes } from '../src/routes/meetupIntegrations.js';
import { makeUser, makeParty } from './helpers.js';

const startsAt = '2030-01-01T10:00:00+08:00';
const endsAt = '2030-01-01T10:30:00+08:00';
const now = Date.parse(startsAt);
const hostOrigin = { latitude: 1.30, longitude: 103.80, label: 'private-host-home' };
const friendOrigin = { latitude: 1.32, longitude: 103.86, label: 'private-friend-home' };

test('empty availability periods never force valid mixed-mode routes back to distance ranking', async () => {
  const input = { id: 'meet', version: 1, status: 'planning', starts_at: now, ends_at: now + 3600000,
    participantCount: 2, availability: [
      { user_id: 'a', starts_at: now, ends_at: now + 1800000, ...hostOrigin, travel_mode: 'drive' },
      { user_id: 'b', starts_at: now, ends_at: now + 1800000, ...friendOrigin, travel_mode: 'transit' },
    ], places: [{ id: 'place', label: 'Public place', latitude: 1.31, longitude: 103.83 }] };
  const service = createMeetupIntegrations({ repos: { meetups: { planningInput: () => input, access: () => input } },
    travel: { configured: true, route: async () => ({ status: 'available', durationMinutes: 20 }) } });
  const result = await service.suggestions('a', 'meet');
  assert.equal(result.rankingBasis, 'route_times');
  assert.equal(result.options.length, 1);
  assert.equal(result.options[0].availableCount, 2);
  assert.equal(result.options[0].startsAt, now);
});

function setup(t) {
  const db = createTestDb(), repos = createRepositories(db);
  t.after(() => db.close());
  for (const id of ['host', 'friend', 'outsider']) repos.users.create(makeUser(id));
  repos.concerts.create({ id: 'c1', artist: 'Act', venue: 'Venue', city: 'Singapore', event_date: '2030-01-01' });
  repos.parties.create(makeParty('p1', makeUser('host'), { capacity: 2 }));
  repos.membership.configure('host', 'p1', { expectedFriends: 1 });
  repos.membership.acceptInvite('friend', repos.membership.invite('host', 'p1').token);
  const { id } = repos.meetups.create('host', { partyId: 'p1', title: 'Meet before the concert', startsAt, endsAt });
  const save = (user, origin, extra = {}) => repos.meetups.availability(user, id, [{ startsAt, endsAt, ...origin, ...extra }]);
  save('host', hostOrigin, { travelMode: 'drive' });
  save('friend', friendOrigin);
  const a = repos.meetups.place('host', id, { label: 'Station entrance', latitude: 1.301, longitude: 103.81, sheltered: true }).id;
  const b = repos.meetups.place('friend', id, { label: 'Mall entrance', latitude: 1.311, longitude: 103.85, sheltered: true }).id;
  const select = (placeId = a) => repos.meetups.propose('host', id, { version: repos.meetups.access('host', id).version, placeId, startsAt });
  return { db, repos, id, a, b, save, select };
}

test('legacy availability gains a transit default without losing origins or duplicating rows on repeated migration', (t) => {
  const { db, id } = setup(t);
  db.exec('ALTER TABLE meetup_availability DROP COLUMN travel_mode');
  const before = db.prepare('SELECT * FROM meetup_availability WHERE meetup_id=? ORDER BY user_id').all(id);
  migrateMeetups(db); migrateMeetups(db);
  const after = db.prepare('SELECT * FROM meetup_availability WHERE meetup_id=? ORDER BY user_id').all(id);
  assert.equal(after.length, 2);
  assert.ok(after.every((row) => row.travel_mode === 'transit'));
  assert.deepEqual(after.map(({ travel_mode, ...row }) => row), before);
  assert.equal(db.prepare('PRAGMA table_info(meetup_availability)').all().filter((column) => column.name === 'travel_mode').length, 1);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('each member saves their own travel method, defaults to transit, and invalid methods leave saved availability unchanged', (t) => {
  const { db, repos, id, save } = setup(t);
  const modes = () => db.prepare('SELECT user_id,travel_mode FROM meetup_availability WHERE meetup_id=? ORDER BY user_id').all(id);
  assert.deepEqual(modes(), [{ user_id: 'friend', travel_mode: 'transit' }, { user_id: 'host', travel_mode: 'drive' }]);
  save('friend', friendOrigin, { travelMode: 'drive' });
  assert.equal(repos.meetups.detail('friend', id).availability[0].travel_mode, 'drive');
  const before = db.prepare('SELECT * FROM meetup_availability WHERE meetup_id=? ORDER BY user_id').all(id);
  const version = repos.meetups.access('host', id).version;
  for (const travelMode of ['walk', 'car', 'DRIVE', '', null, 3, {}]) {
    assert.throws(() => save('friend', friendOrigin, { travelMode }), /invalid_availability/);
    assert.deepEqual(db.prepare('SELECT * FROM meetup_availability WHERE meetup_id=? ORDER BY user_id').all(id), before);
    assert.equal(repos.meetups.access('host', id).version, version);
  }
  assert.throws(() => save('outsider', hostOrigin, { travelMode: 'drive' }), /meetup_not_found/);
  const hostDetail = repos.meetups.detail('host', id);
  const friendDetail = repos.meetups.detail('friend', id);
  assert.ok(hostDetail.availability.every((row) => row.user_id === 'host'));
  assert.ok(friendDetail.availability.every((row) => row.user_id === 'friend'));
  assert.doesNotMatch(JSON.stringify(hostDetail), /private-friend-home/);
  assert.doesNotMatch(JSON.stringify(friendDetail), /private-host-home/);
});

test('recommendations use individual methods and minimize combined time without a travel-budget cutoff', async (t) => {
  const { repos, id, a } = setup(t);
  const calls = [];
  const integrations = createMeetupIntegrations({ repos, now: () => now, travel: {
    configured: true,
    route: async ({ origin, destination, mode }) => {
      calls.push({ user: origin.user_id, mode });
      return { status: 'available', durationMinutes: destination.id === a ? (origin.user_id === 'host' ? 1 : 80) : 45 };
    },
  } });
  const result = await integrations.suggestions('host', id);
  assert.equal(result.rankingBasis, 'route_times');
  assert.equal(result.options[0].placeId, a, '81 combined minutes beats 90, even though the first place has an 80-minute journey');
  assert.equal(result.options[0].totalTravelMinutes, 81);
  assert.equal(result.options[0].maximumTravelMinutes, 80);
  assert.equal(result.options[1].totalTravelMinutes, 90);
  assert.deepEqual(new Set(calls.map(({ user, mode }) => `${user}:${mode}`)), new Set(['host:drive', 'friend:transit']));
  const legacyOptions = await integrations.suggestions('host', id, { mode: 'walk', maxTravelMinutes: 2 });
  assert.deepEqual(legacyOptions.options.map((option) => option.placeId), result.options.map((option) => option.placeId));
  assert.ok(calls.every(({ user, mode }) => mode === (user === 'host' ? 'drive' : 'transit')));
  assert.doesNotMatch(JSON.stringify(result), /private-host-home|private-friend-home|user_id|latitude|longitude/);
  assert.equal(repos.meetups.access('host', id).status, 'planning', 'suggesting a place must not select it for the group');
});

for (const [label, durationMinutes] of [['negative', -1], ['NaN', NaN], ['infinite', Infinity], ['negative infinite', -Infinity]]) {
  test(`${label} provider durations fall back to distance instead of winning route-time ranking`, async (t) => {
    const { repos, id, a, b } = setup(t);
    const integrations = createMeetupIntegrations({ repos, now: () => now, travel: {
      configured: true,
      route: async ({ origin, destination }) => ({ status: 'available', durationMinutes: destination.id === b && origin.user_id === 'friend' ? durationMinutes : 10 }),
    } });
    const result = await integrations.suggestions('host', id);
    assert.equal(result.rankingBasis, 'straight_line_distance');
    assert.equal(result.options.find((option) => option.placeId === a).totalTravelMinutes, 20);
    const invalid = result.options.find((option) => option.placeId === b);
    assert.equal(invalid.basis, 'straight_line_distance');
    assert.equal(invalid.totalTravelMinutes, null);
    assert.equal(invalid.maximumTravelMinutes, null);
    assert.equal(invalid.routedRespondents, 1);
  });
}

test('transport returns parking for the selected public place and never queries providers for outsiders or invalid inputs', async (t) => {
  const { repos, id, b, select } = setup(t);
  select(b);
  const calls = [];
  const integrations = createMeetupIntegrations({ repos, travel: {
    trainAlerts: async () => { calls.push('trains'); return { status: 'available', affectedLines: [] }; },
    busArrivals: async (code) => { calls.push(`bus:${code}`); return { status: 'available', buses: [] }; },
    crowding: async (line) => { calls.push(`crowd:${line}`); return { status: 'available', stations: [] }; },
    parking: async (place) => {
      calls.push(`parking:${place.id}`);
      assert.equal(place.id, b);
      assert.equal(place.label, 'Mall entrance');
      assert.equal(place.latitude, 1.311);
      return { status: 'available', carparks: [{ id: 'cp', name: 'Public carpark', availableLots: 12 }] };
    },
  } });
  await assert.rejects(integrations.transport('outsider', id), /meetup_not_found/);
  await assert.rejects(integrations.transport('host', id, { busStopCode: '1234' }), /invalid_bus_stop/);
  await assert.rejects(integrations.transport('host', id, { trainLine: 'other' }), /invalid_train_line/);
  assert.deepEqual(calls, []);
  const result = await integrations.transport('host', id, { busStopCode: '12345', trainLine: 'CCL' });
  assert.equal(result.parking.carparks[0].availableLots, 12);
  assert.deepEqual(new Set(calls), new Set(['trains', 'bus:12345', 'crowd:CCL', `parking:${b}`]));
  assert.doesNotMatch(JSON.stringify(result), /private-host-home|private-friend-home|user_id/);
});

test('transport does not request arbitrary parking until a meetup place is selected', async (t) => {
  const { repos, id } = setup(t);
  let parkingCalls = 0;
  const integrations = createMeetupIntegrations({ repos, travel: {
    trainAlerts: async () => ({ status: 'available' }),
    parking: async () => { parkingCalls++; return { status: 'available' }; },
  } });
  const result = await integrations.transport('host', id);
  assert.equal(result.parking.reason, 'choose_a_meeting_place_first');
  assert.equal(parkingCalls, 0);
});

for (const change of ['version', 'membership']) {
  test(`transport rejects a stale ${change} after an awaited provider response`, async (t) => {
    const { repos, id, a, b, select } = setup(t);
    select(a);
    let announceStarted, release;
    const started = new Promise((resolve) => { announceStarted = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    const integrations = createMeetupIntegrations({ repos, travel: {
      trainAlerts: async () => { announceStarted(); await gate; return { status: 'available' }; },
      parking: async () => ({ status: 'available', carparks: [] }),
    } });
    const previousVersion = repos.meetups.access('host', id).version;
    const completion = integrations.transport('host', id).then((value) => ({ value }), (error) => ({ error }));
    await started;
    try {
      if (change === 'version') repos.meetups.vote('friend', id, b);
      else {
        repos.membership.leave('friend', 'p1');
        assert.equal(repos.meetups.access('host', id).version, previousVersion, 'membership changes must be detected even without a board revision');
      }
    } finally { release(); }
    const outcome = await completion;
    assert.equal(outcome.value, undefined);
    assert.equal(outcome.error?.message, `stale_meetup_${change}`);
    assert.equal(outcome.error?.status, 409);
  });
}

test('transport HTTP endpoint authenticates and checks meetup access before parking-provider calls', async (t) => {
  const { repos, id, select } = setup(t);
  select();
  let calls = 0;
  const integrations = createMeetupIntegrations({ repos, travel: {
    trainAlerts: async () => { calls++; return { status: 'available' }; },
    parking: async () => { calls++; return { status: 'available', carparks: [] }; },
  } });
  const app = express();
  app.use((req, res, next) => { if (req.headers['x-test-user']) req.user = { id: req.headers['x-test-user'] }; next(); });
  registerMeetupIntegrationRoutes(app, { integrations });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/meetups/${id}/transport`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { 'x-test-user': 'outsider' } })).status, 404);
  assert.equal(calls, 0);
  const response = await fetch(url, { headers: { 'x-test-user': 'host' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal((await response.json()).transport.parking.status, 'available');
  assert.equal(calls, 2);
});
