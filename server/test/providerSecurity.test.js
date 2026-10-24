import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../src/db/connection.js';
import { createProviderBudget } from '../src/services/providerBudget.js';
import { createProviderCache, providerJson } from '../src/services/providerCache.js';
import { createSingaporeTravel } from '../src/services/singaporeTravel.js';
import { createMeetupWeather } from '../src/services/meetupWeather.js';

const epoch = Date.parse('2030-01-01T02:00:00Z');
const location = { latitude: 1.3, longitude: 103.8 };
const places = { results: [{ SEARCHVAL: 'MRT', LATITUDE: '1.3', LONGITUDE: '103.8' }] };
const json = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });
const jwt = (expiry) => `header.${Buffer.from(JSON.stringify({ exp: expiry / 1000 })).toString('base64url')}.signature`;

test('known expired OneMap token is never sent without refresh credentials', async () => {
  let calls = 0;
  const service = createSingaporeTravel({ now: () => epoch, env: { ONEMAP_TOKEN: jwt(epoch - 1) }, fetchImpl: () => { calls++; } });
  assert.deepEqual(await service.search('MRT'), { status: 'unavailable', reason: 'onemap_token_expired' });
  assert.equal(calls, 0);
});

test('expired OneMap token refresh coalesces across different concurrent searches and caches only safe fields', async () => {
  let auth = 0, reads = 0;
  const service = createSingaporeTravel({ now: () => epoch, env: { ONEMAP_TOKEN: jwt(epoch - 1), ONEMAP_EMAIL: 'mock@example.test', ONEMAP_PASSWORD: 'mock-password' }, fetchImpl: async (url, options) => {
    if (url.includes('/auth/')) { auth++; await new Promise((resolve) => setTimeout(resolve, 1)); return json({ access_token: 'renewed-mock-token', expiry_timestamp: epoch / 1000 + 7200 }); }
    reads++; assert.equal(options.headers.Authorization, 'renewed-mock-token'); return json({ ...places, access_token: 'must-not-escape' });
  } });
  const results = await Promise.all(['MRT', 'Station', 'Public place'].map((query) => service.search(query)));
  assert.equal(auth, 1); assert.equal(reads, 3);
  assert.ok(results.every((r) => r.status === 'available'));
  assert.doesNotMatch(JSON.stringify(results), /mock-password|renewed-mock-token|must-not-escape|access_token/);
});

test('OneMap authentication failure backs off across keys and service restarts', async (t) => {
  const db = createTestDb(); t.after(() => db.close()); let calls = 0, time = epoch;
  const options = { db, now: () => time, env: { ONEMAP_EMAIL: 'mock@example.test', ONEMAP_PASSWORD: 'mock-password' }, fetchImpl: async () => { calls++; return json({ error: 'private provider diagnostics' }, 401); } };
  const first = createSingaporeTravel(options);
  assert.equal((await first.search('One location')).reason, 'provider_authentication_failed');
  assert.equal((await first.search('Another location')).reason, 'provider_authentication_failed');
  assert.equal((await createSingaporeTravel(options).search('New process')).reason, 'provider_authentication_failed');
  assert.equal(calls, 1);
  time += 61000;
  await createSingaporeTravel(options).search('Retry after cooldown');
  assert.equal(calls, 2);
});

test('one rejected OneMap token is refreshed once and every HTTP attempt consumes persistent budget', async (t) => {
  const db = createTestDb(); t.after(() => db.close()); let calls = 0;
  const env = { ONEMAP_TOKEN: 'old-mock-token', ONEMAP_EMAIL: 'mock@example.test', ONEMAP_PASSWORD: 'mock-password', ONEMAP_DAILY_LIMIT: '3' };
  const options = { db, env, now: () => epoch, fetchImpl: async (url, request) => {
    calls++;
    if (url.includes('/auth/')) return json({ access_token: 'new-mock-token', expiry_timestamp: epoch / 1000 + 7200 });
    return request.headers.Authorization === 'old-mock-token' ? json({}, 401) : json(places);
  } };
  assert.equal((await createSingaporeTravel(options).search('MRT')).status, 'available');
  assert.equal(calls, 3);
  assert.equal(db.prepare("SELECT requests FROM provider_budget WHERE provider='onemap'").get().requests, 3);
  assert.equal((await createSingaporeTravel(options).search('Different MRT')).reason, 'provider_rate_limited');
  assert.equal(calls, 3);
  const stored = JSON.stringify(db.prepare('SELECT * FROM provider_throttle').all()) + JSON.stringify(db.prepare('SELECT * FROM provider_budget').all());
  assert.doesNotMatch(stored, /mock-password|mock-token|latitude|longitude|MRT/);
});

