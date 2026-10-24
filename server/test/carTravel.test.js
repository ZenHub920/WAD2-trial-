import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSingaporeTravel } from '../src/services/singaporeTravel.js';
import { createTestDb } from '../src/db/connection.js';

const epoch = Date.parse('2030-01-01T02:00:00Z');
const origin = { latitude: 1.3, longitude: 103.8 }, destination = { latitude: 1.31, longitude: 103.85 };
const json = (value, status = 200) => ({ ok: status === 200, status, json: async () => value });
const park = (overrides = {}) => ({ CarParkID: 'A1', Development: 'Public carpark', Location: '1.3005 103.8005', AvailableLots: 12, LotType: 'C', Agency: 'LTA', ...overrides });

test('driving route uses OneMap drive summary, safe durations and distance, with no transit parameters', async () => {
  let calls = 0;
  const service = createSingaporeTravel({ now: () => epoch, env: { ONEMAP_TOKEN: 'mock' }, fetchImpl: async (url, options) => {
    calls++; const params = new URL(url).searchParams;
    assert.equal(params.get('routeType'), 'drive'); assert.equal(params.has('date'), false); assert.equal(params.has('mode'), false);
    assert.equal(options.headers.Authorization, 'mock'); assert.equal(options.redirect, 'error');
    return json({ route_summary: { total_time: '1081', total_distance: '12345' }, route_geometry: 'private-route-not-returned' });
  } });
  const result = await service.route({ origin, destination, mode: 'drive', startsAt: epoch });
  assert.equal(result.durationMinutes, 19); assert.equal(result.distanceKm, 12.35); assert.equal(result.basis, 'driving_route');
  assert.doesNotMatch(JSON.stringify(result), /private-route|latitude|longitude|mock/);
  assert.equal((await service.route({ origin, destination, mode: 'drive', startsAt: epoch })).cached, true); assert.equal(calls, 1);
});

test('malformed driving durations cannot appear as zero-minute journeys', async () => {
  for (const total_time of [null, '', ' ', false, {}, -1, 1000000]) {
    const service = createSingaporeTravel({ now: () => epoch, env: { ONEMAP_TOKEN: 'mock' }, fetchImpl: async () => json({ route_summary: { total_time } }) });
    assert.equal((await service.route({ origin, destination, mode: 'drive', startsAt: epoch })).status, 'unavailable');
  }
});

test('bus occupancy uses official categorical loads, preserves ETA contract and reports missing data honestly', async () => {
  const service = createSingaporeTravel({ now: () => epoch, env: { LTA_ACCOUNT_KEY: 'mock-key' }, fetchImpl: async () => json({ Services: [{ ServiceNo: '15',
    NextBus: { Load: 'SEA', EstimatedArrival: '2030-01-01T10:03:00+08:00', Feature: 'WAB' },
    NextBus2: { Load: 'SDA', EstimatedArrival: '' }, NextBus3: { Load: 'LSD' } },
    { ServiceNo: '10', NextBus: { Load: 'not-supported', EstimatedArrival: '2030-01-01T10:03:00+08:00' }, NextBus2: {} }] }) });
  const result = await service.busArrivals('83139');
  assert.equal(result.services[0].arrivals.length, 1); assert.equal(result.services[0].arrivals[0].estimatedArrival, '2030-01-01T10:03:00+08:00');
  assert.deepEqual(result.services[0].crowdLevels.map((level) => [level.position, level.loadLabel]), [[1, 'Seats available'], [2, 'Standing available'], [3, 'Limited standing']]);
  assert.equal(result.services[1].crowdLevels[0].load, null); assert.equal(result.services[1].crowdLevels[0].loadLabel, 'Not reported');
});

