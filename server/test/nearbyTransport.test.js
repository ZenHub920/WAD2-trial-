import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSingaporeTravel } from '../src/services/singaporeTravel.js';
import { createTestDb } from '../src/db/connection.js';

const epoch = Date.parse('2030-01-01T02:00:00Z');
const point = { latitude: 1.3, longitude: 103.8 };
const json = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });
const rail = (id = 'CC6', name = 'STADIUM MRT STATION', offset = 0.001) => ({ id, name, lat: point.latitude + offset, lon: point.longitude, road: 'PUBLIC ROAD' });
const bus = (id = 1259, offset = 0.001) => ({ id, name: 'PUBLIC BUS STOP', lat: point.latitude + offset, lon: point.longitude });
const token = `header.${Buffer.from(JSON.stringify({ exp: epoch / 1000 + 30 * 86400 })).toString('base64url')}.signature`;

test('nearby stops use bounded authenticated OneMap queries, coalesce reads and persist actual request budgets', async t => {
  const db = createTestDb(); t.after(() => db.close()); let calls = 0;
  const travel = createSingaporeTravel({ db, now: () => epoch, env: { ONEMAP_TOKEN: token }, fetchImpl: async (url, options) => {
    calls++;
    const request = new URL(url), isRail = request.pathname.endsWith('/getNearestMrtStops');
    assert.equal(request.origin, 'https://www.onemap.gov.sg');
    assert.equal(options.headers.Authorization, token); assert.equal(options.redirect, 'error');
    assert.deepEqual([...request.searchParams.keys()], ['latitude', 'longitude', 'radius_in_meters']);
    assert.equal(request.searchParams.get('radius_in_meters'), isRail ? '1500' : '800');
    return json(isRail ? [rail()] : [bus()]);
  } });
  const [first, concurrent] = await Promise.all([travel.nearbyStops(point), travel.nearbyStops(point)]);
  assert.deepEqual(first, concurrent); assert.equal(calls, 2);
  assert.equal(first.status, 'available'); assert.equal(first.partial, false);
  assert.equal(first.stations[0].id, 'CC6'); assert.deepEqual(first.stations[0].lines, ['CCL']);
  assert.equal(first.busStops[0].code, '01259');
  const cached = await travel.nearbyStops(point);
  assert.equal(cached.rail.cached, true); assert.equal(cached.bus.cached, true); assert.equal(calls, 2);
  assert.equal(db.prepare("SELECT requests FROM provider_budget WHERE provider='onemap'").get().requests, 2);
  assert.doesNotMatch(JSON.stringify(first), /signature|PUBLIC ROAD|access_token|Authorization/);
});

test('nearby results merge interchange codes, deduplicate, validate and keep only three inside each radius', async () => {
  const travel = createSingaporeTravel({ now: () => epoch, env: { ONEMAP_TOKEN: token }, fetchImpl: async url => json(url.includes('MrtStops') ? [
    rail(), rail('CC6', 'STADIUM MRT STATION', 0.0012),
    rail('NS24', 'DHOBY GHAUT MRT STATION', 0.002), rail('NE6|CC1', 'DHOBY GHAUT MRT STATION', 0.0021),
    rail('TE1', 'THIRD MRT STATION', 0.003), rail('DT1', 'FOURTH MRT STATION', 0.004),
    rail('EW1', 'OUTSIDE MRT STATION', 0.02), { ...rail('NS1', 'BAD'), lat: null }, null,
  ] : [bus(), bus('01259', 0.0011), bus(11111, 0.002), bus(22222, 0.003), bus(33333, 0.004), bus(44444, 0.009), { ...bus(), id: 'bad-code' }]) });
  const result = await travel.nearbyStops(point);
  assert.equal(result.stations.length, 3); assert.equal(result.busStops.length, 3);
  assert.deepEqual(result.stations[1].codes, ['CC1', 'NE6', 'NS24']);
  assert.deepEqual(result.stations[1].lines, ['CCL', 'NEL', 'NSL']);
  assert.deepEqual(result.busStops.map(stop => stop.code), ['01259', '11111', '22222']);
  assert.ok(result.stations.every(station => station.distanceKm <= 1.5 && station.distanceKm > 0));
  assert.ok(result.busStops.every(stop => stop.distanceKm <= 0.8 && stop.distanceKm > 0));
  assert.doesNotMatch(JSON.stringify(result), /OUTSIDE|FOURTH|BAD/);
});

test('nearby validation and missing credentials never issue network requests', async () => {
  let calls = 0;
  const travel = createSingaporeTravel({ now: () => epoch, env: {}, fetchImpl: () => { calls++; throw Error('network must not run'); } });
  assert.equal((await travel.nearbyStops(point)).reason, 'onemap_not_configured');
  for (const location of [undefined, null, {}, { latitude: '1.3', longitude: 103.8 }, { latitude: null, longitude: 103.8 }, { latitude: 2, longitude: 103.8 }])
    assert.equal((await travel.nearbyStops(location)).reason, 'invalid_transport_location');
  assert.equal(calls, 0);
});