test('OneMap unregistered-account 404 is a safe authentication failure with backoff', async () => {
  let calls = 0;
  const service = createSingaporeTravel({ now: () => epoch, env: { ONEMAP_EMAIL: 'mock@example.test', ONEMAP_PASSWORD: 'mock' }, fetchImpl: async () => { calls++; return json({ error: 'sensitive registration details' }, 404); } });
  assert.deepEqual(await service.search('MRT'), { status: 'unavailable', reason: 'provider_authentication_failed' });
  assert.deepEqual(await service.search('Different search'), { status: 'unavailable', reason: 'provider_authentication_failed' });
  assert.equal(calls, 1);
});

test('a repeatedly rejected OneMap token has bounded recovery and no subsequent retry storm', async () => {
  let calls = 0;
  const service = createSingaporeTravel({ now: () => epoch, env: { ONEMAP_TOKEN: 'old', ONEMAP_EMAIL: 'mock@example.test', ONEMAP_PASSWORD: 'mock' }, fetchImpl: async (url) => {
    calls++;
    return url.includes('/auth/') ? json({ access_token: 'new', expiry_timestamp: epoch / 1000 + 7200 }) : json({}, 401);
  } });
  assert.equal((await service.search('MRT')).reason, 'provider_authentication_failed');
  assert.equal((await service.search('Station')).reason, 'provider_authentication_failed');
  assert.equal(calls, 3);
});

test('LTA 429 backs off across endpoints and service restarts', async (t) => {
  const db = createTestDb(); t.after(() => db.close()); let calls = 0;
  const options = { db, now: () => epoch, env: { LTA_ACCOUNT_KEY: 'mock-private-key' }, fetchImpl: async () => { calls++; return json({}, 429); } };
  const first = createSingaporeTravel(options);
  assert.equal((await first.trainAlerts()).reason, 'provider_rate_limited');
  assert.equal((await first.busArrivals('83139')).reason, 'provider_rate_limited');
  assert.equal((await createSingaporeTravel(options).crowding('NSL')).reason, 'provider_rate_limited');
  assert.equal(calls, 1);
});

test('LTA validates malformed responses without returning bodies or credentials', async () => {
  const service = createSingaporeTravel({ env: { LTA_ACCOUNT_KEY: 'mock-private-key' }, now: () => epoch, fetchImpl: async (url) => {
    if (url.includes('BusArrival')) return json({ Services: [null, false, {}, { ServiceNo: '15', NextBus: { EstimatedArrival: 'invalid' } }] });
    if (url.includes('PCD')) return json(null);
    return json({ value: { Status: 'not-supported', key: 'mock-private-key' } });
  } });
  const buses = await service.busArrivals('83139');
  assert.deepEqual(buses.services, [{ service: '15', arrivals: [], crowdLevels: [] }]);
  assert.equal((await service.crowding('NSL')).reason, 'invalid_provider_response');
  assert.equal((await service.trainAlerts()).reason, 'invalid_provider_response');
  assert.doesNotMatch(JSON.stringify(buses), /mock-private-key/);
});

test('invalid provider inputs do not trigger external HTTP requests', async () => {
  let calls = 0;
  const service = createSingaporeTravel({ env: { ONEMAP_TOKEN: 'mock', LTA_ACCOUNT_KEY: 'mock' }, fetchImpl: async () => { calls++; } });
  for (const invalid of ['', 'a', ['MRT'], 'M'.repeat(101)]) assert.equal((await service.search(invalid)).reason, 'invalid_location_query');
  for (const invalid of ['1234', '123456', '../admin', ['83139']]) assert.equal((await service.busArrivals(invalid)).reason, 'invalid_bus_stop');
  assert.equal((await service.route({ origin: { latitude: 1.3, longitude: '103.8' }, destination: location, startsAt: epoch })).reason, 'invalid_route');
  assert.equal((await service.route({ origin: location, destination: location, startsAt: Number.MAX_VALUE })).reason, 'invalid_route');
  assert.equal((await service.route({ origin: location, destination: location, startsAt: epoch, mode: 'https://localhost' })).reason, 'invalid_route');
  assert.equal(calls, 0);
});