test('nearby parking uses bounded shared city snapshot, car-only lots, safe public fields and local filtering', async (t) => {
  const db = createTestDb(); t.after(() => db.close()); let calls = 0;
  const service = createSingaporeTravel({ db, now: () => epoch, env: { LTA_ACCOUNT_KEY: 'mock-key' }, fetchImpl: async (url, options) => {
    calls++; const target = new URL(url);
    assert.equal(target.origin, 'https://datamall2.mytransport.sg'); assert.equal(target.pathname, '/ltaodataservice/CarParkAvailabilityv2');
    assert.equal([...target.searchParams.keys()].join(','), '$skip'); assert.equal(options.headers.AccountKey, 'mock-key');
    return json({ value: [park(), park({ CarParkID: 'full', AvailableLots: '0', Location: '1.301 103.801' }), park({ CarParkID: 'bike', LotType: 'Y' }), park({ CarParkID: 'far', Location: '1.4 103.9' }), park({ CarParkID: 'invalid', AvailableLots: -3 }), null, park({ CarParkID: 'bad-location', Location: '' })], AccountKey: 'must-not-escape' });
  } });
  const result = await service.parking(origin);
  assert.equal(result.status, 'available'); assert.equal(result.coverage, 'complete_snapshot'); assert.equal(result.pagesFetched, 1);
  assert.deepEqual(result.carparks.map((p) => p.availableLots), [12, 0]);
  assert.equal((await service.parking({ ...destination, radiusKm: 5 })).cached, true); assert.equal(calls, 1);
  assert.equal(db.prepare("SELECT requests FROM provider_budget WHERE provider='lta'").get().requests, 1);
  assert.doesNotMatch(JSON.stringify(result), /AccountKey|mock-key|must-not-escape/);
});

test('parking pagination is capped and explicitly identifies a partial snapshot', async () => {
  let calls = 0;
  const service = createSingaporeTravel({ now: () => epoch, env: { LTA_ACCOUNT_KEY: 'mock' }, fetchImpl: async (url) => {
    const skip = Number(new URL(url).searchParams.get('$skip')); assert.equal(skip, calls * 500); calls++;
    return json({ value: Array.from({ length: 500 }, (_, index) => park({ CarParkID: `${skip + index}` })) });
  } });
  const result = await service.parking(origin);
  assert.equal(calls, 6); assert.equal(result.pagesFetched, 6); assert.equal(result.coverage, 'bounded_snapshot'); assert.equal(result.carparks.length, 5);
});

test('parking validation, malformed responses and unavailable credentials never silently generate live results', async () => {
  let calls = 0;
  const service = createSingaporeTravel({ env: {}, fetchImpl: () => { calls++; } });
  assert.equal((await service.parking(origin)).reason, 'lta_not_configured');
  for (const point of [{ latitude: 1.3, longitude: '103.8' }, { ...origin, radiusKm: 0 }, { ...origin, radiusKm: 6 }, { ...origin, limit: 100 }])
    assert.equal((await service.parking(point)).reason, 'invalid_parking_location');
  assert.equal(calls, 0);
  const malformed = createSingaporeTravel({ env: { LTA_ACCOUNT_KEY: 'mock' }, fetchImpl: async () => json({ value: 'bad' }) });
  assert.equal((await malformed.parking(origin)).reason, 'invalid_provider_response');
});

test('parking deduplicates car stocks, ignores non-car/null values, and detects a repeated page without six redundant calls', async () => {
  let calls = 0;
  const rows = [park({ CarParkID: 1, AvailableLots: 0 }), park({ AvailableLots: 12 }), park({ AvailableLots: 12 }),
    park({ CarParkID: 'other-type', LotType: 'A', AvailableLots: 999 }), park({ CarParkID: 'null', AvailableLots: null })];
  const service = createSingaporeTravel({ now: () => epoch, env: { LTA_ACCOUNT_KEY: 'mock' }, fetchImpl: async () => {
    calls++; return json({ value: [...rows, ...Array.from({ length: 495 }, () => park({ CarParkID: 'padding', LotType: 'Y' }))] });
  } });
  const result = await service.parking(origin);
  assert.equal(calls, 2); assert.equal(result.coverage, 'bounded_snapshot');
  assert.equal(result.carparks.length, 2); assert.equal(result.carparks.find((p) => p.id === 'LTA:A1').availableLots, 12);
  assert.equal(result.carparks.find((p) => p.id === 'LTA:1').availableLots, 0);
});

test('parking stale fallback is labelled and does not bypass rate-limit backoff', async () => {
  let now = epoch, fail = false, calls = 0;
  const service = createSingaporeTravel({ now: () => now, env: { LTA_ACCOUNT_KEY: 'mock' }, fetchImpl: async () => {
    calls++; return fail ? json({}, 429) : json({ value: [park()] });
  } });
  assert.equal((await service.parking(origin)).stale, false);
  now += 61000; fail = true;
  const stale = await service.parking(origin); assert.equal(stale.stale, true); assert.equal(stale.reason, 'provider_rate_limited');
  await service.parking(destination); assert.equal(calls, 2);
});