test('a nearby category failure remains explicit while the other category stays usable', async () => {
  const travel = createSingaporeTravel({ now: () => epoch, env: { ONEMAP_TOKEN: token }, fetchImpl: async url =>
    url.includes('MrtStops') ? json([rail()]) : json({ internal: 'provider diagnostic must not escape' }, 503) });
  const result = await travel.nearbyStops(point);
  assert.equal(result.status, 'available'); assert.equal(result.partial, true);
  assert.equal(result.rail.status, 'available'); assert.equal(result.bus.reason, 'provider_unavailable');
  assert.equal(result.stations.length, 1); assert.deepEqual(result.busStops, []);
  assert.doesNotMatch(JSON.stringify(result), /diagnostic|internal/);
});

test('nearby empty arrays mean no nearby stops, malformed schemas are unavailable, and search stays object-only', async () => {
  const empty = createSingaporeTravel({ now: () => epoch, env: { ONEMAP_TOKEN: token }, fetchImpl: async () => json([]) });
  assert.equal((await empty.nearbyStops(point)).status, 'available');
  assert.deepEqual((await empty.nearbyStops(point)).stations, []);
  assert.equal((await empty.search('Stadium')).reason, 'invalid_provider_response');
  for (const response of [{ results: [rail()] }, [null, {}], [{ ...rail(), lat: '' }]]) {
    const travel = createSingaporeTravel({ now: () => epoch, env: { ONEMAP_TOKEN: token }, fetchImpl: async () => json(response) });
    const result = await travel.nearbyStops(point);
    assert.equal(result.status, 'unavailable'); assert.equal(result.reason, 'invalid_provider_response');
  }
});

test('nearby caches label stale geography after an outage and never bypass provider budgets', async () => {
  let time = epoch, available = true, calls = 0;
  const travel = createSingaporeTravel({ now: () => time, env: { ONEMAP_TOKEN: token }, fetchImpl: async url => {
    calls++; return available ? json(url.includes('MrtStops') ? [rail()] : [bus()]) : json({}, 503);
  } });
  await travel.nearbyStops(point); time += 86400001; available = false;
  const result = await travel.nearbyStops(point);
  assert.equal(result.status, 'available'); assert.equal(result.stale, true);
  assert.equal(result.rail.reason, 'provider_unavailable'); assert.equal(calls, 4);
  let budgetCalls = 0;
  const limited = createSingaporeTravel({ now: () => epoch, env: { ONEMAP_TOKEN: token, ONEMAP_DAILY_LIMIT: '1' }, fetchImpl: async url => {
    budgetCalls++; return json(url.includes('MrtStops') ? [rail()] : [bus()]);
  } });
  const partial = await limited.nearbyStops(point);
  assert.equal(partial.partial, true); assert.equal(budgetCalls, 1);
  assert.equal(partial.bus.reason, 'provider_rate_limited');
});

test('station codes retain LRT feeds and train alerts preserve later affected-line clusters', async () => {
  const queries = [];
  const travel = createSingaporeTravel({ now: () => epoch, env: { ONEMAP_TOKEN: token, LTA_ACCOUNT_KEY: 'mock-lta' }, fetchImpl: async url => {
    queries.push(url);
    if (url.includes('MrtStops')) return json([rail('STC|SW1|SE1', 'SENGKANG LRT STATION'), rail('PTC|PW1|PE1', 'PUNGGOL LRT STATION', 0.002), rail('BP1', 'BUKIT PANJANG LRT STATION', 0.003)]);
    if (url.includes('BusStops')) return json([]);
    if (url.includes('PCDRealTime')) return json({ value: [{ Station: 'STC', CrowdLevel: 'h', StartTime: '2030-01-01T10:00:00+08:00', EndTime: '2030-01-01T10:10:00+08:00' }] });
    return json({ value: [
      { Status: 1, Message: [], AffectedSegments: [] },
      { Status: 2, Message: [{ Content: 'Circle line disruption', CreatedDate: '2030-01-01 10:00:00', private: 'never-return' }], AffectedSegments: [{ Line: 'CCL', Stations: 'CC6,CC7', Direction: 'Both' }] },
      { Status: 2, Message: [{ Content: 'Downtown disruption' }], AffectedSegments: [{ Line: 'DTL', Stations: 'DT1', Direction: 'Both' }] },
    ] });
  } });
  const nearby = await travel.nearbyStops(point);
  assert.deepEqual(nearby.stations.map(station => station.lines), [['SLRT'], ['PLRT'], ['BPL']]);
  for (const line of ['BPL', 'SLRT', 'PLRT']) assert.equal((await travel.crowding(line)).status, 'available');
  const alerts = await travel.trainAlerts();
  assert.equal(alerts.serviceStatus, 'disrupted');
  assert.deepEqual(alerts.affectedSegments.map(segment => segment.line), ['CCL', 'DTL']);
  assert.equal(alerts.affectedSegments[0].messages[0].content, 'Circle line disruption');
  assert.deepEqual(alerts.messages.map(message => message.content), ['Circle line disruption', 'Downtown disruption']);
  assert.doesNotMatch(JSON.stringify(alerts), /never-return|mock-lta/);
  assert.equal(queries.filter(url => url.includes('PCDRealTime')).length, 3);
});
