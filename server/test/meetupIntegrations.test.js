import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createSingaporeTravel } from '../src/services/singaporeTravel.js';
import { createProviderCache } from '../src/services/providerCache.js';
import { createMeetupWeather } from '../src/services/meetupWeather.js';
import { createMeetupIntegrations } from '../src/services/meetupIntegrations.js';
import { registerMeetupIntegrationRoutes } from '../src/routes/meetupIntegrations.js';
import { createTestDb } from '../src/db/connection.js';
import { createRepositories } from '../src/db/repositories.js';
import { makeUser, makeParty } from './helpers.js';
const now = Date.parse('2030-01-01T10:00:00+08:00');
const origin = { latitude: 1.3, longitude: 103.8 }, destination = { latitude: 1.31, longitude: 103.85 };
const json = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });
const locationResult = { results: [{ SEARCHVAL: 'CITY HALL MRT', ADDRESS: 'PUBLIC STATION', LATITUDE: '1.3', LONGITUDE: '103.8', POSTAL: '123456' }] };

test('unconfigured travel providers never issue network requests or expose configuration', async () => {
  const travel = createSingaporeTravel({ env: {}, fetchImpl: () => { throw Error('network must not run'); } });
  assert.equal((await travel.search('City Hall')).reason, 'onemap_not_configured');
  assert.equal((await travel.route({ origin, destination, startsAt: now })).reason, 'onemap_not_configured');
  assert.equal((await travel.trainAlerts()).reason, 'lta_not_configured');
  assert.equal((await travel.busArrivals('83139')).reason, 'lta_not_configured');
  assert.equal((await travel.crowding('BAD')).reason, 'invalid_train_line');
});
test('OneMap authentication renews expired tokens, caches/coalesces reads and returns sanitized places', async () => {
  let auth = 0, reads = 0;
  const requests = [];
  const travel = createSingaporeTravel({ now: () => now, env: { ONEMAP_EMAIL: 'secret@example.test', ONEMAP_PASSWORD: 'never-print', ONEMAP_TOKEN: 'expired' }, fetchImpl: async (url, options) => {
    requests.push({ url: String(url), options });
    if (url.includes('/auth/')) { auth++; return json({ access_token: 'fresh-secret', expiry_timestamp: now / 1000 + 259200 }); }
    reads++;
    if (options.headers.Authorization === 'expired') return json({ error: 'Authentication token expired', results: [] });
    return json({ ...locationResult, secret: 'must-not-return' });
  } });
  const [a, b] = await Promise.all([travel.search('City Hall'), travel.search('City Hall')]);
  assert.equal(auth, 1); assert.equal(reads, 2); assert.deepEqual(a, b);
  const again = await travel.search('City Hall');
  assert.equal(again.cached, true); assert.equal(reads, 2);
  assert.equal(a.locations[0].label, 'CITY HALL MRT');
  assert.doesNotMatch(JSON.stringify(a), /secret|never-print/);
  assert.equal(requests[0].options.headers.Authorization, 'expired');
  assert.ok(requests.every((r) => !r.url.includes('fresh-secret') && !r.url.includes('never-print')));
});
test('OneMap routes use Singapore date/time, transit durations and private request headers', async () => {
  let request;
  const travel = createSingaporeTravel({ env: { ONEMAP_TOKEN: 'private' }, now: () => now, fetchImpl: async (url, options) => { request = { url: new URL(url), options }; return json({ plan: { itineraries: [{ duration: 1260 }] } }); } });
  const route = await travel.route({ origin, destination, startsAt: Date.parse('2030-01-01T17:30:00Z') });
  assert.equal(route.durationMinutes, 21); assert.equal(route.basis, 'scheduled_public_transport');
  assert.equal(request.url.searchParams.get('date'), '01-02-2030'); assert.equal(request.url.searchParams.get('time'), '01:30:00');
  assert.equal(request.options.headers.Authorization, 'private');
  assert.equal(request.url.searchParams.has('token'), false);
  assert.doesNotMatch(JSON.stringify(route), /latitude|longitude|private/);
});
test('provider cache coalesces, bounds requests, and marks stale fallback after429', async () => {
  let time = now, calls = 0;
  const cache = createProviderCache({ now: () => time, dailyLimit: 2, requestsPerMinute: 30 });
  const retrieve = async () => { calls++; return { status: 'available', value: 'saved' }; };
  await Promise.all([cache.read('one', retrieve, { ttl: 1 }), cache.read('one', retrieve, { ttl: 1 })]);
  assert.equal(calls, 1);
  time += 2;
  const failed = await cache.read('one', async () => { throw Object.assign(Error('secret upstream body'), { reason: 'provider_rate_limited' }); });
  assert.equal(failed.stale, true); assert.equal(failed.value, 'saved');
  assert.deepEqual(await cache.read('two', retrieve), { status: 'unavailable', reason: 'provider_rate_limited' });
  assert.equal(calls, 1);
});
test('LTA uses current v3 arrivals and preserves accessibility, alerts and cache freshness', async () => {
  const calls = [];
  const travel = createSingaporeTravel({ env: { LTA_ACCOUNT_KEY: 'private-lta' }, now: () => now, fetchImpl: async (url, options) => {
    calls.push(String(url)); assert.equal(options.headers.AccountKey, 'private-lta');
    if (url.includes('BusArrival')) return json({ Services: [{ ServiceNo: '15', NextBus: { EstimatedArrival: '2030-01-01T10:03:00+08:00', Load: 'SEA', Feature: 'WAB' } }] });
    if (url.includes('PCD')) return json({ value: [{ Station: 'NS1', CrowdLevel: 'l', StartTime: '2030-01-01T10:00:00+08:00' }] });
    return json({ value: { Status: 2, Message: [{ Content: 'Train delay', CreatedDate: '2030-01-01 10:00:00' }], AffectedSegments: [{ Line: 'NSL', Stations: 'NS1,NS2', Direction: 'Both' }] } });
  } });
  const buses = await travel.busArrivals('83139'); assert.equal(buses.services[0].arrivals[0].wheelchairAccessible, true);
  assert.match(calls[0], /\/v3\/BusArrival\?BusStopCode=83139$/);
  assert.equal((await travel.busArrivals('83139')).cached, true);
  assert.equal((await travel.trainAlerts()).serviceStatus, 'disrupted');
  assert.equal((await travel.crowding('NSL')).stations[0].station, 'NS1');
  assert.equal(calls.length, 3);
  assert.doesNotMatch(JSON.stringify(buses), /private-lta|Latitude|Longitude/);
});
test('NEA selects24h coverage and4day Singapore date without implying local precision', async () => {
  const weather = createMeetupWeather({ now: () => now, env: {}, fetchImpl: async (url) => {
    if (url.endsWith('twenty-four-hr-forecast')) return json({ code: 0, data: { records: [{ general: { validPeriod: { start: '2030-01-01T00:00:00+08:00', end: '2030-01-02T00:00:00+08:00' }, forecast: { text: 'Thundery Showers' }, temperature: { low: 25, high: 33 } }, updatedTimestamp: '2030-01-01T09:00:00+08:00' }] } });
    return json({ code: 0, data: { records: [{ updatedTimestamp: '2030-01-01T09:00:00+08:00', forecasts: [{ timestamp: '2030-01-03T00:00:00+08:00', forecast: { summary: 'Afternoon showers' } }] }] } });
  } });
  const day = await weather.forecast({ ...origin, startsAt: now + 3 * 3600000 });
  assert.equal(day.horizon, '24-hour'); assert.equal(day.precision, 'national_outlook'); assert.equal(day.rainWarning, true);
  const outlook = await weather.forecast({ ...origin, startsAt: Date.parse('2030-01-02T20:00:00Z') });
  assert.equal(outlook.horizon, '4-day'); assert.equal(outlook.date, '2030-01-03'); assert.match(outlook.message, /approximate/);
});
test('NEA rainfall uses nearest fresh reporting station and never labels observations forecasts', async () => {
  let time = now;
  const weather = createMeetupWeather({ now: () => time, env: {}, fetchImpl: async () => json({ code: 0, data: { stations: [{ id: 'a', name: 'Nearby', location: origin }, { id: 'b', name: 'Elsewhere', location: destination }], readings: [{ timestamp: new Date(now).toISOString(), data: [{ stationId: 'a', value: 2.5 }, { stationId: 'b', value: 0 }] }] } }) });
  const result = await weather.rainfall(origin); assert.equal(result.millimetres, 2.5); assert.equal(result.station, 'Nearby'); assert.match(result.message, /not a forecast/);
  time += 31 * 60000;
  assert.equal((await weather.rainfall(origin)).reason, 'no_recent_rainfall_reading');
});

