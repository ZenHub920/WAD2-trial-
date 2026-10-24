import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../src/db/connection.js';
import { createConcertProvider } from '../src/services/concertProvider.js';
import { searchTicketmaster, normalizeTicketmasterEvent } from '../src/services/ticketmaster.js';
import { importTicketmasterConcerts } from '../src/db/ticketmasterConcerts.js';

const epoch = Date.parse('2030-01-01T00:00:00Z');
const apiKey = 'mock-private-ticketmaster-key';
const event = { id: 'sg-security', name: 'Artist', dates: { start: { localDate: '2030-03-01' } },
  _embedded: { venues: [{ name: 'Hall', city: { name: 'Singapore' }, country: { countryCode: 'SG' } }] } };
const response = (body, status = 200, headers) => new Response(JSON.stringify(body), { status, headers });

test('Ticketmaster rejects custom upstream URLs before any credential-bearing request', async () => {
  let calls = 0;
  for (const url of ['http://app.ticketmaster.com/discovery/v2/events.json', 'https://localhost/private',
    'https://app.ticketmaster.com.evil.test/discovery/v2/events.json', 'https://www.onemap.gov.sg/api/test',
    'https://app.ticketmaster.com/discovery/v2/events.json?extra=1']) {
    await assert.rejects(searchTicketmaster({ apiKey, url, fetchImpl: () => { calls++; } }), (error) => error.message === 'invalid_concert_provider_url');
  }
  assert.equal(calls, 0);
});

test('Ticketmaster requests disable redirects, carry timeouts, bound pagination and expose only normalized events', async () => {
  let calls = 0;
  const result = await searchTicketmaster({ apiKey, now: new Date(epoch), maxPages: Infinity, fetchImpl: async (url, options) => {
    calls++; assert.ok(url instanceof URL); assert.equal(url.origin, 'https://app.ticketmaster.com');
    assert.equal(url.searchParams.get('apikey'), apiKey); assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return response({ _embedded: { events: [event] }, page: { totalPages: 999999 }, private: apiKey });
  } });
  assert.equal(calls, 10); assert.equal(result.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /mock-private-ticketmaster-key|apikey/);
});

test('Ticketmaster caps provider body size and sanitizes network/HTTP diagnostics', async () => {
  await assert.rejects(searchTicketmaster({ apiKey, fetchImpl: async () => response({}, 200, { 'Content-Length': String(2 * 1024 * 1024 + 1) }) }),
    (error) => error.message === 'invalid_provider_response');
  await assert.rejects(searchTicketmaster({ apiKey, fetchImpl: async () => { throw Error(`request failure with ${apiKey}`); } }),
    (error) => error.message === 'provider_unavailable');
  await assert.rejects(searchTicketmaster({ apiKey, fetchImpl: async () => response({ diagnostic: apiKey }, 429) }),
    (error) => error.message === 'provider_rate_limited' && error.upstreamStatus === 429 && !JSON.stringify(error).includes(apiKey));
});

test('Ticketmaster 429 pauses new HTTP attempts while cached fallback remains clearly stale', async (t) => {
  const db = createTestDb(); t.after(() => db.close()); let calls = 0, fail = false;
  const provider = createConcertProvider({ db, now: () => epoch, env: { TICKETMASTER_API_KEY: apiKey }, pause: async () => {}, fetchImpl: async () => {
    calls++;
    return fail ? response({ diagnostic: apiKey }, 429, { 'Retry-After': '120' }) : response({ _embedded: { events: [event] } });
  } });
  assert.equal((await provider.discover()).stale, false); fail = true;
  const failed = await provider.discover({ force: true });
  assert.equal(failed.stale, true); assert.equal(failed.source, 'stored'); assert.equal(failed.reason, 'concert_provider_unavailable');
  const backedOff = await provider.discover({ force: true }); assert.equal(backedOff.stale, true);
  assert.equal(calls, 2);
  assert.equal(db.prepare("SELECT requests FROM provider_budget WHERE provider='ticketmaster'").get().requests, 2);
  assert.doesNotMatch(JSON.stringify(failed), /mock-private-ticketmaster-key|diagnostic/);
});

test('Ticketmaster paginated concurrent discovery spends one shared persistent budget per actual HTTP attempt', async (t) => {
  const db = createTestDb(); t.after(() => db.close()); let calls = 0;
  const options = { db, now: () => epoch, env: { TICKETMASTER_API_KEY: apiKey, TICKETMASTER_MAX_PAGES: '2', TICKETMASTER_DAILY_LIMIT: '2' }, pause: async () => {}, fetchImpl: async () => {
    calls++; return response({ _embedded: { events: [event] }, page: { totalPages: 3 } });
  } };
  const provider = createConcertProvider(options);
  const [first, second] = await Promise.all([provider.discover(), provider.discover()]);
  assert.deepEqual(first, second); assert.equal(calls, 2);
  assert.equal(db.prepare("SELECT requests FROM provider_budget WHERE provider='ticketmaster'").get().requests, 2);
  assert.equal((await createConcertProvider(options).discover({ force: true })).stale, true);
  assert.equal(calls, 2);
});

test('Ticketmaster detail sync rejects redirects and treats HTTP404 as absence rather than cancellation', async (t) => {
  const db = createTestDb(); t.after(() => db.close());
  importTicketmasterConcerts(db, [normalizeTicketmasterEvent(event)]);
  const calls = [];
  const provider = createConcertProvider({ db, now: () => epoch, env: { TICKETMASTER_API_KEY: apiKey }, pause: async () => {}, fetchImpl: async (url, options) => {
    const parsed = new URL(url); calls.push(parsed.pathname);
    assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
    assert.equal(parsed.origin, 'https://app.ticketmaster.com'); assert.equal(parsed.searchParams.get('apikey'), apiKey);
    return parsed.pathname.endsWith('/events.json') ? response({ _embedded: { events: [] } }) : response({ diagnostic: apiKey }, 404);
  } });
  assert.equal((await provider.sync()).count, 0);
  assert.equal(calls.length, 2);
  assert.equal(db.prepare("SELECT provider_status FROM concerts WHERE id='tm_sg-security'").get().provider_status, 'onsale');
  assert.equal(db.prepare('SELECT count(*) n FROM concert_updates').get().n, 0);
});