test('provider transport rejects arbitrary URLs and disables redirect following', async () => {
  let calls = 0;
  const fetchImpl = async (_url, options) => { calls++; assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal); return json({ safe: true }); };
  for (const url of ['http://www.onemap.gov.sg/api/test', 'https://127.0.0.1/api/test', 'https://www.onemap.gov.sg/other/test', 'https://user:pass@www.onemap.gov.sg/api/test', 'https://www.onemap.gov.sg.evil.test/api/test'])
    await assert.rejects(providerJson(fetchImpl, url), /provider_unavailable/);
  assert.equal(calls, 0);
  await providerJson(fetchImpl, 'https://www.onemap.gov.sg/api/common/elastic/search');
  assert.equal(calls, 1);
});

test('provider transport enforces streamed response body limits and sanitises failures', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; } }));
  await assert.rejects(providerJson(async () => response, 'https://www.onemap.gov.sg/api/test'), /invalid_provider_response/);
  assert.equal(cancelled, true);
  await assert.rejects(providerJson(async () => { throw Error('mock-private-password in failure'); }, 'https://www.onemap.gov.sg/api/test'), (e) => e.message === 'provider_unavailable');
  const cache = createProviderCache();
  const unavailable = await cache.read('test', async () => { throw Object.assign(Error('private'), { reason: 'secret-provider-payload' }); });
  assert.deepEqual(unavailable, { status: 'unavailable', reason: 'provider_unavailable' });
});

test('persistent provider budget enforces minute/day caps across instances and rolls over safely', async (t) => {
  const db = createTestDb(); t.after(() => db.close()); let time = epoch;
  const options = { db, provider: 'budget-test', now: () => time, dailyLimit: 2, requestsPerMinute: 1 };
  createProviderBudget(options).consume();
  assert.throws(() => createProviderBudget(options).consume(), /provider_rate_limited/);
  time += 60000; createProviderBudget(options).consume();
  time += 60000; assert.throws(() => createProviderBudget(options).consume(), /provider_rate_limited/);
  time += 86400000; createProviderBudget(options).consume();
  assert.equal(db.prepare("SELECT sum(requests) total FROM provider_budget WHERE provider='budget-test'").get().total, 3);
});

test('stale successful provider results remain explicitly labelled after an outage', async () => {
  let time = epoch, fail = false, calls = 0;
  const service = createSingaporeTravel({ env: { LTA_ACCOUNT_KEY: 'mock' }, now: () => time, fetchImpl: async () => {
    calls++; if (fail) return json({ private: 'do-not-return' }, 503); return json({ value: { Status: 1 } });
  } });
  assert.equal((await service.trainAlerts()).stale, false);
  time += 61000; fail = true;
  const stale = await service.trainAlerts();
  assert.equal(stale.stale, true); assert.equal(stale.cached, true); assert.equal(stale.reason, 'provider_unavailable'); assert.equal(calls, 2);
  assert.doesNotMatch(JSON.stringify(stale), /do-not-return/);
});

test('NEA output projects only documented weather fields, without arbitrary nested provider properties', async () => {
  const service = createMeetupWeather({ now: () => epoch, env: {}, fetchImpl: async () => json({ code: 0, data: { records: [{
    general: { validPeriod: { start: '2030-01-01T00:00:00+08:00', end: '2030-01-02T00:00:00+08:00', private: 'do-not-return' },
      forecast: { text: 'Cloudy' }, temperature: { low: 25, high: 33, private: 'do-not-return' }, relativeHumidity: { low: 60, high: 90, private: 'do-not-return' } },
    updatedTimestamp: '2030-01-01T09:00:00+08:00' }] } }) });
  const result = await service.forecast({ ...location, startsAt: epoch + 3 * 3600000 });
  assert.equal(result.status, 'available'); assert.deepEqual(result.temperature, { low: 25, high: 33 });
  assert.doesNotMatch(JSON.stringify(result), /do-not-return|private/);
});