function setup(t) {
  const db = createTestDb(), repos = createRepositories(db);
  t.after(() => db.close());
  for (const id of ['host', 'friend', 'outsider']) repos.users.create(makeUser(id));
  repos.concerts.create({ id: 'c1', artist: 'Act', venue: 'Venue', city: 'Singapore', event_date: '2030-01-01' });
  repos.parties.create(makeParty('p1', makeUser('host'), { capacity: 2 }));
  repos.membership.configure('host', 'p1', { expectedFriends: 1 });
  repos.membership.acceptInvite('friend', repos.membership.invite('host', 'p1').token);
  const { id } = repos.meetups.create('host', { partyId: 'p1', title: 'Meet here', startsAt: new Date(now).toISOString(), endsAt: new Date(now + 1800000).toISOString() });
  for (const [user, location] of [['host', origin], ['friend', destination]]) repos.meetups.availability(user, id, [{ startsAt: new Date(now).toISOString(), endsAt: new Date(now + 1800000).toISOString(), ...location, label: `private-${user}` }]);
  const a = repos.meetups.place('host', id, { label: 'Place A', ...origin, sheltered: true }).id;
  const b = repos.meetups.place('friend', id, { label: 'Place B', ...destination, sheltered: false }).id;
  return { db, repos, id, a, b };
}
test('travel recommendations rank group-wide journeys, keep origins private and preserve human proposal', async (t) => {
  const { repos, id, a } = setup(t);
  const service = createMeetupIntegrations({ repos, now: () => now, travel: { configured: true, route: async ({ destination }) => ({ status: 'available', durationMinutes: destination.id === a ? 10 : 30 }) } });
  const result = await service.suggestions('host', id);
  assert.equal(result.rankingBasis, 'route_times'); assert.equal(result.options[0].placeId, a); assert.equal(result.options[0].totalTravelMinutes, 20); assert.equal(result.options[0].maximumTravelMinutes, 10);
  assert.doesNotMatch(JSON.stringify(result), /private-friend|user_id|latitude|longitude/);
  assert.equal(repos.meetups.detail('host', id).status, 'planning');
  assert.equal(repos.meetups.detail('host', id).availability.length, 1);
  const sheltered = await service.suggestions('host', id, { shelteredOnly: true }); assert.equal(sheltered.options.length, 1);
  await assert.rejects(service.suggestions('outsider', id), /meetup_not_found/);
});
test('missing routes retain distance fallback and stale access is rechecked afterawait', async (t) => {
  const { repos, id } = setup(t);
  const service = createMeetupIntegrations({ repos, travel: { configured: false } });
  const result = await service.suggestions('host', id); assert.equal(result.rankingBasis, 'straight_line_distance'); assert.equal(result.options[0].fallbackReason, 'onemap_not_configured');
  let reads = 0;
  const changed = createMeetupIntegrations({ repos, travel: { search: async () => { reads++; repos.membership.leave('friend', 'p1'); return { status: 'available', locations: [] }; } } });
  await assert.rejects(changed.locations('friend', id, 'MRT'), /meetup_not_found/); assert.equal(reads, 1);
  assert.deepEqual(repos.meetups.list('outsider'), []);
});
test('departed participants cannot influence travel suggestions through retained vote history', async (t) => {
  const { db, repos, id, a, b } = setup(t);
  repos.meetups.vote('host', id, a);
  repos.meetups.vote('friend', id, b);
  assert.equal(repos.meetups.planningInput('host', id).places.find((p) => p.id === b).votes, 1);
  repos.membership.leave('friend', 'p1');
  // Keep historical rows; filtering must not depend on deleting evidence of a vote.
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meetup_votes WHERE meetup_id=? AND user_id=?').get(id, 'friend').n, 1);
  const input = repos.meetups.planningInput('host', id);
  assert.equal(input.participantCount, 1);
  assert.equal(input.places.find((p) => p.id === a).votes, 1);
  assert.equal(input.places.find((p) => p.id === b).votes, 0);
  assert.equal(input.availability.some((r) => r.user_id === 'friend'), false);
  const service = createMeetupIntegrations({ repos, now: () => now, travel: { configured: false } });
  const result = await service.suggestions('host', id);
  assert.equal(result.options.find((o) => o.placeId === b).votes, 0);
});
test('a participant leaving during an awaited route rejects the entire stale group travel result', async (t) => {
  const { repos, id } = setup(t);
  let announceStarted, release;
  const started = new Promise((resolve) => { announceStarted = resolve; });
  const providerGate = new Promise((resolve) => { release = resolve; });
  const service = createMeetupIntegrations({ repos, now: () => now, travel: { configured: true, route: async () => {
    announceStarted();
    await providerGate;
    return { status: 'available', durationMinutes: 10 };
  } } });
  const version = repos.meetups.access('host', id).version;
  const completion = service.suggestions('host', id).then((value) => ({ value }), (error) => ({ error }));
  await started;
  try {
    repos.membership.leave('friend', 'p1');
    // The host retains access and the meetup version did not change: a version-only
    // check cannot detect that one of the computed journeys is no longer eligible.
    assert.equal(repos.meetups.access('host', id).version, version);
    assert.equal(repos.meetups.participants(repos.meetups.access('host', id)).includes('friend'), false);
  } finally { release(); }
  const outcome = await completion;
  assert.equal(outcome.value, undefined);
  assert.equal(outcome.error?.message, 'stale_meetup_membership');
  assert.equal(outcome.error?.status, 409);
});
test('a partial route matrix never promotes unmeasured journeys or changes distance ranking', async (t) => {
  const { repos, id, a } = setup(t);
  const service = createMeetupIntegrations({ repos, now: () => now, travel: { configured: true, route: async ({ destination }) => destination.id === a ? { status: 'available', durationMinutes: 2 } : { status: 'unavailable', reason: 'route_not_found' } } });
  const result = await service.suggestions('host', id);
  assert.equal(result.rankingBasis, 'straight_line_distance');
  assert.equal(result.options.find((o) => o.placeId !== a).totalTravelMinutes, null);
  assert.equal(result.options.find((o) => o.placeId !== a).fallbackReason, 'route_not_found');
});
test('larger travel matrices stay inside the twenty-four request budget and four concurrent calls', async () => {
  const input = { id: 'meet', version: 1, status: 'planning', starts_at: now, ends_at: now + 4 * 1800000, participantCount: 10,
    availability: Array.from({ length: 10 }, (_, i) => ({ user_id: `u${i}`, starts_at: now, ends_at: now + 4 * 1800000, latitude: 1.3, longitude: 103.8 + i / 10000 })),
    places: [{ id: 'a', label: 'A', ...origin }, { id: 'b', label: 'B', ...destination }] };
  let calls = 0, active = 0, maximum = 0;
  const service = createMeetupIntegrations({ now: () => now, repos: { meetups: { planningInput: () => input, access: () => input } }, travel: { configured: true, route: async () => { calls++; active++; maximum = Math.max(maximum, active); await new Promise((r) => setTimeout(r, 1)); active--; return { status: 'available', durationMinutes: 10 }; } } });
  const result = await service.suggestions('u0', 'meet');
  assert.equal(calls, 20); assert.equal(result.routesRequested, 20); assert.ok(maximum <= 4); assert.equal(result.rankingBasis, 'route_times');
});
test('meetup integration routes enforce authentication and scope before external requests', async (t) => {
  const { repos, id } = setup(t);
  let calls = 0;
  const integrations = createMeetupIntegrations({ repos, travel: { search: async () => { calls++; return { status: 'available', locations: [] }; } } });
  const app = express(); app.use((req, res, next) => { if (req.headers['x-test-user']) req.user = { id: req.headers['x-test-user'] }; next(); });
  registerMeetupIntegrationRoutes(app, { integrations });
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  t.after(() => new Promise((r) => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}/meetups/${id}/locations?q=MRT`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { 'x-test-user': 'outsider' } })).status, 404); assert.equal(calls, 0);
  const response = await fetch(url, { headers: { 'x-test-user': 'host' } }); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal(calls, 1);
});
